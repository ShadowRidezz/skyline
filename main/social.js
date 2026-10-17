// Skyline Social, the connection side: your account (Supabase Auth), the server functions in
// supabase/social.sql, and live updates (Supabase Realtime), handed to the page over IPC.
// The page never sees your session token; it only asks for a named server function.
// For tests, SKY_SOCIAL_TEST=http://127.0.0.1:port points everything at test/social/server.mjs instead.
const { ipcMain, safeStorage, desktopCapturer, Notification, powerMonitor, app, net } = require("electron");
const fs = require("fs");
const path = require("path");

const RPCS = new Set([
  "create_server", "get_servers", "get_members", "update_server", "delete_server", "leave_server", "kick_member", "set_member_role", "create_channel", "update_channel",
  "delete_channel", "reorder_channels", "create_invite", "get_invite", "join_server", "get_invites", "revoke_invite", "send_channel_message", "cm_edit", "cm_delete", "cm_react",
  "save_school", "get_school",
  "voice_join", "voice_leave", "voice_state", "voice_heartbeat", "send_voice_signal", "set_typing",
  "cm_pin", "get_channel_messages", "get_channel_message", "search_channel", "get_channel_pins", "mark_channel_read",
  "is_admin", "my_badges", "show_badge", "admin_badges", "admin_save_badge", "admin_delete_badge", "admin_give_badge", "admin_take_badge", "admin_badge_holders", "admin_users", "admin_suspend", "admin_stats", "admin_announce",
  "edit_message", "delete_message", "react", "pin_message", "get_message", "search_messages", "get_pins", "update_profile_details", "set_status", "can_make_badges", "username_available", "create_profile", "update_profile", "my_profile", "get_settings", "save_settings", "heartbeat",
  "search_users", "get_profile", "send_request", "respond_request", "cancel_request", "get_requests", "get_friends", "remove_friend",
  "block_user", "unblock_user", "get_blocked", "send_message", "get_messages", "mark_read", "send_signal", "get_notifications", "mark_notifications_read"]);
const TABLES = ["messages", "message_reactions", "friend_requests", "friendships", "presence", "notifications", "profile_details",
  "servers", "server_members", "channels", "channel_messages", "channel_reactions", "voice_members", "typing_state"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
// pictures you can upload, recognised by their actual bytes (a renamed file isn't accepted)
const KINDS = { avatar: 4 * 1048576, banner: 6 * 1048576, background: 6 * 1048576, sticker: 1048576, server: 4 * 1048576 };
function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { type: "image/png", ext: "png", animated: b.includes(Buffer.from("acTL")) };
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { type: "image/jpeg", ext: "jpg", animated: false };
  if (b.length > 6 && /^GIF8[79]a$/.test(b.slice(0, 6).toString("latin1"))) return { type: "image/gif", ext: "gif", animated: true };
  if (b.length > 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP") return { type: "image/webp", ext: "webp", animated: b.includes(Buffer.from("ANIM")) };
  return null;
}
// files you can send in a conversation (pictures, short videos, PDFs, text, zip), by their actual bytes
const ATTACH_MAX = 25 * 1048576;
function sniffFile(b, name) {
  const pic = sniff(b); if (pic) return pic;
  const head = b.slice(0, 16).toString("latin1");
  if (head.startsWith("%PDF-")) return { type: "application/pdf", ext: "pdf" };
  if (b.length > 12 && b.slice(4, 8).toString("latin1") === "ftyp") return { type: "video/mp4", ext: "mp4" };
  if (b.length > 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { type: "video/webm", ext: "webm" };
  if (head.startsWith("PK\x03\x04") && /\.zip$/i.test(name || "")) return { type: "application/zip", ext: "zip" };
  if (/\.(txt|md|log|csv)$/i.test(name || "") && !b.slice(0, 4096).includes(0)) return { type: "text/plain", ext: "txt" };
  return null;
}

function config() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(__dirname, "social-config.json"), "utf8")); } catch (e) {}
  const ice = Array.isArray(c.iceServers) && c.iceServers.length ? c.iceServers
    : [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
  return { url: String(c.url || "").trim(), key: String(c.anonKey || "").trim(), ice, gifKey: String(c.gifKey || "").trim() };
}
const tidyError = e => {   // server errors are short codes (see social.sql); anything else gets a plain message
  const m = String((e && (e.message || e.msg || e.error_description)) || e || "");
  if (/^[a-z_]{3,32}$/.test(m)) return m;
  if (/otp_expired|token has expired|invalid.*(otp|token|code)|otp.*invalid|expired.*code/i.test(m)) return "bad_code";
  if (/over_email_send_rate_limit|email rate limit|for security purposes, you can only request/i.test(m)) return "email_rate_limited";
  if (/error sending|smtp|not authorized|email_address_not_authorized|unexpected_failure/i.test(m)) return "email_send_failed";
  if (/fetch failed|network|ENOTFOUND|ECONN|timed? ?out|Failed to fetch/i.test(m)) return "offline";
  if (/invalid login credentials/i.test(m)) return "bad_login";
  if (/already registered|already exists/i.test(m)) return "email_taken";
  if (/password should be|weak password/i.test(m)) return "weak_password";
  if (/email not confirmed/i.test(m)) return "email_unconfirmed";
  if (/rate limit|too many/i.test(m)) return "rate_limited";
  if (/JWT|token|session/i.test(m)) return "signed_out";
  return m.slice(0, 160) || "error";
};

