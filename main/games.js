// Games: AI-built projects, your game library, launching, finding games on this PC and the web,
// exporting, and serving built games to the sandboxed player (sky://play/<id>/...).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { app, ipcMain, dialog, shell, net, nativeImage, BrowserWindow } = require("electron");
const { AI } = require("./ai");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".md": "text/plain", ".csv": "text/plain", ".glsl": "text/plain", ".jpg": "image/jpeg", ".png": "image/png" };
// Built games may only use what's inside them: no network, no popups, no navigation.
const GAME_CSP = "default-src 'self' sky: 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self' sky: data: blob:; img-src 'self' sky: data: blob:; " +
  "media-src 'self' sky: data: blob:; font-src 'self' sky: data:; worker-src 'self' sky: blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
const VENDOR = path.join(__dirname, "vendor");
const SHIM = path.join(__dirname, "..", "renderer", "js", "game-shim.js");
const newId = p => p + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const safeName = s => String(s || "Game").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 60) || "Game";

class Games {
  constructor(dataDir, art) {
    this.art = art; this.arting = new Set();
    this.dir = path.join(dataDir, "games");
    this.libFile = path.join(dataDir, "library.json");
    this.ai = new AI(dataDir);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /* ---------- projects (AI-built games) ---------- */
  pdir(id) { if (!/^g[\w]+$/.test(id)) throw new Error("Bad game id"); return path.join(this.dir, id); }
  meta(id) { return JSON.parse(fs.readFileSync(path.join(this.pdir(id), "meta.json"), "utf8")); }
  writeMeta(id, m) { fs.writeFileSync(path.join(this.pdir(id), "meta.json"), JSON.stringify(m, null, 1), "utf8"); }
  files(id) {
    const d = path.join(this.pdir(id), "files"), out = {};
    const walk = (rel) => { for (const f of fs.readdirSync(path.join(d, rel), { withFileTypes: true })) {
      const r = rel ? rel + "/" + f.name : f.name;
      if (f.isDirectory()) walk(r); else out[r] = fs.readFileSync(path.join(d, r), "utf8");
    } };
    try { walk(""); } catch (e) {}
    return out;
  }
  writeFiles(id, files, replace) {
    const d = path.join(this.pdir(id), "files");
    if (replace) fs.rmSync(d, { recursive: true, force: true });
    for (const [p, t] of Object.entries(files)) { const f = path.join(d, p); if (!f.startsWith(d)) continue; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); }
  }
  snapshot(id) {   // keep the version before each AI change, so it can be undone
    const h = path.join(this.pdir(id), "history"); fs.mkdirSync(h, { recursive: true });
    const n = Date.now().toString(); fs.writeFileSync(path.join(h, n + ".json"), JSON.stringify({ files: this.files(id), meta: this.meta(id) }), "utf8");
    const all = fs.readdirSync(h).sort(); while (all.length > 25) fs.unlinkSync(path.join(h, all.shift()));
  }
  undo(id) {
    const h = path.join(this.pdir(id), "history"); let all = []; try { all = fs.readdirSync(h).sort(); } catch (e) {}
    if (!all.length) throw new Error("Nothing to undo");
    const last = all.pop(), snap = JSON.parse(fs.readFileSync(path.join(h, last), "utf8")); fs.unlinkSync(path.join(h, last));
    this.writeFiles(id, snap.files, true);
    const m = this.meta(id); m.name = snap.meta.name; m.genre = snap.meta.genre; m.description = snap.meta.description; m.modified = Date.now();
    m.chat = (m.chat || []).concat({ role: "note", text: "Undid the last AI change", at: Date.now() }); m.undo = all.length;
    this.writeMeta(id, m); return this.project(id);
  }
  list() {
    const out = [];
    for (const id of fs.readdirSync(this.dir)) { try { const m = this.meta(id); out.push({ ...m, chat: undefined, thumb: fs.existsSync(path.join(this.pdir(id), "thumb.jpg")) ? `sky://play/${id}/__thumb.jpg?v=${m.modified}` : "" }); } catch (e) {} }
    return out.sort((a, b) => b.modified - a.modified);
  }
  project(id) {
    const m = this.meta(id);
    return { meta: { ...m, thumb: fs.existsSync(path.join(this.pdir(id), "thumb.jpg")) ? `sky://play/${id}/__thumb.jpg?v=${m.modified}` : "" }, files: this.files(id) };
  }
  create(result, request, options) {
    const id = newId("g"); fs.mkdirSync(path.join(this.pdir(id), "files"), { recursive: true });
    const now = Date.now(), m = result.meta || {};
    this.writeMeta(id, { id, name: safeName(m.name || "New game"), genre: m.genre || options.type || "Other", description: m.description || request.slice(0, 160),
      style: options.style || "", difficulty: options.difficulty || "", created: now, modified: now, saved: false, undo: 0,
      chat: [{ role: "user", text: request, at: now }, { role: "ai", text: result.summary, at: now }], requests: [request] });
    this.writeFiles(id, result.files, true);
    return id;
  }
  async buildJob(sender, { jobId, mode, id, request, options, error }) {
    const progress = p => { if (!sender.isDestroyed()) sender.send("ai:progress", { jobId, ...p }); };
    const files = mode === "create" ? null : this.files(id);
    const prev = mode === "create" ? null : this.meta(id);
    const history = prev ? prev.requests || [] : [];
    const result = await this.ai.build({ jobId, request, files, history, options, error }, progress);
    if (mode === "create") { const nid = this.create(result, request, options || {}); return { id: nid, summary: result.summary }; }
    if (mode === "regenerate") {   // a fresh take on the same idea, keeping the project
      this.snapshot(id); this.writeFiles(id, result.files, true);
    } else {
      if (!Object.keys(result.files).length) {   // nothing changed (e.g. a declined change): keep the game, record the answer
        const m = this.meta(id); m.chat = (m.chat || []).concat({ role: "user", text: request || "Fix the error", at: Date.now() }, { role: "ai", text: result.summary || "No changes.", at: Date.now() });
        this.writeMeta(id, m); return { id, summary: result.summary, unchanged: true };
      }
      this.snapshot(id); this.writeFiles(id, result.files, false);
    }
    const m = this.meta(id), now = Date.now(), r = result.meta || {};
    if (r.name && mode === "regenerate") m.name = safeName(r.name);
    if (r.genre) m.genre = r.genre; if (r.description) m.description = r.description;
    m.modified = now; m.undo = (m.undo || 0) + 1;
    const said = mode === "fix" ? "Fix this error: " + String(error || "").slice(0, 200) : mode === "regenerate" ? "Make a fresh version of this game" : request;
    m.chat = (m.chat || []).concat({ role: "user", text: said, at: now }, { role: "ai", text: result.summary, at: now });
    m.requests = (m.requests || []).concat(said).slice(-40);
    this.writeMeta(id, m);
    return { id, summary: result.summary };
  }

