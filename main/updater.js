// Automatic updates: every copy of Skyline (yours and your friends') checks the published releases, downloads a new
// version in the background (only the parts that changed), and installs it the next time Skyline restarts. You can
// also restart right away from the "Update ready" banner. Nothing restarts by itself while you're using it.
const { app, ipcMain } = require("electron");

class Updater {
  constructor(getWin) { this.getWin = getWin; this.state = { state: "idle", version: app.getVersion() }; this.au = null; }
  tell(patch) { this.state = { ...this.state, ...patch }; const w = this.getWin(); if (w && !w.isDestroyed()) w.webContents.send("update:status", this.state); }
  install(testing) {
    ipcMain.handle("update:status", () => this.state);
    ipcMain.handle("update:check", () => this.check(true));
    ipcMain.handle("update:install", () => { if (this.state.state === "ready" && this.au) { this.au.quitAndInstall(true, true); return true; } return false; });
    if (!app.isPackaged || testing) { this.tell({ state: "dev" }); return; }   // only the installed app updates itself
    if (!require("fs").existsSync(require("path").join(process.resourcesPath, "app-update.yml"))) { this.tell({ state: "off" }); return; }   // no release page set up yet
    let au; try { ({ autoUpdater: au } = require("electron-updater")); } catch (e) { this.tell({ state: "error", error: "Updater missing" }); return; }
    this.au = au;
    au.autoDownload = true; au.autoInstallOnAppQuit = true; au.allowDowngrade = false;
    au.logger = { info() {}, warn() {}, error: e => console.log("[update]", String(e).slice(0, 200)), debug() {} };
    au.on("checking-for-update", () => this.tell({ state: "checking", error: "" }));
    au.on("update-not-available", () => this.tell({ state: "latest", checked: Date.now() }));
    au.on("update-available", i => this.tell({ state: "downloading", next: i.version, pct: 0 }));
    au.on("download-progress", p => this.tell({ state: "downloading", pct: Math.round(p.percent || 0) }));
    au.on("update-downloaded", i => this.tell({ state: "ready", next: i.version }));
    au.on("error", e => this.tell({ state: "error", error: String(e && e.message || e).split("\n")[0].slice(0, 160), checked: Date.now() }));
    setTimeout(() => this.check(), 20e3);
    setInterval(() => this.check(), 3 * 3600e3);
  }
  async check(manual) {
    if (!this.au) return this.state;
    if (this.state.state === "downloading" || this.state.state === "ready") return this.state;
    try { await this.au.checkForUpdates(); } catch (e) { this.tell({ state: "error", error: String(e && e.message || e).split("\n")[0].slice(0, 160) }); }
    return this.state;
  }
}

module.exports = { Updater };
