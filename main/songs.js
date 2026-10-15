// Songs: music you add to Skyline (files and folders from this PC), played by Skyline itself, plus
// finding any song (Apple's free catalog search) and playing it on YouTube or opening it in Spotify.
// Files stay where they are: Skyline keeps a list, the tags and a small copy of each cover.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { app, ipcMain, dialog, shell, net, BrowserWindow, nativeImage } = require("electron");

const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|webm|mp4)$/i;
const TYPE = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".webm": "audio/webm" };
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Skyline/1.0" };
let mm = null;
const tags = async () => mm || (mm = await import("music-metadata"));

class Songs {
  constructor(dataDir) {
    this.file = path.join(dataDir, "songs.json");
    this.covers = path.join(dataDir, "covers");
    fs.mkdirSync(this.covers, { recursive: true });
    this.cache = null;
  }
  list() { if (!this.cache) { try { this.cache = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { this.cache = []; } } return this.cache; }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.cache || [], null, 1), "utf8"); }
  find(id) { return this.list().find(s => s.id === id); }

  // Adds files and whole folders (up to a few thousand songs at once). Returns the songs that were new.
  async add(paths, onProgress) {
    const files = [];
    const walk = (p, depth) => {
      let st; try { st = fs.statSync(p); } catch (e) { return; }
      if (st.isDirectory()) { if (depth > 6) return; let ents = []; try { ents = fs.readdirSync(p); } catch (e) {} for (const f of ents) { if (files.length > 4000) return; walk(path.join(p, f), depth + 1); } }
      else if (AUDIO.test(p) && st.size > 20000) files.push(p);
    };
    for (const p of [].concat(paths || [])) if (typeof p === "string" && path.isAbsolute(p)) walk(p, 0);
    const list = this.list(), have = new Set(list.map(s => s.path.toLowerCase())), added = [];
    const { parseFile } = await tags();
    let n = 0;
    for (const f of files) {
      n++; if (onProgress && n % 10 === 0) onProgress(n, files.length);
      if (have.has(f.toLowerCase())) continue;
      const id = "s" + crypto.createHash("sha1").update(f.toLowerCase()).digest("hex").slice(0, 14);
      const s = { id, path: f, title: path.basename(f).replace(AUDIO, "").replace(/[_]+/g, " ").trim(), artist: "", album: "", dur: 0, art: false, added: Date.now(), plays: 0 };
      try {
        const m = await parseFile(f, { duration: true, skipPostHeaders: true });
        const c = m.common || {};
        if (c.title) s.title = String(c.title).slice(0, 200);
        s.artist = String(c.artist || (c.artists || [])[0] || "").slice(0, 200); s.album = String(c.album || "").slice(0, 200);
        s.dur = Math.round((m.format || {}).duration || 0);
        const pic = (c.picture || [])[0];
        if (pic && pic.data && pic.data.length > 200) {
          const img = nativeImage.createFromBuffer(Buffer.from(pic.data));
          if (!img.isEmpty()) { const sz = img.getSize(), small = sz.width > 600 ? img.resize({ width: 600, quality: "good" }) : img;
            fs.writeFileSync(path.join(this.covers, id + ".jpg"), small.toJPEG(86)); s.art = true; }
        }
      } catch (e) {}
      if (!s.artist) { const m = s.title.match(/^(.+?)\s+-\s+(.+)$/); if (m) { s.artist = m[1]; s.title = m[2]; } }
      list.push(s); have.add(f.toLowerCase()); added.push(s);
    }
    this.save();
    return added;
  }
  remove(ids) {
    const set = new Set([].concat(ids));
    this.cache = this.list().filter(s => { if (!set.has(s.id)) return true; try { fs.unlinkSync(path.join(this.covers, s.id + ".jpg")); } catch (e) {} return false; });
    this.save(); return true;
  }
  played(id) { const s = this.find(id); if (s) { s.plays = (s.plays || 0) + 1; s.last = Date.now(); this.save(); } return true; }

  // sky://song/<id> streams the file (with ranges, so seeking works); sky://song/<id>.jpg is its cover
  serve(rel, req) {
    const m = rel.match(/^(s[0-9a-f]{14})(\.jpg)?$/); if (!m) return null;
    if (m[2]) { const f = path.join(this.covers, m[1] + ".jpg"); return fs.existsSync(f) ? new Response(fs.readFileSync(f), { headers: { "content-type": "image/jpeg", "cache-control": "max-age=86400", "access-control-allow-origin": "*" } }) : null; }
    const s = this.find(m[1]); if (!s || !fs.existsSync(s.path)) return null;
    const size = fs.statSync(s.path).size, type = TYPE[path.extname(s.path).toLowerCase()] || "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
    let start = 0, end = size - 1, status = 200;
    if (range) { start = range[1] ? +range[1] : Math.max(0, size - +range[2]); end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1; status = 206; }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(s.path, { start, end }));
    const headers = { "content-type": type, "accept-ranges": "bytes", "content-length": String(end - start + 1), "cache-control": "no-store" };
    if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    return new Response(body, { status, headers });
  }

  async pick(win, folder) {
    const r = await dialog.showOpenDialog(win, folder
      ? { title: "Add a music folder", properties: ["openDirectory", "multiSelections"] }
      : { title: "Add songs", properties: ["openFile", "multiSelections"], filters: [{ name: "Music", extensions: ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "webm"] }] });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths;
  }

  /* ---------- any song in the world ---------- */
  async search(q) {
    q = String(q || "").trim().slice(0, 100); if (!q) return [];
    const r = await net.fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: q, media: "music", entity: "song", limit: "24" })}`, { headers: UA });
    if (!r.ok) throw new Error("The song search didn't answer (" + r.status + ")");
    const j = await r.json();
    return (j.results || []).map(x => ({ title: x.trackName, artist: x.artistName, album: x.collectionName, dur: Math.round((x.trackTimeMillis || 0) / 1000),
      art: String(x.artworkUrl100 || "").replace(/100x100bb/, "600x600bb"), year: String(x.releaseDate || "").slice(0, 4), genre: x.primaryGenreName || "", explicit: x.trackExplicitness === "explicit" }))
      .filter(x => x.title && x.artist);
  }
  // Plays a song on YouTube: finds the top video for "<title> <artist>" and opens it in the browser.
  async youtube(q) {
    q = String(q || "").trim().slice(0, 140); if (!q) throw new Error("Which song?");
    let url = `https://www.youtube.com/results?${new URLSearchParams({ search_query: q })}`;
    try {
      const html = await (await net.fetch(url, { headers: { ...UA, "Accept-Language": "en-US,en;q=0.9" } })).text();
      const id = (html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/) || html.match(/"videoId":"([\w-]{11})"/) || [])[1];
      if (id) url = `https://www.youtube.com/watch?v=${id}`;
    } catch (e) {}
    await shell.openExternal(url); return url;
  }
  /* ---------- Spotify, with no setup at all ---------- */
  // Is the Spotify app on this PC? (its spotify: links open it)
  hasSpotify() {
    if (this.spotifyApp != null) return this.spotifyApp;
    let ok = fs.existsSync(path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe"));
    if (!ok) { try { require("child_process").execFileSync("reg", ["query", "HKCU\\Software\\Classes\\spotify"], { windowsHide: true, stdio: "ignore" }); ok = true; } catch (e) {} }
    return (this.spotifyApp = ok);
  }
  // The song's Spotify id, found with an ordinary web search (no account, no developer app), named via Spotify's public preview.
  async findOnSpotify(q) {
    const ids = [], browser = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" };
    for (const u of [`https://html.duckduckgo.com/html/?${new URLSearchParams({ q: q + " site:open.spotify.com/track" })}`,
                     `https://www.bing.com/search?${new URLSearchParams({ q: q + " site:open.spotify.com/track", setlang: "en", cc: "US" })}`]) {
      try { const h = await (await net.fetch(u, { headers: browser })).text();
        for (const m of h.matchAll(/open\.spotify\.com(?:%2F|\/)(?:intl-[a-z]{2}(?:%2F|\/))?track(?:%2F|\/)([A-Za-z0-9]{22})/g)) if (!ids.includes(m[1])) ids.push(m[1]);
      } catch (e) {}
      if (ids.length >= 3) break;
    }
    const out = [];
    for (const id of ids.slice(0, 5)) {
      try { const j = await (await net.fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent("https://open.spotify.com/track/" + id)}`, { headers: browser })).json(); out.push({ id, title: String(j.title || ""), art: j.thumbnail_url || "" }); }
      catch (e) { out.push({ id, title: "", art: "" }); }
    }
    return out;
  }
  // Plays a song in the Spotify app: opens its link with a start time (which makes Spotify play it), then checks
  // what actually started, and tries the next match if Spotify played something else.
  async spotifyPlay(q, title = "") {
    q = String(q || "").trim().slice(0, 140); if (!q) throw new Error("Which song?");
    if (this.spotifyApi && this.spotifyApi.status().connected) { const r = await this.spotifyApi.playQuery(q); return { how: r.how, title: r.track.title, artist: r.track.artist }; }
    const n = s => String(s || "").toLowerCase().replace(/\(.*?\)|\[.*?\]|- .*remaster.*|feat\..*/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const want = n(title || q.split(/ by | - /)[0]);
    const cands = (await this.findOnSpotify(q)).map((c, i) => ({ ...c, score: (c.title && (n(c.title) === want ? 3 : n(c.title).includes(want) || want.includes(n(c.title)) ? 2 : 0)) - i * .1 }))
      .sort((a, b) => b.score - a.score);
    if (!cands.length) { await shell.openExternal("spotify:search:" + encodeURIComponent(q)); return { how: "search" }; }
    const running = this.media && this.media.meta && /spotify/i.test(this.media.meta.app || "");
    for (const [i, c] of cands.slice(0, 3).entries()) {
      const cold = !running && !i;
      if (cold && this.spotifyApi && !(await this.spotifyApi.appRunning())) await this.spotifyApi.wake();   // a closed Spotify starts minimized
      if (this.tuck) this.tuck(cold ? 25000 : 6000); await shell.openExternal(`spotify:track:${c.id}#0:00`);
      const got = await this.waitForSpotify(c.title || title, cold ? 12000 : 6000);   // the app may need to start first
      if (got) { if (this.tuck) this.tuck(cold ? 4000 : 1500); return { how: "played", title: c.title || title, art: c.art }; }
    }
    return { how: "opened", title: cands[0].title };
  }
  waitForSpotify(title, ms) {
    const n = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), want = n(title);
    return new Promise(res => {
      const t0 = Date.now(), tick = () => {
        const m = this.media && this.media.meta;
        if (m && m.on && m.playing && /spotify/i.test(m.app || "") && (!want || n(m.title).includes(want) || want.includes(n(m.title)))) return res(true);
        if (Date.now() - t0 > ms) return res(false);
        setTimeout(tick, 300);
      }; tick();
    });
  }
  async spotify(q, title) { const r = await this.spotifyPlay(q, title); return r.how; }

  install() {
    const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));
    h("songs:list", () => this.list());
    h("songs:pick", async (e, folder) => {
      const paths = await this.pick(BrowserWindow.fromWebContents(e.sender), folder); if (!paths) return null;
      return this.add(paths, (n, of) => { if (!e.sender.isDestroyed()) e.sender.send("songs:progress", { n, of }); });
    });
    h("songs:add", (e, paths) => this.add(paths, (n, of) => { if (!e.sender.isDestroyed()) e.sender.send("songs:progress", { n, of }); }));
    h("songs:remove", (e, ids) => this.remove(ids));
    h("songs:played", (e, id) => this.played(id));
    h("songs:reveal", (e, id) => { const s = this.find(id); if (s) shell.showItemInFolder(s.path); return !!s; });
    h("songs:search", (e, q) => this.search(q));
    h("songs:youtube", (e, q) => this.youtube(q));
    h("songs:spotify", (e, q, title) => this.spotifyPlay(q, title));
    h("songs:hasSpotify", () => this.hasSpotify());
  }
}

module.exports = { Songs };
