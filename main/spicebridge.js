// Spotify without Premium, through Spicetify: a small Skyline helper (main/spicetify/skyline.js) runs inside the
// Spotify desktop app and does what Spotify's official connection only allows Premium accounts to do: search,
// play, queue, like, your playlists. It talks to Skyline over a tiny local link (127.0.0.1 only, and only
// from Spotify's own app page). Skyline only uses it when your Spotify isn't linked with Premium; a Premium
// account linked in Skyline keeps the normal connection, so people with Premium and Spicetify are unaffected.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = 43822;
const ORIGINS = /^https:\/\/xpui\.app\.spotify\.com$/;   // the Spotify desktop app's own page

class SpiceBridge {
  constructor() { this.queue = []; this.waiting = null; this.pending = new Map(); this.seen = 0; this.user = null; this.n = 0; }
  live() { return Date.now() - this.seen < 35000; }
  start() {
    const srv = http.createServer((req, res) => {
      const origin = req.headers.origin || "";
      if (!ORIGINS.test(origin)) { res.writeHead(403); return res.end(); }
      const head = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json", "Cache-Control": "no-store" };
      if (req.method === "OPTIONS") { res.writeHead(204, head); return res.end(); }
      const send = (code, obj) => { res.writeHead(code, head); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
      const url = new URL(req.url, "http://x");
      if (req.method === "GET" && url.pathname === "/poll") {   // the helper waits here for the next thing to do
        this.seen = Date.now();
        if (this.queue.length) return send(200, this.queue.shift());
        if (this.waiting) try { this.waiting.send(204); } catch (e) {}
        const w = this.waiting = { send };
        const t = setTimeout(() => { if (this.waiting === w) { this.waiting = null; send(204); } }, 20000);
        req.on("close", () => { clearTimeout(t); if (this.waiting === w) this.waiting = null; });
        return;
      }
      if (req.method === "POST" && (url.pathname === "/reply" || url.pathname === "/hello")) {
        let body = ""; req.on("data", d => { body += d; if (body.length > 2e6) req.destroy(); });
        req.on("end", () => {
          let j = {}; try { j = JSON.parse(body || "{}"); } catch (e) { return send(400); }
          this.seen = Date.now();
          if (url.pathname === "/hello") { this.user = { name: String(j.name || "Spotify").slice(0, 60), premium: !!j.premium }; this.version = String(j.version || ""); return send(200, { ok: true }); }
          const p = this.pending.get(j.id); if (p) { this.pending.delete(j.id); clearTimeout(p.t); if (j.ok) p.ok(j.data); else p.no(new Error(String(j.error || "Spotify didn't do that"))); }
          send(200, { ok: true });
        });
        return;
      }
      send(404);
    });
    srv.on("error", () => {});   // (port busy: no helper link, everything else carries on)
    srv.listen(PORT, "127.0.0.1");
    this.srv = srv;
  }
  // ask the helper to do something; answers within a few seconds or fails
  call(cmd, ...args) {
    if (!this.live()) return Promise.reject(new Error("The Skyline helper in Spotify isn't running. Open Spotify."));
    const id = ++this.n + "-" + Date.now();
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.pending.delete(id); no(new Error("Spotify didn't answer in time")); }, cmd === "play" || cmd === "playList" ? 15000 : 10000);
      this.pending.set(id, { ok, no, t });
      const msg = { id, cmd, args };
      if (this.waiting) { const w = this.waiting; this.waiting = null; w.send(200, msg); } else this.queue.push(msg);
    });
  }

  /* ---------- putting the helper into Spicetify (for people who use it) ---------- */
  cli() {
    const cands = [path.join(process.env.LOCALAPPDATA || "", "spicetify", "spicetify.exe"), path.join(process.env.USERPROFILE || "", "spicetify-cli", "spicetify.exe"), path.join(process.env.USERPROFILE || "", "AppData", "Local", "spicetify", "spicetify.exe")];
    return cands.find(p => fs.existsSync(p)) || null;
  }
  run(exe, args) { return new Promise((ok, no) => execFile(exe, args, { windowsHide: true, timeout: 120000 }, (e, out, err) => e ? no(new Error(String(err || out || e.message).trim().slice(0, 300))) : ok(String(out || "").trim()))); }
  async extDir(exe) { const p = (await this.run(exe, ["path", "userdata"]).catch(() => "")).split(/\r?\n/).pop().trim(); const d = p && fs.existsSync(p) ? p : path.join(process.env.APPDATA || "", "spicetify"); return path.join(d, "Extensions"); }
  async status() {
    const exe = this.cli(); let installed = false;
    if (exe) { try { installed = fs.existsSync(path.join(await this.extDir(exe), "skyline.js")); } catch (e) {} }
    return { spicetify: !!exe, installed, live: this.live(), user: this.live() ? this.user : null };
  }
  async install() {
    const exe = this.cli(); if (!exe) throw new Error("Spicetify isn't installed on this PC. Install it from spicetify.app first.");
    const dir = await this.extDir(exe); fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, "spicetify", "skyline.js"), path.join(dir, "skyline.js"));
    await this.run(exe, ["config", "extensions", "skyline.js"]);
    await this.run(exe, ["apply"]);   // (restarts Spotify with the helper in it)
    return this.status();
  }
}
module.exports = { SpiceBridge, PORT };
