// Clip saver: while you're playing a game, Skyline keeps the last minute of your screen and game sound in memory
// (nothing is written to disk). Press the clip key and the last 30-60 seconds become a video in
// Videos\Skyline Clips, ready to send to a friend. Off until you turn it on; it only records while a game is open.
const fs = require("fs");
const path = require("path");
const { BrowserWindow, ipcMain, desktopCapturer, globalShortcut, app, shell, Notification } = require("electron");

const QUALITY = { "720": { w: 1280, h: 720, kbps: 3000 }, "1080": { w: 1920, h: 1080, kbps: 8000 } };   // 720p: a minute still fits in a chat (25 MB)
const DEFAULTS = { on: false, key: "Alt+Shift+C", quality: "720", fps: 60 };

class Clips {
  constructor(dataDir, getWin, playtime, opts = {}) {
    this.file = path.join(dataDir, "clips.json"); this.getWin = getWin; this.playtime = playtime; this.shot = !!opts.shot;
    this.conf = { ...DEFAULTS, ...this.read() }; this.rec = null; this.recording = false; this.saving = false;
    this.dir = path.join(app.getPath("videos"), "Skyline Clips");
    // tests: SKY_CLIP_TEST=<folder> records (as if a game were open) into that folder instead
    this.test = process.env.SKY_CLIP_TEST || ""; if (this.test) { this.dir = this.test; this.shot = false; }
  }
  read() { if (process.env.SKY_CLIP_TEST) return {}; try { return JSON.parse(fs.readFileSync(this.file, "utf8")) || {}; } catch (e) { return {}; } }
  save() { if (this.test) return; try { fs.writeFileSync(this.file, JSON.stringify(this.conf)); } catch (e) {} }
  send(ch, data) { const w = this.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); }
  status() { return { ...this.conf, recording: this.recording, dir: this.dir, quality: this.conf.quality, list: this.list() }; }
  list() {
    try { return fs.readdirSync(this.dir).filter(f => /\.(mp4|webm)$/i.test(f)).map(f => { const p = path.join(this.dir, f), st = fs.statSync(p); return { name: f, path: p, size: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at).slice(0, 12); }
    catch (e) { return []; }
  }
  // the recorder lives in a hidden window, so the main window stays smooth
  startRecorder() {
    if (this.rec || this.shot) return;
    const w = this.rec = new BrowserWindow({ show: false, width: 320, height: 200, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, "clipper-preload.js"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    w.loadFile(path.join(__dirname, "..", "renderer", "clipper.html"));
    w.on("closed", () => { if (this.rec === w) { this.rec = null; this.recording = false; this.send("clips:status", this.status()); } });
  }
  stopRecorder() { if (this.rec) { const w = this.rec; this.rec = null; this.recording = false; try { w.destroy(); } catch (e) {} this.send("clips:status", this.status()); } }
  // record only while a game is open (checked every 10 s)
  watch() {
    clearInterval(this.watchT);
    this.watchT = setInterval(() => {
      if (!this.conf.on) { this.stopRecorder(); return; }
      const playing = !!this.test || (this.playtime && this.playtime.now && this.playtime.now.length > 0);
      if (playing) this.startRecorder(); else if (this.rec) this.stopRecorder();
    }, 10000);
  }
  registerKey() {
    if (this.shot) return;
    if (this.key) { try { globalShortcut.unregister(this.key); } catch (e) {} this.key = null; }
    if (!this.conf.on) return;
    try { if (globalShortcut.register(this.conf.key, () => this.clip())) this.key = this.conf.key; } catch (e) {}
  }
  clip() {
    if (!this.rec || !this.recording) { this.toast("Clips record while you're playing a game. Start a game, then press the clip key."); return; }
    if (this.saving) return;
    this.saving = true; this.rec.webContents.send("clipper:save");
    setTimeout(() => { this.saving = false; }, 8000);
  }
  toast(text) {
    if (Notification.isSupported() && !this.shot) new Notification({ title: "Skyline clips", body: text, silent: true }).show();
    this.send("clips:toast", text);
  }
  install(registerAll) {
    const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(e, ...a) }; } catch (er) { return { ok: false, error: String(er.message || er) }; } });
    // the hidden recorder asks for the screen, says when it's running, and hands over a finished clip
    h("clipper:config", async () => {
      const src = (await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }))[0];
      return { source: src && src.id, ...QUALITY[this.conf.quality] || QUALITY["720"], fps: this.conf.fps };
    });
    h("clipper:state", (e, on) => { this.recording = !!on; this.send("clips:status", this.status()); return true; });
    h("clipper:write", (e, buf, ext, secs) => {
      this.saving = false;
      fs.mkdirSync(this.dir, { recursive: true });
      const d = new Date(), pad = n => String(n).padStart(2, "0");
      const name = `Clip ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext === "mp4" ? "mp4" : "webm"}`;
      const file = path.join(this.dir, name), data = Buffer.from(buf);
      fs.writeFileSync(file, data);
      const game = (this.playtime && this.playtime.now && this.playtime.now[0]) || "";
      this.toast(`Saved a ${Math.round(secs)} second clip${game ? " of " + game : ""}. Open Skyline to send it.`);
      this.send("clips:saved", { name, path: file, size: data.length, secs, game });
      return name;
    });
    // the page: settings, the list, sending one, opening the folder
    h("clips:status", () => this.status());
    h("clips:set", (e, patch) => {
      const p = patch || {};
      if ("on" in p) this.conf.on = !!p.on;
      if (p.quality && QUALITY[p.quality]) this.conf.quality = p.quality;
      if ([30, 60].includes(+p.fps)) this.conf.fps = +p.fps;
      if (typeof p.key === "string" && /^[A-Za-z0-9+]{1,30}$/.test(p.key)) this.conf.key = p.key;
      this.save(); this.stopRecorder(); this.registerKey(); this.watch();
      return this.status();
    });
    h("clips:read", (e, name) => {   // one clip's bytes (to send it in a chat)
      const n = path.basename(String(name || "")); if (!/\.(mp4|webm)$/i.test(n)) throw new Error("Not a clip");
      return fs.readFileSync(path.join(this.dir, n)).buffer;
    });
    h("clips:open", (e, name) => { if (name) shell.showItemInFolder(path.join(this.dir, path.basename(name))); else { fs.mkdirSync(this.dir, { recursive: true }); shell.openPath(this.dir); } return true; });
    h("clips:delete", (e, name) => { const n = path.basename(String(name || "")); if (!/\.(mp4|webm)$/i.test(n)) throw new Error("Not a clip"); return shell.trashItem(path.join(this.dir, n)).then(() => true); });
    h("clips:now", () => this.clip());
    this.registerKey(); this.watch();
    app.on("will-quit", () => this.stopRecorder());
  }
}
module.exports = { Clips };