/* ---------- Supabase ---------- */
class SupabaseLink {
  constructor(cfg, dataDir, emit) {
    this.emit = emit; this.file = path.join(dataDir, "social-session.json");
    const store = {   // your session lives encrypted in Skyline's data folder (Windows DPAPI)
      getItem: k => { try { const all = this.readStore(); return all[k] ?? null; } catch (e) { return null; } },
      setItem: (k, v) => { const all = this.readStore(); all[k] = v; this.writeStore(all); },
      removeItem: k => { const all = this.readStore(); delete all[k]; this.writeStore(all); },
    };
    const { createClient } = require("@supabase/supabase-js");
    this.sb = createClient(cfg.url, cfg.key, {
      auth: { storage: store, storageKey: "skyline-social", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 30 } },
    });
    this.sb.auth.onAuthStateChange((ev, session) => {
      const uid = session && session.user ? session.user.id : null;
      if (uid !== this.uid) { this.uid = uid; this.listen(); }
      this.emit("auth", { user: session && session.user ? { id: session.user.id, email: session.user.email } : null, event: ev });
    });
  }
  readStore() {
    try {
      const raw = fs.readFileSync(this.file);
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
      return JSON.parse(text) || {};
    } catch (e) { return {}; }
  }
  writeStore(all) {
    const text = JSON.stringify(all);
    fs.writeFileSync(this.file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text);
  }
  async user() { const { data } = await this.sb.auth.getSession(); const u = data && data.session && data.session.user; return u ? { id: u.id, email: u.email } : null; }
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw error;
    return { user: data.user ? { id: data.user.id, email: data.user.email } : null, confirm: !data.session };
  }
  async signIn(email, password) { const { error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) throw error; return this.user(); }
  async signOut() { await this.sb.auth.signOut(); }
  // forgot password: an email with a 6-digit code (type it into Skyline) and a link (opens the web app)
  async reset(email) { const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: "https://shadowridezz.github.io/skyline/" }); if (error) throw error; }
  async verifyCode(email, code) { const { error } = await this.sb.auth.verifyOtp({ email, token: code, type: "recovery" }); if (error) throw error; return this.user(); }
  async setPassword(password) { const { error } = await this.sb.auth.updateUser({ password }); if (error) throw error; }
  async rpc(fn, args) { const { data, error } = await this.sb.rpc(fn, args || {}); if (error) throw error; return data; }
  async upload(path, buf, type) {
    const { error } = await this.sb.storage.from("media").upload(path, buf, { contentType: type, cacheControl: "31536000", upsert: false });
    if (error) throw error;
    return this.sb.storage.from("media").getPublicUrl(path).data.publicUrl;
  }
  async removeMedia(path) { await this.sb.storage.from("media").remove([path]).catch(() => {}); }
  async attach(path, buf, type) { const { error } = await this.sb.storage.from("attachments").upload(path, buf, { contentType: type, upsert: false }); if (error) throw error; return path; }
  async fileUrls(paths) {   // short-lived links (1 hour) to files you're allowed to open
    const { data, error } = await this.sb.storage.from("attachments").createSignedUrls(paths, 3600); if (error) throw error;
    return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  }
  listen() {   // one channel with everything you're allowed to see changing
    if (this.ch) { this.sb.removeChannel(this.ch); this.ch = null; }
    if (!this.uid) return;
    const ch = this.sb.channel("skyline-social-" + this.uid);
    for (const table of TABLES) ch.on("postgres_changes", { event: "*", schema: "public", table }, p => this.emit("change", { table, type: p.eventType, row: p.new, old: p.old }));
    for (const t of ["call_signals", "voice_signals"]) ch.on("postgres_changes", { event: "INSERT", schema: "public", table: t, filter: `to_id=eq.${this.uid}` }, p => this.emit("change", { table: t, type: "INSERT", row: p.new }));
    ch.subscribe(status => this.emit("live", { status }));
    this.ch = ch;
  }
}

