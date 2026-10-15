// Backup & restore: everything you've made in Skyline in one file (.skyline-backup), and back again.
// Secrets never go in it: API keys, the Spotify and Google sign-ins and voice keys stay on this PC only.
const fs = require("fs");
const path = require("path");
const { ipcMain, dialog, app } = require("electron");

// what a backup holds: your stores, memory, stats, library and the games you built (every file in them)
const FILES = ["settings", "themes", "history", "tasks", "notes", "school", "money", "minecraft", "youtube", "aichat", "memory", "plays", "playtime", "library"].map(n => n + ".json");
const SAFE = /^(?:[a-z]+\.json|games\/g\w+\/(?:meta\.json|thumb\.jpg|(?:files|history\/\d+)\/[\w./ -]+))$/;   // nothing else can be written back

class Backup {
  constructor(dataDir, getWin) { this.dir = dataDir; this.getWin = getWin; }
  collect() {
    const files = {};
    for (const f of FILES) { const p = path.join(this.dir, f); if (fs.existsSync(p)) files[f] = { text: fs.readFileSync(p, "utf8") }; }
    const walk = (abs, rel) => {
      let list = []; try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
      for (const d of list) {
        const a = path.join(abs, d.name), r = rel + "/" + d.name;
        if (d.isDirectory()) walk(a, r);
        else if (SAFE.test(r) && fs.statSync(a).size < 8e6) files[r] = /\.(jpg|png|webp|gif)$/i.test(d.name) ? { b64: fs.readFileSync(a).toString("base64") } : { text: fs.readFileSync(a, "utf8") };
      }
    };
    walk(path.join(this.dir, "games"), "games");
    return { skylineBackup: 1, version: app.getVersion(), created: new Date().toISOString(), files };
  }
  async save() {
    const d = new Date(), name = `Skyline backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.skyline-backup`;
    const r = await dialog.showSaveDialog(this.getWin(), { title: "Back up Skyline", defaultPath: path.join(app.getPath("documents"), name), filters: [{ name: "Skyline backup", extensions: ["skyline-backup"] }] });
    if (r.canceled || !r.filePath) return null;
    const data = this.collect(); fs.writeFileSync(r.filePath, JSON.stringify(data), "utf8");
    return { path: r.filePath, files: Object.keys(data.files).length, games: new Set(Object.keys(data.files).filter(f => f.startsWith("games/")).map(f => f.split("/")[1])).size };
  }
  read(file) {
    let data; try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new Error("That file isn't a Skyline backup"); }
    if (!data || data.skylineBackup !== 1 || typeof data.files !== "object") throw new Error("That file isn't a Skyline backup");
    return data;
  }
  async pick() {
    const r = await dialog.showOpenDialog(this.getWin(), { title: "Restore a Skyline backup", properties: ["openFile"], filters: [{ name: "Skyline backup", extensions: ["skyline-backup"] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const data = this.read(r.filePaths[0]);
    this.pending = data;
    return { created: data.created, version: data.version, files: Object.keys(data.files).length, games: new Set(Object.keys(data.files).filter(f => f.startsWith("games/")).map(f => f.split("/")[1])).size };
  }
  // write the backup over what's here, then restart Skyline with it
  restore(data = this.pending, restart = true) {
    if (!data) throw new Error("Pick a backup first");
    let n = 0;
    for (const [rel, v] of Object.entries(data.files)) {
      if (!SAFE.test(rel) || rel.includes("..")) continue;
      const abs = path.join(this.dir, ...rel.split("/")); if (!abs.startsWith(this.dir)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (v && typeof v.text === "string") fs.writeFileSync(abs, v.text, "utf8"); else if (v && typeof v.b64 === "string") fs.writeFileSync(abs, Buffer.from(v.b64, "base64")); else continue;
      n++;
    }
    this.pending = null;
    if (restart) setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
    return { restored: n };
  }
  install(testing) {
    ipcMain.handle("backup:save", () => this.save());
    ipcMain.handle("backup:pick", () => this.pick());
    ipcMain.handle("backup:restore", () => this.restore());
    if (testing) {   // tests: no file dialogs, no restart
      ipcMain.handle("backup:test", (e, file, doRestore) => { if (!doRestore) { const d = this.collect(); fs.writeFileSync(file, JSON.stringify(d)); return { files: Object.keys(d.files).length }; } return this.restore(this.read(file), false); });
    }
  }
}

module.exports = { Backup };
