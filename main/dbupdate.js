// Database updates without the browser: Skyline's owner pastes a Supabase access token once (kept encrypted on
// this PC), and from then on a new supabase/social.sql that ships with an update is run on the server by itself
// when Skyline starts, through Supabase's own Management API. Only the admin's Skyline ever does this.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ipcMain, safeStorage, net, BrowserWindow, shell } = require("electron");

class DbUpdate {
  constructor(dataDir, social) {
    this.file = path.join(dataDir, "db-update.json"); this.social = social;
    this.sqlFile = path.join(__dirname, "..", "supabase", "social.sql");
  }
  read() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")) || {}; } catch (e) { return {}; } }
  write(d) { try { fs.writeFileSync(this.file, JSON.stringify(d)); } catch (e) {} }
  sql() { try { return fs.readFileSync(this.sqlFile, "utf8"); } catch (e) { return ""; } }
  hash() { return crypto.createHash("sha256").update(this.sql()).digest("hex").slice(0, 16); }
  ref() { const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec((this.social && this.social.cfg && this.social.cfg.url) || ""); return m ? m[1] : null; }
  token() { const d = this.read(); if (!d.tok || !safeStorage.isEncryptionAvailable()) return null; try { return safeStorage.decryptString(Buffer.from(d.tok, "base64")); } catch (e) { return null; } }
  status() { const d = this.read(), h = this.hash(); return { hasToken: !!this.token(), current: h, applied: d.applied || null, upToDate: d.applied === h, at: d.at || null, error: d.error || null, project: this.ref() }; }
  async api(method, p, body) {
    const t = this.token(); if (!t) throw new Error("no_token");
    const r = await net.fetch("https://api.supabase.com/v1" + p, { method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
    if (r.status === 401 || r.status === 403) throw new Error("That token isn't allowed into this project. Make a new one on supabase.com (Account → Access Tokens).");
    if (!r.ok) throw new Error((j && (j.message || j.error)) || text.slice(0, 300) || "Supabase said " + r.status);
    return j;
  }
  async setToken(tok) {
    tok = String(tok || "").trim();
    if (!/^sbp_[A-Za-z0-9_]{20,}$/.test(tok)) throw new Error("That doesn't look like a Supabase access token (it starts with sbp_).");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't protect the token on this PC.");
    const d = this.read(); d.tok = safeStorage.encryptString(tok).toString("base64"); this.write(d);
    try { await this.api("GET", "/projects/" + this.ref()); } catch (e) { const x = this.read(); delete x.tok; this.write(x); throw e; }
    return this.status();
  }
  forget() { const d = this.read(); delete d.tok; this.write(d); return this.status(); }
  // run the whole file (it's written to be safe to run again)
  async apply() {
    if (!this.ref()) throw new Error("Social isn't connected to a server.");
    const sql = this.sql(); if (!sql) throw new Error("The database file is missing from this copy of Skyline.");
    const d = this.read();
    try { await this.api("POST", `/projects/${this.ref()}/database/query`, { query: sql }); d.applied = this.hash(); d.at = Date.now(); delete d.error; this.write(d); }
    catch (e) { d.error = String(e.message || e).slice(0, 300); this.write(d); throw e; }
    return this.status();
  }
  async auto() { const s = this.status(); if (s.hasToken && !s.upToDate) { try { await this.apply(); console.log("[db] updated to", this.hash()); } catch (e) { console.log("[db] update failed:", e.message); } } }
  install(testing) {
    const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (er) { return { ok: false, error: String(er.message || er) }; } });
    h("db:status", () => this.status());
    h("db:setToken", tok => this.setToken(tok));
    h("db:forget", () => this.forget());
    h("db:apply", () => this.apply());
    // Supabase's token page in a Skyline window (its sign-in is remembered here, separate from your browsers)
    h("db:tokenPage", () => {
      if (this.win && !this.win.isDestroyed()) { this.win.focus(); return true; }
      const w = this.win = new BrowserWindow({ width: 1100, height: 780, title: "Supabase · Access Tokens", autoHideMenuBar: true, webPreferences: { partition: "persist:supabase", contextIsolation: true, nodeIntegration: false, sandbox: true } });
      w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/(supabase\.com|github\.com|[a-z0-9.-]*\.supabase\.(co|com))\//.test(url)) return { action: "allow" }; shell.openExternal(url); return { action: "deny" }; });
      w.loadURL("https://supabase.com/dashboard/account/tokens");
      return true;
    });
    if (!testing) setTimeout(() => this.auto(), 20000);   // a little after start-up: a new version's database changes go in by themselves
  }
}
module.exports = { DbUpdate };