  serve(rel) {   // sky://play/<id>/<path>
    const [id, ...rest] = rel.split("/"); let p = rest.join("/") || "index.html";
    let file;
    if (p === "__sky.js") file = SHIM;
    else if (p === "__thumb.jpg") file = path.join(this.pdir(id), "thumb.jpg");
    else if (p === "lib/three.module.js" || p === "lib/three.core.js") file = path.join(VENDOR, p.slice(4));
    else { const d = path.join(this.pdir(id), "files"); file = path.normalize(path.join(d, p)); if (!file.startsWith(d)) return null; }
    let body = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();
    if (p === "index.html") {   // the player's helper goes first: pause/resume, error reports, safe storage
      let html = body.toString("utf8"); const tag = `<script src="__sky.js" crossorigin="anonymous"></script>`;
      html = html.replace(/<script(?![^>]*\bcrossorigin\b)(?=[^>]*\ssrc=)/gi, '<script crossorigin="anonymous"');
      body = Buffer.from(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html, "utf8");
    }
    return new Response(body, { headers: { "content-type": (MIME[ext] || "application/octet-stream") + (/text|javascript|json|svg/.test(MIME[ext] || "") ? "; charset=utf-8" : ""),
      "content-security-policy": GAME_CSP, "access-control-allow-origin": "*", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }

  async thumb(win, id, rect) {
    const img = await win.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 480, quality: "good" });
    fs.writeFileSync(path.join(this.pdir(id), "thumb.jpg"), small.toJPEG(82));
    const m = this.meta(id); m.modified = m.modified || Date.now(); this.writeMeta(id, m);
    return `sky://play/${id}/__thumb.jpg?v=${Date.now()}`;
  }

  async export(win, id, mode) {
    const m = this.meta(id), files = this.files(id), name = safeName(m.name);
    const usesThree = Object.values(files).some(t => /lib\/three\.module\.js/.test(t));
    if (mode === "html" && !usesThree) {
      let html = files["index.html"] || "<!doctype html><html><head></head><body></body></html>";
      html = html.replace(/<link[^>]+href=["']\.?\/?style\.css["'][^>]*>/i, () => `<style>\n${files["style.css"] || ""}\n</style>`);
      html = html.replace(/<script([^>]*)src=["']\.?\/?script\.js["']([^>]*)><\/script>/i, (s, a, b) => `<script${(a + b).replace(/\s+src=["'][^"']*["']/, "")}>\n${(files["script.js"] || "").replace(/<\/script/gi, "<\\/script")}\n</script>`);
      const r = await dialog.showSaveDialog(win, { title: "Export game as one HTML file", defaultPath: path.join(app.getPath("documents"), name + ".html"), filters: [{ name: "Web page", extensions: ["html"] }] });
      if (r.canceled || !r.filePath) return null;
      fs.writeFileSync(r.filePath, html, "utf8"); shell.showItemInFolder(r.filePath); return r.filePath;
    }
    const r = await dialog.showOpenDialog(win, { title: "Choose where to export the game project", defaultPath: app.getPath("documents"), properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    let dest = path.join(r.filePaths[0], name), n = 2; while (fs.existsSync(dest)) dest = path.join(r.filePaths[0], `${name} ${n++}`);
    fs.mkdirSync(path.join(dest, "assets"), { recursive: true });
    for (const [p, t] of Object.entries(files)) { const f = path.join(dest, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); }
    if (usesThree) { fs.mkdirSync(path.join(dest, "lib"), { recursive: true }); for (const f of ["three.module.js", "three.core.js"]) fs.copyFileSync(path.join(VENDOR, f), path.join(dest, "lib", f)); }
    fs.writeFileSync(path.join(dest, "README.txt"), `${m.name}\n\n${m.description || ""}\n\nOpen index.html in a browser to play.${usesThree ? "\nThis game uses three.js (in lib/). Some browsers block modules from local files: if it stays blank, run a local web server in this folder (for example: npx serve)." : ""}\n\nMade with Skyline's AI Game Builder.\n`, "utf8");
    shell.openPath(dest); return dest;
  }

  /* ---------- library: browser, local and web games ---------- */
  lib() { try { return JSON.parse(fs.readFileSync(this.libFile, "utf8")); } catch (e) { return []; } }
  saveLib(l) { fs.writeFileSync(this.libFile, JSON.stringify(l, null, 1), "utf8"); }
  addLib(items) {
    const l = this.lib(), added = [];
    for (const it of [].concat(items)) {
      const key = it.path || it.launch || it.url || it.projectId;
      if (!key || l.some(x => (x.path || x.launch || x.url || x.projectId) === key)) continue;
      const item = { id: newId("l"), kind: ["local", "web", "browser"].includes(it.kind) ? it.kind : "web", name: String(it.name || "Game").slice(0, 80),
        description: String(it.description || "").slice(0, 300), platform: String(it.platform || "").slice(0, 40), source: String(it.source || "").slice(0, 40),
        genre: String(it.genre || "").slice(0, 40), thumb: String(it.thumb || "").slice(0, 200000), url: it.url || "", path: it.path || "", launch: it.launch || "",
        projectId: it.projectId || "", added: Date.now(), played: 0 };
      l.push(item); added.push(item);
    }
    this.saveLib(l); this.fillArt(added.map(x => x.id)); return added;
  }
  // Real covers and icons, fetched in the background; the page is told when each one arrives.
  // (artV 2: the cover was checked with the stricter rules; older ones get one more look)
  async fillArt(ids, force) {
    if (!this.art) return;
    const todo = ids.filter(id => { if (this.arting.has(id)) return false; const it = this.lib().find(x => x.id === id); return it && it.kind === "local" && !(it.artTried && it.artV === 2 && !force) && !it.artOwn; });
    todo.forEach(id => this.arting.add(id));
    const update = (id, fn) => { const l = this.lib(), cur = l.find(x => x.id === id); if (!cur) return; fn(cur); this.saveLib(l); if (this.notify) this.notify(cur); };
    // first what's on this PC (instant), then covers from the internet, three games at a time
    for (const id of todo) { const it = this.lib().find(x => x.id === id); try { const r = await this.art.local(it); update(id, c => { if (r.logo) c.logo = r.logo; if (r.icon) c.icon = r.icon; }); } catch (e) {} }
    const queue = todo.slice();
    const worker = async () => { for (let id; (id = queue.shift());) {
      try { const it = this.lib().find(x => x.id === id); if (!it) continue; const r = await this.art.cover(it);
        update(id, c => { if (r.art || !r.netFail) { c.art = r.art || ""; c.artTried = Date.now(); c.artV = 2; } else c.artRetry = Date.now(); });   // offline / rate-limited: try again next start
      } catch (e) {} finally { this.arting.delete(id); } } };
    await Promise.all([worker(), worker(), worker()]);
  }
  async launch(id) {
    const l = this.lib(), it = l.find(x => x.id === id); if (!it) throw new Error("That game isn't in your library any more");
    it.played = Date.now(); this.saveLib(l);
    if (it.launch) {   // Steam / Epic: their own launchers start the game
      if (!/^(steam:\/\/rungameid\/\d+|com\.epicgames\.launcher:\/\/apps\/[\w%.:-]+\?action=launch&silent=true)$/.test(it.launch)) throw new Error("Unsupported launcher link");
      await shell.openExternal(it.launch); return { ok: true };
    }
    if (it.path) {
      if (!fs.existsSync(it.path)) throw new Error("Couldn't find it any more: " + it.path);
      const err = await shell.openPath(it.path); if (err) throw new Error(err); return { ok: true };
    }
    throw new Error("This game opens in the browser");
  }

  async fileIcon(p) { try { const i = await app.getFileIcon(p, { size: "large" }); return i.isEmpty() ? "" : i.toDataURL(); } catch (e) { return ""; } }

  async pickLocal(win) {
    const r = await dialog.showOpenDialog(win, { title: "Add a game from this PC", properties: ["openFile", "multiSelections"],
      filters: [{ name: "Games and shortcuts", extensions: ["exe", "lnk", "url", "bat"] }] });
    if (r.canceled) return [];
    const items = [];
    for (const p of r.filePaths) items.push({ kind: "local", name: path.basename(p).replace(/\.(exe|lnk|url|bat)$/i, ""), path: p, source: "This PC", platform: "Windows", thumb: await this.fileIcon(p) });
    return this.addLib(items);
  }

  // Games already on this PC: Steam and Epic libraries, and shortcuts on the desktop / in the Start menu.
  async scanLocal() {
    const found = [], seen = new Set();
    const add = it => { it.name = it.name.replace(/\s*\(\d+\)$/, ""); const k = it.name.toLowerCase(); if (seen.has(k) || /localsend|nzxt|wallpaper engine|soundpad|dedicated server|\bsdk\b|benchmark/i.test(it.name)) return; seen.add(k); found.push(it); };
    // Steam
    const steamRoots = [path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"), path.join(process.env.ProgramFiles || "C:\\Program Files", "Steam")];
    for (const root of steamRoots) {
      const vdf = path.join(root, "steamapps", "libraryfolders.vdf"); if (!fs.existsSync(vdf)) continue;
      const libs = [...fs.readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)].map(m => m[1].replace(/\\\\/g, "\\"));
      for (const lib of libs.length ? libs : [root]) {
        const apps = path.join(lib, "steamapps"); let names = []; try { names = fs.readdirSync(apps).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch (e) {}
        for (const f of names) {
          const t = fs.readFileSync(path.join(apps, f), "utf8"), appid = (t.match(/"appid"\s+"(\d+)"/) || [])[1], name = (t.match(/"name"\s+"([^"]+)"/) || [])[1];
          if (!appid || !name || /Steamworks|Redistributable|Proton|Runtime/i.test(name)) continue;
          add({ kind: "local", name, source: "Steam", platform: "Windows", launch: `steam://rungameid/${appid}`, thumb: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg` });
        }
      }
    }
    // Epic Games
    const epic = path.join(process.env.ProgramData || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
    try {
      for (const f of fs.readdirSync(epic).filter(f => f.endsWith(".item"))) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(epic, f), "utf8"));
          if (!j.DisplayName || !j.AppName || !j.CatalogNamespace || (j.AppCategories || []).every(c => c !== "games")) continue;
          const exe = j.InstallLocation && j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : "";
          add({ kind: "local", name: j.DisplayName, source: "Epic Games", platform: "Windows", thumb: exe ? await this.fileIcon(exe) : "",
            launch: `com.epicgames.launcher://apps/${encodeURIComponent(j.CatalogNamespace)}%3A${encodeURIComponent(j.CatalogItemId)}%3A${encodeURIComponent(j.AppName)}?action=launch&silent=true` });
        } catch (e) {}
      }
    } catch (e) {}
    // Shortcuts that look like games
    const skip = /uninstall|readme|help|manual|website|support|settings|config|updat|discord|chrome|edge|firefox|opera|brave|spotify|grammarly|signalrgb|remouse|tiktok|capcut|wallpaper|steamtools|streamclipper|jarvis|skyline|visual studio|\bvs ?code\b|terminal|powershell|command prompt|notepad|office|word|excel|outlook|powerpoint|onedrive|dropbox|\bteams\b|\bzoom\b|slack|\bobs\b|nvidia|geforce|\bamd\b|radeon|logitech|corsair|razer|7-zip|winrar|adobe|photoshop|premiere|after effects|blackmagic|davinci|cpu-?z|cpuid|gpu-?z|hwmonitor|msi afterburner|\bgcc\b|python|node\.js|\bgit\b|\bvpn\b|redeem|driver|calculator|control panel|audacity|\bvlc\b|media player|\bpaint\b|snipping|clipchamp|camera|photos|ryujinx|cemu|yuzu|dolphin|emulator|wii u|usb helper|optimizer|mod manager|tkmm|ferium|geode|modrinth|curseforge|packfever|\bproton\b/i;
    const dirs = [app.getPath("desktop"), path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"),
      path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"), path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs")];
    const gameHint = /\bgames?\b|steam|epic games|riot|battle\.net|ubisoft|ea app|rockstar|xbox|minecraft|roblox|fortnite|valorant|league of legends|five nights/i;
    for (const d of dirs) {
      const walk = (dir, depth) => { let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of ents) {
          const p = path.join(dir, e.name);
          if (e.isDirectory() && depth < 2) { walk(p, depth + 1); continue; }
          if (!/\.(lnk|url)$/i.test(e.name) || skip.test(e.name)) continue;
          const fromStart = /Start Menu/i.test(dir);
          if (fromStart && !gameHint.test(dir + e.name)) continue;   // the Start menu holds everything: only keep likely games
          let target = p;
          if (/\.lnk$/i.test(e.name)) { try { target = shell.readShortcutLink(p).target || p; } catch (er) {} }
          if (/\.url$/i.test(e.name)) { try { const u = (fs.readFileSync(p, "utf8").match(/^URL=(.*)$/m) || [])[1] || ""; if (/^https?:/i.test(u)) continue; } catch (er) {} }
          add({ kind: "local", name: e.name.replace(/\.(lnk|url)$/i, ""), path: p, source: fromStart ? "Start menu" : "Desktop", platform: "Windows", _icon: target });
        } };
      walk(d, 0);
    }
    for (const it of found) if (it._icon) { it.thumb = (this.art && await this.art.icon(it.path)) || await this.fileIcon(it._icon); delete it._icon; }
    const have = new Set(this.lib().map(x => (x.path || x.launch || "").toLowerCase()));
    return found.map(it => ({ ...it, inLibrary: have.has((it.path || it.launch || "").toLowerCase()) })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ---------- finding games on the web (itch.io browser games, FreeToGame) ---------- */
  async webSearch(q, source) {
    q = String(q || "").trim().slice(0, 80);
    const get = async (u, json) => { const r = await net.fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Skyline/1.0" } }); if (!r.ok) throw new Error("HTTP " + r.status); return json ? r.json() : r.text(); };
    const out = [];
    if (source !== "freetogame") {
      try {
        const html = await get(`https://itch.io/search?${new URLSearchParams({ q: q || "browser game", classification: "game", platform: "web" })}`);
        const cells = html.split(/<div[^>]*class="game_cell[ "]/).slice(1, 31);
        for (const c of cells) {
          const url = (c.match(/class="title game_link"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="title game_link"/) || []).slice(1).find(Boolean);
          const title = (c.match(/class="title game_link"[^>]*>([^<]+)</) || [])[1];
          if (!url || !title || !/^https:\/\/[\w-]+\.itch\.io\//.test(url)) continue;
          const img = (c.match(/data-lazy_src="([^"]+)"/) || c.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
          const text = (c.match(/class="game_text"[^>]*>([^<]*)</) || [])[1] || "", genre = (c.match(/class="game_genre"[^>]*>([^<]*)</) || [])[1] || "";
          const author = (c.match(/class="game_author"[^>]*><a[^>]*>([^<]*)</) || [])[1] || "";
          const price = (c.match(/class="price_value"[^>]*>([^<]*)</) || [])[1] || "";
          out.push({ kind: "web", name: unesc(title), description: unesc(text) || (author ? "by " + unesc(author) : ""), genre: unesc(genre), source: "itch.io",
            platform: "Browser" + (price ? " · " + price : " · Free"), url, thumb: /^https:\/\/img\.itch\.zone\//.test(img) ? img : "" });
        }
      } catch (e) { out.push({ error: "itch.io didn't answer: " + e.message }); }
    }
    if (source !== "itch") {
      try {
        if (!this.f2p || Date.now() - this.f2pAt > 864e5) { this.f2p = await get("https://www.freetogame.com/api/games", true); this.f2pAt = Date.now(); }
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        const hits = this.f2p.filter(g => { const s = `${g.title} ${g.genre} ${g.short_description}`.toLowerCase(); return words.every(w => s.includes(w)); })
          .sort((a, b) => (/browser/i.test(b.platform) - /browser/i.test(a.platform)) || (a.title.toLowerCase().startsWith(words[0] || "") ? -1 : 1)).slice(0, 24);
        for (const g of hits) out.push({ kind: "web", name: g.title, description: g.short_description, genre: g.genre, source: "FreeToGame",
          platform: /browser/i.test(g.platform) ? "Browser · Free" : "PC · Free to play", url: g.freetogame_profile_url || g.game_url, thumb: g.thumbnail });
      } catch (e) { out.push({ error: "FreeToGame didn't answer: " + e.message }); }
    }
    return out;
  }

  install(getWin) {
    const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));
    h("games:list", () => ({ projects: this.list(), library: this.lib() }));
    h("games:project", (e, id) => this.project(id));
    h("games:update", (e, id, patch) => {
      const m = this.meta(id);
      if (patch.name != null) m.name = safeName(patch.name);
      if (patch.saved != null) m.saved = !!patch.saved;
      if (patch.files) { this.snapshot(id); this.writeFiles(id, patch.files, false); m.undo = (m.undo || 0) + 1; }
      m.modified = Date.now(); this.writeMeta(id, m); return this.project(id);
    });
    h("games:duplicate", (e, id) => {
      const nid = newId("g"); fs.cpSync(path.join(this.pdir(id), "files"), path.join(this.pdir(nid), "files"), { recursive: true });
      try { fs.copyFileSync(path.join(this.pdir(id), "thumb.jpg"), path.join(this.pdir(nid), "thumb.jpg")); } catch (er) {}
      const m = this.meta(id), now = Date.now();
      this.writeMeta(nid, { ...m, id: nid, name: safeName(m.name + " copy"), created: now, modified: now, undo: 0 }); return nid;
    });
    h("games:delete", (e, id) => { fs.rmSync(this.pdir(id), { recursive: true, force: true }); this.saveLib(this.lib().filter(x => x.projectId !== id)); return true; });
    h("games:undo", (e, id) => this.undo(id));
    h("games:thumb", (e, id, rect) => this.thumb(BrowserWindow.fromWebContents(e.sender), id, rect));
    h("games:export", (e, id, mode) => this.export(BrowserWindow.fromWebContents(e.sender), id, mode));
    h("games:build", (e, job) => this.buildJob(e.sender, job));
    h("games:cancel", (e, jobId) => this.ai.cancel(jobId));
    h("lib:add", (e, items) => this.addLib(items));
    h("lib:remove", (e, id) => { this.saveLib(this.lib().filter(x => x.id !== id)); return true; });
    h("lib:art", (e, ids, force) => { this.fillArt(ids && ids.length ? ids : this.lib().map(x => x.id), !!force); return true; });
    h("lib:setArt", async (e, id, mode) => {
      const l = this.lib(), it = l.find(x => x.id === id); if (!it) throw new Error("That game isn't in your library any more");
      if (mode === "reset") { delete it.art; delete it.logo; delete it.artOwn; delete it.artTried; this.saveLib(l); await this.fillArt([id], true); return this.lib().find(x => x.id === id); }
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: `Choose a picture for ${it.name}`, properties: ["openFile"], filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      it.art = await this.art.fromFile(r.filePaths[0]); it.artOwn = true; this.saveLib(l); return it;
    });
    h("lib:rename", (e, id, name) => { const l = this.lib(), it = l.find(x => x.id === id); if (!it) return null; it.name = String(name || it.name).slice(0, 80); this.saveLib(l); return it; });
    h("lib:launch", (e, id) => this.launch(id));
    h("lib:pick", e => this.pickLocal(BrowserWindow.fromWebContents(e.sender)));
    h("lib:scan", () => this.scanLocal());
    h("web:search", (e, q, src) => this.webSearch(q, src));
    h("web:open", (e, url) => { if (!/^https:\/\/[^\s]+$/i.test(String(url || ""))) throw new Error("Only https web addresses can be opened"); return shell.openExternal(url); });
    h("ai:status", force => this.ai.fullStatus(!!force));
    h("ai:allowLocal", (e, on) => this.ai.setAllowLocal(!!on));
    h("ai:setKey", (e, key) => this.ai.setKey(key));
    h("ai:clearKey", () => this.ai.clearKey());
    h("ai:setModel", (e, m) => this.ai.setModel(m));
    h("ai:test", () => this.ai.test());
  }
}
function unesc(s) { return String(s || "").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(); }

module.exports = { Games };
