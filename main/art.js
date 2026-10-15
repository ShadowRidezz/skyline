// Game art, cached in the data folder: the real cover / logo of each game in your library (Steam,
// Epic's own catalog, then a search of the Steam store and Wikipedia by name), and the game's real
// icon from its shortcut.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { spawn } = require("child_process");
const { app, net, nativeImage, shell } = require("electron");

const UA = { "User-Agent": "Skyline/1.0 (Windows desktop dashboard; https://github.com/)" };
const norm = s => String(s || "").toLowerCase().replace(/[™®©]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
// "Minecraft Launcher" -> "Minecraft", "Roblox Player" -> "Roblox", "Fortnite (2)" -> "Fortnite"
const gameName = s => String(s || "").replace(/[™®©]/g, "").replace(/\s*\(\d+\)$/, "").replace(/\s+(launcher|player|client|game|app|shipping)$/i, "").trim();

// launchers, stores and tools: not games, so no cover search (that found Epic's office building and a Steam Deck);
// they show their own app logo instead
const APP_ONLY = /^(steam|epic games( launcher)?|battle\.?net|ea( app| desktop)?|origin|ubisoft connect|uplay|gog galaxy|riot client|xbox( app)?|roblox studio|modrinth( app)?|curseforge|prism ?launcher|lunar client|badlion client|tlauncher|discord|obs studio|nvidia app|geforce experience|amazon games|itch|playnite|heroic games launcher|rockstar games launcher)$/i;
const isApp = it => APP_ONLY.test(String(it.name || "").replace(/[™®©]/g, "").trim());
// "Name" vs a store result: the same name, or the name plus only an edition word ("Terraria" ok, "Steam Deck" no)
const EDITION = /^(remastered|definitive edition|game of the year edition|goty( edition)?|deluxe edition|complete edition|enhanced edition|anniversary edition|director s cut|hd|classic|standard edition|\d{4})$/;
const sameGame = (a, b) => { a = norm(a); b = norm(b); if (a === b) return true; if (!b.startsWith(a + " ")) return false; return EDITION.test(b.slice(a.length + 1)); };

class Art {
  constructor(dataDir) {
    this.dataDir = dataDir; this.dir = path.join(dataDir, "gameart");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async get(url, json) {
    const r = await net.fetch(url, { headers: UA });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.net = r.status === 429 || r.status >= 500; throw e; }
    return json ? r.json() : Buffer.from(await r.arrayBuffer());
  }
  // Downloads a picture once, shrinks it, and returns its sky:// address.
  async cache(url, key, width = 920) {
    const name = crypto.createHash("sha1").update(key || url).digest("hex").slice(0, 16) + ".jpg", f = path.join(this.dir, name);
    if (fs.existsSync(f)) return `sky://gameart/${name}`;
    const buf = await this.get(url), img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty() || img.getSize().width < 64) throw new Error("not a picture");
    const out = img.getSize().width > width ? img.resize({ width, quality: "good" }) : img;
    fs.writeFileSync(f, out.toJPEG(88)); return `sky://gameart/${name}`;
  }
  async exists(url) { try { const r = await net.fetch(url, { method: "HEAD", headers: UA }); return r.ok; } catch (e) { return false; } }

  /* ---------- big, sharp logos ---------- */
  // The logo a Store / Xbox game ships with (e.g. Fortnite's Square480x480Logo.png), found next to its icon.
  packageLogo(p) {
    try {
      let iconFile = "";
      if (/\.lnk$/i.test(p)) iconFile = shell.readShortcutLink(p).icon || "";
      else if (/\.url$/i.test(p)) iconFile = ((fs.readFileSync(p, "utf8").match(/^IconFile=(.*)$/m) || [])[1] || "").trim();
      if (!iconFile || !/\\(XboxGames|WindowsApps)\\/i.test(iconFile)) return "";
      const dirs = [path.dirname(iconFile), path.join(path.dirname(iconFile), "Resources"), path.join(path.dirname(iconFile), "Assets"), path.dirname(path.dirname(iconFile))];
      for (const name of ["Square480x480Logo.png", "Square310x310Logo.png", "SplashScreen.png", "Logo.png", "Square150x150Logo.png", "Square150x150Logo.scale-200.png"])
        for (const d of dirs) {
          const f = path.join(d, name); if (!fs.existsSync(f)) continue;
          const img = nativeImage.createFromPath(f); if (img.isEmpty() || img.getSize().width < 140) continue;
          const out = path.join(this.dir, "logo-" + crypto.createHash("sha1").update(f).digest("hex").slice(0, 14) + ".png");
          if (!fs.existsSync(out)) fs.writeFileSync(out, (img.getSize().width > 512 ? img.resize({ width: 512, quality: "best" }) : img).toPNG());
          return `sky://gameart/${path.basename(out)}`;
        }
    } catch (e) {}
    return "";
  }
  // Windows' own 256 px icon for a file, shortcut or Start-menu app (what Explorer shows at "extra large").
  async bigIcon(p) {
    const name = "icon-" + crypto.createHash("sha1").update(String(p).toLowerCase()).digest("hex").slice(0, 14) + ".png", f = path.join(this.dir, name);
    if (fs.existsSync(f)) return `sky://gameart/${name}`;
    const b64 = await this.iconProc(p); if (!b64) return "";
    const img = nativeImage.createFromBuffer(Buffer.from(b64, "base64")); if (img.isEmpty()) return "";
    // tiny icons padded into a big frame look worse than the small one: keep only icons that fill most of it
    const { width, height } = img.getSize(), bmp = img.toBitmap(); let minX = width, maxX = 0;
    for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) if (bmp[(y * width + x) * 4 + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    if (maxX - minX < width * .45) return "";
    fs.writeFileSync(f, img.toPNG()); return `sky://gameart/${name}`;
  }
  iconProc(p) {
    if (process.platform !== "win32") return Promise.resolve("");
    if (!this.icons) {
      const src = fs.readFileSync(path.join(__dirname, "icons.ps1"), "utf8"), file = path.join(this.dataDir, "icons.ps1");
      try { if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== src) fs.writeFileSync(file, src, "utf8"); } catch (e) {}
      const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      const waiting = [];
      this.icons = { proc, waiting };
      readline.createInterface({ input: proc.stdout }).on("line", l => { const w = waiting.shift(); if (w) w(l.startsWith("!") || l === "-" ? "" : l); });
      proc.on("exit", () => { for (const w of waiting.splice(0)) w(""); this.icons = null; });
      proc.stdin.on("error", () => {});
      clearTimeout(this.iconsIdle);
    }
    clearTimeout(this.iconsIdle); this.iconsIdle = setTimeout(() => { if (this.icons) { try { this.icons.proc.stdin.end(); } catch (e) {} } }, 30000);   // quits when not needed
    return new Promise(res => { const t = setTimeout(() => res(""), 15000); this.icons.waiting.push(v => { clearTimeout(t); res(v); }); this.icons.proc.stdin.write(String(p).replace(/[\r\n]/g, "") + "\n"); });
  }

  /* ---------- the real icon behind a shortcut ---------- */
  async icon(p) {
    try {
      let iconFile = "", target = p;
      if (/\.lnk$/i.test(p)) { const l = shell.readShortcutLink(p); iconFile = l.icon || ""; target = l.target || p; }
      else if (/\.url$/i.test(p)) { const t = fs.readFileSync(p, "utf8"); iconFile = ((t.match(/^IconFile=(.*)$/m) || [])[1] || "").trim(); }
      for (const c of [iconFile, target]) {
        if (!c || !fs.existsSync(c)) continue;
        if (/\.(ico|png)$/i.test(c)) { const i = nativeImage.createFromPath(c); if (!i.isEmpty()) return i.resize({ width: 64, height: 64, quality: "best" }).toDataURL(); }
        if (/\.(exe|dll)$/i.test(c) || c === target) { const i = await app.getFileIcon(c, { size: "large" }); if (!i.isEmpty()) return i.toDataURL(); }
      }
    } catch (e) {}
    return "";
  }

  /* ---------- game covers ---------- */
  steamId(it) {
    let m = String(it.launch || "").match(/steam:\/\/rungameid\/(\d+)/); if (m) return m[1];
    if (/\.url$/i.test(it.path || "")) { try { m = fs.readFileSync(it.path, "utf8").match(/steam:\/\/rungameid\/(\d+)/); if (m) return m[1]; } catch (e) {} }
    return "";
  }
  epicCatalog() {
    if (this.epic !== undefined) return this.epic;
    this.epic = null;
    try {
      const b = fs.readFileSync(path.join(process.env.ProgramData || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Catalog", "catcache.bin"), "utf8");
      this.epic = JSON.parse(Buffer.from(b, "base64").toString("utf8"));
    } catch (e) {}
    return this.epic;
  }
  epicArt(it) {
    const cat = this.epicCatalog(); if (!cat) return null;
    let id = ""; const src = String(it.launch || "") + (/\.url$/i.test(it.path || "") ? (() => { try { return fs.readFileSync(it.path, "utf8"); } catch (e) { return ""; } })() : "");
    const m = decodeURIComponent(src).match(/com\.epicgames\.launcher:\/\/apps\/([^:\s]+):([0-9a-f]{32}):/i); if (m) id = m[2];
    const want = norm(gameName(it.name));
    const hit = cat.find(x => id && x.id === id) || cat.find(x => norm(x.title) === want && (x.keyImages || []).some(k => /DieselGameBox/.test(k.type)));
    if (!hit) return null;
    const img = t => ((hit.keyImages || []).find(k => k.type === t) || {}).url;
    return img("DieselGameBox") || img("Featured") || img("DieselGameBoxTall") || img("Thumbnail");
  }
  async steamSearch(name) {
    const j = await this.get(`https://store.steampowered.com/api/storesearch/?${new URLSearchParams({ term: name, l: "english", cc: "US" })}`, true);
    const want = norm(name);
    const hit = (j.items || []).find(x => norm(x.name) === want) || (j.items || []).find(x => sameGame(name, x.name));
    return hit ? String(hit.id) : "";
  }
  async wikiArt(name) {
    const j = await this.get(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", generator: "search", gsrsearch: name + " video game", gsrlimit: "4",
      prop: "pageimages", piprop: "thumbnail", pithumbsize: "800", pilicense: "any", format: "json", origin: "*" })}`, true);
    // only the article that IS the game ("Minecraft", "Valorant (video game)"), never a sequel or the company
    const want = norm(name), pages = Object.values((j.query || {}).pages || {}).sort((a, b) => a.index - b.index);
    const hit = pages.find(p => p.thumbnail && norm(p.title).replace(/ (video )?game$/, "") === want);
    return hit ? hit.thumbnail.source : "";
  }
  steamUrls(id) { return [`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`, `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`]; }

  // -> { art, logo, icon, netFail } for a library item (any may be "")
  async resolve(it) { return { ...(await this.local(it)), ...(await this.cover(it)) }; }
  async local(it) {   // instant, from this PC: the icon and the big logo
    const out = { logo: "", icon: "" };
    if (it.kind === "local" && it.path) {
      out.icon = await this.icon(it.path);
      out.logo = this.packageLogo(it.path) || await this.bigIcon(it.path).catch(() => "");
    }
    return out;
  }
  async cover(it) {   // from the internet: the game's cover art
    const out = { art: "", netFail: false };
    if (it.kind !== "local" || isApp(it)) return out;   // apps keep their own logo
    const name = gameName(it.name), tries = [];
    const sid = this.steamId(it); if (sid) tries.push(...this.steamUrls(sid));
    const epic = this.epicArt(it); if (epic) tries.push(epic);
    const fail = e => { if (e.net || /fetch|network|ENOTFOUND|ECONN|ETIMEDOUT/i.test(e.message)) out.netFail = true; };
    for (const u of tries) { try { out.art = await this.cache(u, "game:" + u); return out; } catch (e) { fail(e); } }
    try { const id = await this.steamSearch(name); if (id) for (const u of this.steamUrls(id)) { try { out.art = await this.cache(u, "game:" + u); return out; } catch (e) { fail(e); } } } catch (e) { fail(e); }
    try { const w = await this.wikiArt(name); if (w) out.art = await this.cache(w, "game:" + w); } catch (e) { fail(e); }
    return out;
  }
  async fromFile(p) {   // "Change picture…"
    const img = nativeImage.createFromPath(p); if (img.isEmpty()) throw new Error("That file isn't a picture Skyline can read");
    const name = "own-" + Date.now().toString(36) + ".jpg";
    fs.writeFileSync(path.join(this.dir, name), (img.getSize().width > 920 ? img.resize({ width: 920, quality: "good" }) : img).toJPEG(88));
    return `sky://gameart/${name}`;
  }

  serveArt(rel) {
    if (!/^[\w-]+\.(jpg|png)$/.test(rel)) return null;
    const f = path.join(this.dir, rel); if (!fs.existsSync(f)) return null;
    return new Response(fs.readFileSync(f), { headers: { "content-type": rel.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "max-age=604800" } });
  }
}

module.exports = { Art, gameName, norm, isApp, sameGame };
