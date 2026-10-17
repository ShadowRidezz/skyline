// Skyline on a phone: the same `sky.social` door the PC app's Social code uses, but straight to the Social server
// from the browser (Supabase, with the same public key the PC app has; the server's rules decide what anyone can
// read or change). Sign-in is kept in this browser. For tests, ?test=http://127.0.0.1:PORT talks to the local
// stand-in server (test/social/server.mjs) instead.
(function () {
  const CFG = window.SKY_CONFIG || {};
  const test = new URLSearchParams(location.search).get("test");
  const listeners = { auth: new Set(), change: new Set(), live: new Set(), open: new Set() };
  const fire = (k, d) => listeners[k].forEach(f => { try { f(d); } catch (e) { console.log(e); } });
  const wrap = p => p.then(data => ({ ok: true, data }), e => ({ ok: false, error: tidy(e) }));
  const tidy = e => {
    const m = String((e && (e.message || e.msg || e.error_description)) || e || "");
    if (/^[a-z_]{3,32}$/.test(m)) return m;
    if (/otp_expired|token has expired|invalid.*(otp|token|code)|otp.*invalid|expired.*code/i.test(m)) return "bad_code";
    if (/over_email_send_rate_limit|email rate limit|for security purposes, you can only request/i.test(m)) return "email_rate_limited";
    if (/error sending|smtp|not authorized|email_address_not_authorized|unexpected_failure/i.test(m)) return "email_send_failed";
    if (/fetch|network|Failed to fetch|NetworkError|timed? ?out/i.test(m)) return "offline";
    if (/invalid login credentials/i.test(m)) return "bad_login";
    if (/already registered|already exists/i.test(m)) return "email_taken";
    if (/password should be|weak password/i.test(m)) return "weak_password";
    if (/email not confirmed/i.test(m)) return "email_unconfirmed";
    if (/rate limit|too many/i.test(m)) return "rate_limited";
    if (/JWT|token|session/i.test(m)) return "signed_out";
    return m.slice(0, 160) || "error";
  };
  const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

  // files: recognised by their actual bytes (the same rules as the PC app)
  const KINDS = { avatar: 4 * 1048576, banner: 6 * 1048576, background: 6 * 1048576, sticker: 1048576, server: 4 * 1048576 };
  const has = (b, s) => { const t = new TextEncoder().encode(s); outer: for (let i = 0; i <= b.length - t.length; i++) { for (let j = 0; j < t.length; j++) if (b[i + j] !== t[j]) continue outer; return true; } return false; };
  const str = (b, a, z) => String.fromCharCode(...b.slice(a, z));
  function sniff(b) {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { type: "image/png", ext: "png", animated: has(b.slice(0, 200000), "acTL") };
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { type: "image/jpeg", ext: "jpg", animated: false };
    if (b.length > 6 && /^GIF8[79]a$/.test(str(b, 0, 6))) return { type: "image/gif", ext: "gif", animated: true };
    if (b.length > 12 && str(b, 0, 4) === "RIFF" && str(b, 8, 12) === "WEBP") return { type: "image/webp", ext: "webp", animated: has(b.slice(0, 200000), "ANIM") };
    return null;
  }
  function sniffFile(b, name) {
    const pic = sniff(b); if (pic) return pic;
    const head = str(b, 0, 16);
    if (head.startsWith("%PDF-")) return { type: "application/pdf", ext: "pdf" };
    if (b.length > 12 && str(b, 4, 8) === "ftyp") return { type: "video/mp4", ext: "mp4" };
    if (b.length > 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { type: "video/webm", ext: "webm" };
    if (head.startsWith("PK\x03\x04") && /\.zip$/i.test(name || "")) return { type: "application/zip", ext: "zip" };
    if (/\.(txt|md|log|csv)$/i.test(name || "") && !b.slice(0, 4096).includes(0)) return { type: "text/plain", ext: "txt" };
    return null;
  }
  const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join("");

  /* ---------- Supabase (the real thing) ---------- */
  function supa() {
    const sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "skyline-social" }, realtime: { params: { eventsPerSecond: 30 } } });
    let uid = null, ch = null;
    const listen = () => {
      if (ch) { sb.removeChannel(ch); ch = null; }
      if (!uid) return;
      ch = sb.channel("skyline-social-" + uid);
      for (const table of ["messages", "message_reactions", "friend_requests", "friendships", "presence", "notifications", "profile_details", "servers", "server_members", "channels", "channel_messages", "channel_reactions", "voice_members", "typing_state"])
        ch.on("postgres_changes", { event: "*", schema: "public", table }, p => fire("change", { table, type: p.eventType, row: p.new, old: p.old }));
      for (const t of ["call_signals", "voice_signals"]) ch.on("postgres_changes", { event: "INSERT", schema: "public", table: t, filter: `to_id=eq.${uid}` }, p => fire("change", { table: t, type: "INSERT", row: p.new }));
      ch.subscribe(status => fire("live", { status }));
    };
    sb.auth.onAuthStateChange((ev, session) => {
      const u = session && session.user ? session.user.id : null;
      if (u !== uid) { uid = u; listen(); }
      fire("auth", { user: session && session.user ? { id: session.user.id, email: session.user.email } : null, event: ev });
    });
    const user = async () => { const { data } = await sb.auth.getSession(); const u = data && data.session && data.session.user; return u ? { id: u.id, email: u.email } : null; };
    const must = async () => { const u = await user(); if (!u) throw new Error("signed_out"); return u; };
    return {
      user,
      async signUp(email, password) { const { data, error } = await sb.auth.signUp({ email, password }); if (error) throw error; return { user: data.user ? { id: data.user.id, email: data.user.email } : null, confirm: !data.session }; },
      async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return user(); },
      async signOut() { await sb.auth.signOut(); },
      async reset(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: "https://shadowridezz.github.io/skyline/" }); if (error) throw error; },
      async verifyCode(email, code) { const { error } = await sb.auth.verifyOtp({ email, token: code, type: "recovery" }); if (error) throw error; return user(); },
      async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; },
      async rpc(fn, args) { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; },
      async upload(path, buf, type) { const { error } = await sb.storage.from("media").upload(path, buf, { contentType: type, cacheControl: "31536000", upsert: false }); if (error) throw error; return sb.storage.from("media").getPublicUrl(path).data.publicUrl; },
      async removeMedia(path) { await sb.storage.from("media").remove([path]).catch(() => {}); },
      async attach(path, buf, type) { const { error } = await sb.storage.from("attachments").upload(path, buf, { contentType: type, upsert: false }); if (error) throw error; return path; },
      async fileUrls(paths) { const { data, error } = await sb.storage.from("attachments").createSignedUrls(paths, 3600); if (error) throw error; return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])); },
      must,
    };
  }

  /* ---------- the local stand-in server (tests only) ---------- */
  function stand(base) {
    let session = null; try { session = JSON.parse(localStorage.getItem("sky-test-session") || "null"); } catch (e) {}
    let ac = null;
    const post = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(session ? { Authorization: "Bearer " + session.token } : {}) }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "error"); return j; };
    const listen = async () => {
      if (ac) ac.abort(); if (!session) return;
      const me = ac = new AbortController();
      try {
        const r = await fetch(base + "/events", { headers: { Authorization: "Bearer " + session.token }, signal: me.signal });
        fire("live", { status: "SUBSCRIBED" });
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
        for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) fire("change", JSON.parse(line)); } }
      } catch (e) {}
      if (me === ac && !me.signal.aborted) { fire("live", { status: "CLOSED" }); setTimeout(listen, 2000); }
    };
    const save = s => { session = s; if (s) localStorage.setItem("sky-test-session", JSON.stringify(s)); else localStorage.removeItem("sky-test-session"); fire("auth", { user: s && s.user, event: s ? "SIGNED_IN" : "SIGNED_OUT" }); listen(); };
    setTimeout(() => { fire("auth", { user: session && session.user, event: "INITIAL_SESSION" }); listen(); }, 0);
    const toB64 = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
    return {
      user: async () => session && session.user,
      async signUp(email, password) { const s = await post("/auth/signup", { email, password }); save(s); return { user: s.user, confirm: false }; },
      async signIn(email, password) { save(await post("/auth/signin", { email, password })); return session.user; },
      async signOut() { save(null); },
      async reset(email) { await post("/auth/recover", { email }); },
      async verifyCode(email, code) { save(await post("/auth/verify", { email, code })); return session.user; },
      async setPassword(password) { await post("/auth/password", { password }); },
      async rpc(fn, args) { return (await post("/rpc/" + fn, args)).data; },
      async upload(path, buf, type) { return `data:${type};base64,${toB64(buf)}`; },
      async removeMedia() {},
      async attach(path, buf, type) { return (await post("/files", { path, type, b64: toB64(buf) })).data; },
      async fileUrls(paths) { return (await post("/fileurls", { paths })).data; },
      must: async () => { if (!session) throw new Error("signed_out"); return session.user; },
    };
  }

  const link = test ? stand(test.replace(/\/$/, "")) : CFG.url && CFG.anonKey && window.supabase ? supa() : null;
  const need = () => { if (!link) throw new Error("not_configured"); return link; };
  const gifCache = new Map();
  window.sky = {
    web: true,
    openUrl: url => { if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener"); },
    copy: t => navigator.clipboard.writeText(String(t)),
    social: {
      state: () => wrap((async () => ({ configured: !!link, test: !!test, user: link ? await link.user() : null, ice: CFG.ice || [{ urls: ["stun:stun.l.google.com:19302"] }] }))()),
      signUp: (email, password) => wrap((async () => { email = String(email || "").trim().toLowerCase(); if (!EMAIL.test(email)) throw new Error("email_invalid"); if (String(password || "").length < 8) throw new Error("weak_password"); return need().signUp(email, String(password)); })()),
      signIn: (email, password) => wrap((async () => { email = String(email || "").trim().toLowerCase(); if (!EMAIL.test(email) || !password) throw new Error("bad_login"); return need().signIn(email, String(password)); })()),
      signOut: () => wrap(need().signOut()),
      reset: email => wrap((async () => { email = String(email || "").trim().toLowerCase(); if (!EMAIL.test(email)) throw new Error("email_invalid"); return need().reset(email); })()),
      verifyCode: (email, code) => wrap((async () => { email = String(email || "").trim().toLowerCase(); code = String(code || "").replace(/\D/g, ""); if (!EMAIL.test(email) || code.length < 6 || code.length > 10) throw new Error("bad_code"); return need().verifyCode(email, code); })()),
      setPassword: password => wrap((async () => { password = String(password || ""); if (password.length < 8 || password.length > 72) throw new Error("weak_password"); return need().setPassword(password); })()),
      rpc: (fn, args) => wrap(need().rpc(fn, args)),
      upload: (kind, data) => wrap((async () => {
        const l = need(), u = await l.must(); if (!KINDS[kind]) throw new Error("bad_request");
        const b = new Uint8Array(data); if (!b.length) throw new Error("file_empty"); if (b.length > KINDS[kind]) throw new Error("file_too_big");
        const f = sniff(b); if (!f) throw new Error("file_type");
        const path = `${u.id}/${kind}-${Date.now().toString(36)}${rand(2)}${f.animated ? "-anim" : ""}.${f.ext}`;
        return { url: await l.upload(path, b, f.type), type: f.type, animated: f.animated, size: b.length };
      })()),
      removeMedia: url => wrap((async () => { const l = need(), u = await l.must(); const m = String(url || "").match(/\/storage\/v1\/object\/public\/media\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,80})$/); if (!m || m[1] !== u.id) return false; await l.removeMedia(`${m[1]}/${m[2]}`); return true; })()),
      attach: (target, name, data) => wrap((async () => {
        const l = need(), u = await l.must(), t = String(target || ""), srv = /^srv:([0-9a-f-]{36})$/.exec(t);
        if (!srv && !/^[0-9a-f-]{36}$/.test(t)) throw new Error("bad_request");
        const b = new Uint8Array(data); if (!b.length) throw new Error("file_empty"); if (b.length > 25 * 1048576) throw new Error("file_too_big");
        const f = sniffFile(b, String(name || "")); if (!f) throw new Error("file_type");
        const folder = srv ? "srv_" + srv[1] : [u.id, t].sort().join("_"), path = `${folder}/${Date.now().toString(36)}${rand(5)}.${f.ext}`;
        await l.attach(path, b, f.type);
        return { path, type: f.type, size: b.length, name: String(name || "file").replace(/[\x00-\x1F<>:"/\\|?*]/g, "").slice(0, 120) || "file" };
      })()),
      fileUrls: paths => wrap((async () => { const list = (Array.isArray(paths) ? paths : []).filter(p => /^(?:[0-9a-f-]{36}_[0-9a-f-]{36}|srv_[0-9a-f-]{36})\/[A-Za-z0-9._-]{1,80}$/.test(p)).slice(0, 100); return list.length ? need().fileUrls(list) : {}; })()),
      gifs: q => wrap((async () => {
        q = String(q || "").trim().slice(0, 50);
        if (test) return [1, 2, 3, 4].map(i => ({ id: "testgif" + i, title: "Test GIF " + i, w: 200, h: 150, url: `https://media.giphy.com/media/testgif${i}/giphy.gif`, preview: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="100%" height="100%" fill="hsl(${i * 60},60%,45%)"/></svg>`) }));
        if (!CFG.gifKey) throw new Error("no_gif_key");
        const hit = gifCache.get(q.toLowerCase()); if (hit && Date.now() - hit.at < 600000) return hit.list;
        const ps = new URLSearchParams({ api_key: CFG.gifKey, limit: "30", rating: "pg-13", bundle: "messaging_non_clips", ...(q ? { q } : {}) });
        const r = await fetch(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}?${ps}`); if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "no_gif_key" : "offline");
        const list = ((await r.json()).data || []).filter(g => /^[A-Za-z0-9]{3,40}$/.test(g.id || "")).map(g => { const o = (g.images && g.images.original) || {}; return { id: g.id, title: String(g.title || "").slice(0, 100), w: +o.width || 0, h: +o.height || 0, url: `https://media.giphy.com/media/${g.id}/giphy.webp`, preview: `https://media.giphy.com/media/${g.id}/200w.webp` }; });
        gifCache.set(q.toLowerCase(), { at: Date.now(), list }); return list;
      })()),
      // things only the PC app can do
      screens: () => Promise.resolve({ ok: true, data: [] }),
      shareSource: () => Promise.resolve({ ok: true, data: false }),
      idle: () => Promise.resolve({ ok: true, data: 0 }),
      notify: n => { try { if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification(n.title || "Skyline", { body: n.body || "", icon: "icon-192.png" }); } catch (e) {} return Promise.resolve({ ok: true }); },
      onAuth: f => listeners.auth.add(f), onChange: f => listeners.change.add(f), onLive: f => listeners.live.add(f), onOpen: f => listeners.open.add(f),
    },
  };
})();