/* ---------- the local test server (test/social/server.mjs) ---------- */
class TestLink {
  constructor(base, dataDir, emit) {
    this.base = base.replace(/\/$/, ""); this.emit = emit; this.file = path.join(dataDir, "social-test-session.json");
    try { this.session = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { this.session = null; }
    setTimeout(() => { this.emit("auth", { user: this.session && this.session.user, event: "INITIAL_SESSION" }); this.listen(); }, 0);
  }
  async post(p, body) {
    const r = await fetch(this.base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(this.session ? { Authorization: "Bearer " + this.session.token } : {}) }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "error");
    return j;
  }
  async user() { return this.session && this.session.user; }
  save(s) { this.session = s; if (s) fs.writeFileSync(this.file, JSON.stringify(s)); else try { fs.unlinkSync(this.file); } catch (e) {} this.emit("auth", { user: s && s.user, event: s ? "SIGNED_IN" : "SIGNED_OUT" }); this.listen(); }
  async signUp(email, password) { const s = await this.post("/auth/signup", { email, password }); this.save(s); return { user: s.user, confirm: false }; }
  async signIn(email, password) { this.save(await this.post("/auth/signin", { email, password })); return this.session.user; }
  async signOut() { this.save(null); }
  async reset(email) { await this.post("/auth/recover", { email }); }
  async verifyCode(email, code) { this.save(await this.post("/auth/verify", { email, code })); return this.session.user; }
  async setPassword(password) { await this.post("/auth/password", { password }); }
  async rpc(fn, args) { return (await this.post("/rpc/" + fn, args)).data; }
  async upload(path, buf, type) { return `data:${type};base64,${buf.toString("base64")}`; }   // (tests keep pictures inline)
  async removeMedia() {}
  async attach(path, buf, type) { return (await this.post("/files", { path, type, b64: buf.toString("base64") })).data; }
  async fileUrls(paths) { return (await this.post("/fileurls", { paths })).data; }
  async listen() {
    if (this.abort) this.abort.abort();
    if (!this.session) return;
    const ac = this.abort = new AbortController();
    try {
      const r = await fetch(this.base + "/events", { headers: { Authorization: "Bearer " + this.session.token }, signal: ac.signal });
      this.emit("live", { status: "SUBSCRIBED" });
      const dec = new TextDecoder(); let buf = "";
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) this.emit("change", JSON.parse(line)); }
      }
    } catch (e) {}
    if (ac === this.abort && !ac.signal.aborted) { this.emit("live", { status: "CLOSED" }); setTimeout(() => this.listen(), 2000); }
  }
}

