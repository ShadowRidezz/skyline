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
  status() { const d = this.read(), h = this.hash(); return { hasToken: !!this.token(), current: h, applied: d.applied || null, upToDate: d.applied === h, at: d.at || null, error: d.error || null, project: this.ref(),
    authReady: d.authApplied === this.authHash(), authError: d.authError || null, customEmail: d.customEmail == null ? null : !!d.customEmail }; }
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
  // the "forgot password" email: a 6-digit code to type into Skyline, plus a link to the web app. Set on the server
  // the same way as the database (once per version of this text), keeping any other allowed links already there.
  authWanted() {
    return {
      mailer_otp_length: 6,
      mailer_subjects_recovery: "Your Skyline code: {{ .Token }}",
      mailer_templates_recovery_content: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#1b1f27">
<h2 style="margin:0 0 8px;font-weight:600">Forgot your Skyline password?</h2>
<p style="margin:0 0 16px;color:#4b5363">Type this code into Skyline. You'll be signed in, then you can pick a new password or just keep going.</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px">{{ .Token }}</p>
<p style="margin:0 0 16px;color:#4b5363">Or open this link (it works on your phone too): <a href="{{ .ConfirmationURL }}">sign in to Skyline</a></p>
<p style="margin:0;color:#8a92a3;font-size:13px">If you didn't ask for this, ignore this email. Your password stays the same.</p></div>`,
      allow: "https://shadowridezz.github.io/skyline/**",
    };
  }
  authHash() { return crypto.createHash("sha256").update(JSON.stringify(this.authWanted())).digest("hex").slice(0, 16); }
  async applyAuth() {
    const ref = this.ref(); if (!ref) throw new Error("Social isn't connected to a server.");
    const w = this.authWanted(), cur = await this.api("GET", `/projects/${ref}/config/auth`) || {};
    const list = String(cur.uri_allow_list || "").split(",").map(x => x.trim()).filter(Boolean);
    if (!list.includes(w.allow)) list.push(w.allow);
    await this.api("PATCH", `/projects/${ref}/config/auth`, { mailer_otp_length: w.mailer_otp_length, mailer_subjects_recovery: w.mailer_subjects_recovery, mailer_templates_recovery_content: w.mailer_templates_recovery_content, uri_allow_list: list.join(",") });
    const d = this.read(); d.authApplied = this.authHash(); d.customEmail = !!cur.smtp_host; delete d.authError; this.write(d);   // (only whether the server has its own email sender: no settings are kept)
  }
  async auto() {
    const s = this.status(); if (!s.hasToken) return;
    if (!s.upToDate) { try { await this.apply(); console.log("[db] updated to", this.hash()); } catch (e) { console.log("[db] update failed:", e.message); } }
    if (this.read().authApplied !== this.authHash()) { try { await this.applyAuth(); console.log("[db] sign-in email set up"); } catch (e) { const d = this.read(); d.authError = String(e.message || e).slice(0, 300); this.write(d); console.log("[db] sign-in email setup failed:", e.message); } }
  }
  install(testing) {
    const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (er) { return { ok: false, error: String(er.message || er) }; } });
    h("db:status", () => this.status());
    h("db:setToken", tok => this.setToken(tok));
    h("db:forget", () => this.forget());
    h("db:apply", async () => { await this.apply(); if (this.read().authApplied !== this.authHash()) await this.applyAuth().catch(() => {}); return this.status(); });
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