/* ---------- the bridge to the page ---------- */
class Social {
  constructor(dataDir, getWin, opts = {}) {
    this.dataDir = dataDir; this.getWin = getWin; this.shot = !!opts.shot;
    this.cfg = config();
    const test = process.env.SKY_SOCIAL_TEST;
    const emit = (kind, data) => { const w = this.getWin(); if (w && !w.isDestroyed()) w.webContents.send("social:" + kind, data); if (kind === "auth") this.authed = data.user; };
    this.link = test ? new TestLink(test, dataDir, emit) : this.cfg.url && this.cfg.key ? new SupabaseLink(this.cfg, dataDir, emit) : null;
    this.share = null;
  }
  // a screen or window you picked for sharing: the next screen-capture request in a call uses it
  takeShare() { const s = this.share; this.share = null; return s && Date.now() - s.at < 20000 ? s.id : null; }
  notify(title, body, target) {
    if (this.shot) { console.log("[notify]", JSON.stringify({ title, body })); return; }
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on("click", () => { const w = this.getWin(); if (!w || w.isDestroyed()) return; if (w.isMinimized()) w.restore(); w.show(); w.focus(); w.webContents.send("social:open", target || null); });
    n.show();
  }
  install() {
    const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
      try { return { ok: true, data: await fn(...a) }; } catch (er) { return { ok: false, error: tidyError(er) }; }
    });
    const need = () => { if (!this.link) throw new Error("not_configured"); return this.link; };
    h("social:state", async () => ({ configured: !!this.link, test: !!process.env.SKY_SOCIAL_TEST, user: this.link ? await this.link.user() : null, ice: this.cfg.ice }));
    h("social:signUp", (email, password) => {
      email = String(email || "").trim().toLowerCase(); password = String(password || "");
      if (!EMAIL.test(email)) throw new Error("email_invalid");
      if (password.length < 8 || password.length > 72) throw new Error("weak_password");
      return need().signUp(email, password);
    });
    h("social:signIn", (email, password) => {
      email = String(email || "").trim().toLowerCase();
      if (!EMAIL.test(email) || !password) throw new Error("bad_login");
      return need().signIn(email, String(password));
    });
    h("social:signOut", () => need().signOut());
    h("social:reset", email => { email = String(email || "").trim().toLowerCase(); if (!EMAIL.test(email)) throw new Error("email_invalid"); return need().reset(email); });
    h("social:verifyCode", (email, code) => { email = String(email || "").trim().toLowerCase(); code = String(code || "").replace(/\D/g, ""); if (!EMAIL.test(email) || code.length < 6 || code.length > 10) throw new Error("bad_code"); return need().verifyCode(email, code); });
    // tests only: the code the stand-in server "emailed" (there's no inbox to read)
    if (process.env.SKY_SOCIAL_TEST) h("social:testOutbox", async email => (await (await fetch(process.env.SKY_SOCIAL_TEST.replace(/\/$/, "") + "/test/outbox?email=" + encodeURIComponent(email))).json()).code);
    h("social:setPassword", password => { password = String(password || ""); if (password.length < 8 || password.length > 72) throw new Error("weak_password"); return need().setPassword(password); });
    h("social:rpc", (fn, args) => {
      if (!RPCS.has(fn)) throw new Error("not_allowed");
      if (args != null && (typeof args !== "object" || JSON.stringify(args).length > 200000)) throw new Error("bad_request");
      return need().rpc(fn, args || {});
    });
    h("social:upload", async (kind, data) => {
      const link = need(), user = await link.user(); if (!user) throw new Error("signed_out");
      if (!KINDS[kind]) throw new Error("bad_request");
      const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
      if (!buf.length) throw new Error("file_empty");
      if (buf.length > KINDS[kind]) throw new Error("file_too_big");
      const f = sniff(buf); if (!f) throw new Error("file_type");
      const path = `${user.id}/${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${f.animated ? "-anim" : ""}.${f.ext}`;   // (-anim: so it can be paused)
      return { url: await link.upload(path, buf, f.type), type: f.type, animated: f.animated, size: buf.length };
    });
    // a file for a conversation: into the two of you's private folder
    h("social:attach", async (target, name, data) => {
      const link = need(), user = await link.user(); if (!user) throw new Error("signed_out");
      const t = String(target || ""), srv = /^srv:([0-9a-f-]{36})$/.exec(t);
      if (!srv && !/^[0-9a-f-]{36}$/.test(t)) throw new Error("bad_request");
      const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
      if (!buf.length) throw new Error("file_empty");
      if (buf.length > ATTACH_MAX) throw new Error("file_too_big");
      const f = sniffFile(buf, String(name || "")); if (!f) throw new Error("file_type");
      const folder = srv ? "srv_" + srv[1] : [user.id, t].sort().join("_");
      const path = `${folder}/${Date.now().toString(36)}${require("crypto").randomBytes(5).toString("hex")}.${f.ext}`;
      await link.attach(path, buf, f.type);
      return { path, type: f.type, size: buf.length, name: String(name || "file").replace(/[\x00-\x1F<>:"/\\|?*]/g, "").slice(0, 120) || "file" };
    });
    h("social:fileUrls", async paths => {
      const list = (Array.isArray(paths) ? paths : []).filter(p => /^(?:[0-9a-f-]{36}_[0-9a-f-]{36}|srv_[0-9a-f-]{36})\/[A-Za-z0-9._-]{1,80}$/.test(p)).slice(0, 100);
      return list.length ? need().fileUrls(list) : {};
    });
    h("social:removeMedia", async url => {   // tidy up a picture you replaced (only ever in your own folder)
      const link = need(), user = await link.user(); if (!user || !link.removeMedia) return false;
      const m = String(url || "").match(/\/storage\/v1\/object\/public\/media\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,80})$/);
      if (!m || m[1] !== user.id) return false;
      await link.removeMedia(`${m[1]}/${m[2]}`); return true;
    });
    h("social:screens", async () => {
      if (this.shot && process.argv.some(x => x.startsWith("--fakemedia"))) return [{ id: "test:page", name: "Test screen (this page)", screen: true, thumb: "", icon: "" }, { id: "test:page2", name: "Test window", screen: false, thumb: "", icon: "" }];
      const list = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      return list.filter(s => s.name && !/^Skyline$/i.test(s.name) || s.id.startsWith("screen:"))
        .map(s => ({ id: s.id, name: s.name, screen: s.id.startsWith("screen:"), thumb: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : "" }));
    });
    h("social:shareSource", id => { this.share = { id: String(id || ""), at: Date.now() }; return true; });
    h("social:idle", () => powerMonitor.getSystemIdleTime());
    // GIFs from GIPHY: trending, or a search. Each comes back as a small preview and the link that's sent
    // (GIPHY's plain link for the GIF, the only kind the server accepts).
    h("social:gifs", async q => {
      q = String(q || "").trim().slice(0, 50);
      if (process.env.SKY_SOCIAL_TEST) return [1, 2, 3, 4, 5, 6].map(i => ({ id: "testgif" + i, title: "Test GIF " + i, w: 200, h: 120 + i * 10, url: `https://media.giphy.com/media/testgif${i}/giphy.gif`,
        preview: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${120 + i * 10}"><rect width="100%" height="100%" fill="hsl(${i * 50},60%,45%)"/><text x="50%" y="55%" font-size="28" text-anchor="middle" fill="#fff" font-family="Segoe UI">GIF ${i}</text></svg>`) }));
      if (!this.cfg.gifKey) throw new Error("no_gif_key");
      // (GIPHY's free key allows a limited number of searches an hour: the same search within 10 minutes is reused)
      this.gifCache = this.gifCache || new Map(); const hit = this.gifCache.get(q.toLowerCase());
      if (hit && Date.now() - hit.at < 10 * 60e3) return hit.list;
      const u = q ? `https://api.giphy.com/v1/gifs/search?${new URLSearchParams({ api_key: this.cfg.gifKey, q, limit: "30", rating: "pg-13", bundle: "messaging_non_clips" })}`
        : `https://api.giphy.com/v1/gifs/trending?${new URLSearchParams({ api_key: this.cfg.gifKey, limit: "30", rating: "pg-13", bundle: "messaging_non_clips" })}`;
      const r = await net.fetch(u); if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "no_gif_key" : "offline");
      const j = await r.json();
      const list = (j.data || []).filter(g => /^[A-Za-z0-9]{3,40}$/.test(g.id || "")).map(g => { const fw = (g.images && g.images.fixed_width) || {}, o = (g.images && g.images.original) || {};
        return { id: g.id, title: String(g.title || "").slice(0, 100), w: +o.width || +fw.width || 0, h: +o.height || +fw.height || 0, url: `https://media.giphy.com/media/${g.id}/giphy.webp`, preview: `https://media.giphy.com/media/${g.id}/200w.webp` }; });
      this.gifCache.set(q.toLowerCase(), { at: Date.now(), list }); if (this.gifCache.size > 200) this.gifCache.delete(this.gifCache.keys().next().value);
      return list;
    });
    h("social:notify", n => this.notify(String(n.title || "Skyline").slice(0, 80), String(n.body || "").slice(0, 200), n.target || null));
    // closing Skyline: tell friends you're offline first (waits at most 1.5 s)
    let said = false;
    app.on("before-quit", e => {
      if (said || !this.link || !this.authed) return;
      e.preventDefault(); said = true;
      Promise.race([this.link.rpc("heartbeat", { p_status: "offline" }).catch(() => {}), new Promise(r => setTimeout(r, 1500))]).then(() => app.quit());
    });
  }
}

module.exports = { Social };
