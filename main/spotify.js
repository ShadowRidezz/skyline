// Spotify, inside Skyline: sign in once with Spotify's own login page (OAuth with PKCE: Skyline never
// sees your password), then search all of Spotify, play songs, albums and playlists, queue, like and
// add to playlists. Uses the Client ID of a free app you create on developer.spotify.com.
// Tokens are stored encrypted with Windows' protection (safeStorage) and only used by this process.
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { ipcMain, shell, safeStorage, net } = require("electron");

const PORT = 43821;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = ["user-read-private", "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing",
  "user-library-read", "user-library-modify", "user-follow-read", "playlist-read-private", "playlist-read-collaborative", "playlist-modify-private", "playlist-modify-public"];
const b64url = b => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = (title, text) => `<!doctype html><meta charset="utf-8"><title>Skyline</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#07060f;color:#f2f1f8;font:16px 'Segoe UI',sans-serif;text-align:center">
  <div><div style="font-size:54px">${title.startsWith("Connected") ? "🎧" : "⚠️"}</div><h1 style="font-weight:600;margin:10px 0">${title}</h1><p style="color:#a6a4bb;max-width:560px;margin:0 auto;line-height:1.5">${text}</p></div></body>`;

// what a failed sign-in means, in plain words
function signInProblem(e) {
  const m = String((e && e.message) || e || "");
  if (e && e.status === 403 || /not.*registered|user may not|developer dashboard|403/i.test(m))
    return "Your Spotify app doesn't allow this Spotify account yet. On developer.spotify.com open your app, go to User Management, add the name and email of the Spotify account you signed in with, then connect again. (Spotify apps in development mode only let in the accounts on that list.)";
  if (/redirect/i.test(m)) return "The Redirect URI in your Spotify app doesn't match. It must be exactly " + REDIRECT + " (127.0.0.1, not localhost, no slash at the end). Fix it in your app's Settings, press Save, and connect again.";
  if (/invalid_client|client/i.test(m)) return "Spotify doesn't recognise that Client ID. Copy it again from your app's Settings page on developer.spotify.com.";
  if (/premium/i.test(m)) return "Spotify needs a Premium account for this. " + m;
  return "Spotify didn't finish the sign-in. Try connecting again.";
}

class Spotify {
  constructor(dataDir, { media, tuck } = {}) {
    this.file = path.join(dataDir, "spotify.json"); this.media = media; this.tuck = tuck || (() => {});
    this.remoteStuck = +this.conf().remoteStuck || 0;   // when the desktop app ignored remote control (then songs open directly, straight away)
  }
  // kept in memory once read, and written all-or-nothing, so a read during a save can never look like "not connected"
  conf() {
    if (this.cache) return { ...this.cache };
    for (let i = 0; i < 3; i++) { try { this.cache = JSON.parse(fs.readFileSync(this.file, "utf8")); return { ...this.cache }; } catch (e) { if (e.code === "ENOENT") return {}; } }
    return {};
  }
  save(c) { this.cache = { ...c }; const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(c, null, 1), "utf8"); fs.renameSync(tmp, this.file); }
  tokens() {
    const c = this.conf(); if (!c.tok || !safeStorage.isEncryptionAvailable()) return null;
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(c.tok, "base64"))); } catch (e) { return null; }
  }
  setTokens(t) { const c = this.conf(); if (t) c.tok = safeStorage.encryptString(JSON.stringify(t)).toString("base64"); else delete c.tok; this.save(c); }
  status() {
    const c = this.conf(), t = this.tokens();
    return { clientId: c.clientId || "", connected: !!(t && t.refresh), user: c.user || null, redirect: REDIRECT,
      needsReconnect: !!(t && t.refresh && t.scope && !t.scope.includes("user-follow-read")) };
  }
  setClientId(id) {
    id = String(id || "").trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error("That doesn't look like a Spotify Client ID (32 letters and numbers, from your app's Settings page)");
    const c = this.conf(); if (c.clientId !== id) { delete c.tok; delete c.user; } c.clientId = id; this.save(c); return this.status();
  }
  disconnect() { const c = this.conf(); delete c.tok; delete c.user; this.save(c); return this.status(); }

  /* ---------- signing in (in your normal browser, on Spotify's own page) ---------- */
  connect() {
    const { clientId } = this.conf(); if (!clientId) return Promise.reject(new Error("Add your Spotify Client ID first"));
    if (this.pending) return this.pending;
    const verifier = b64url(crypto.randomBytes(64)), challenge = b64url(crypto.createHash("sha256").update(verifier).digest()), state = b64url(crypto.randomBytes(16));
    this.pending = new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); setTimeout(() => server.close(), 500); this.pending = null; err ? reject(err) : resolve(val); };
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, REDIRECT);
        if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }
        const code = u.searchParams.get("code"), err = u.searchParams.get("error");
        if (err || !code || u.searchParams.get("state") !== state) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE("Not connected", err === "access_denied" ? "You cancelled. You can close this tab." : "Something went wrong. Try again from Skyline."));
          return finish(new Error(err === "access_denied" ? "Spotify sign-in was cancelled" : "Spotify sign-in failed: " + (err || "no code")));
        }
        try {
          const t = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
          this.setTokens(t);
          const me = await this.api("GET", "/me");
          const c = this.conf(); c.user = { name: me.display_name || me.id, premium: me.product === "premium", country: me.country }; this.save(c);
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE("Connected to Skyline", `Hi ${String(me.display_name || "there").replace(/[<>&]/g, "")}! You can close this tab and go back to Skyline.`));
          finish(null, this.status());
        } catch (e) {
          // say exactly what went wrong, and what fixes it (the old message always blamed the Redirect URI)
          const why = signInProblem(e);
          this.setTokens(null);
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE("Not connected", why.replace(/[<>&]/g, "") + `<br><br><small style="color:#6f6c86">Spotify said: ${String(e.message || e).replace(/[<>&]/g, "").slice(0, 200)}</small>`));
          finish(new Error(why));
        }
      });
      server.on("error", e => finish(new Error(e.code === "EADDRINUSE" ? `Port ${PORT} is busy. Close whatever uses it and try again.` : e.message)));
      server.listen(PORT, "127.0.0.1", () => {
        const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: REDIRECT, code_challenge_method: "S256", code_challenge: challenge, state, scope: SCOPES.join(" ") });
        shell.openExternal("https://accounts.spotify.com/authorize?" + q);
      });
      const timer = setTimeout(() => finish(new Error("Spotify sign-in timed out")), 5 * 60e3);
    });
    return this.pending;
  }
  async tokenRequest(form) {
    const r = await net.fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || "Spotify sign-in failed (" + r.status + ")");
    const old = this.tokens() || {};
    return { access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60e3, scope: j.scope || old.scope || "" };
  }
  async access() {
    const t = this.tokens(); if (!t || !t.refresh) throw new Error("Spotify isn't connected");
    if (t.access && Date.now() < t.exp) return t.access;
    if (!this.refreshing) this.refreshing = this.tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: this.conf().clientId })
      .then(n => { this.setTokens(n); return n.access; })
      .catch(e => { if (/invalid_grant|revoked/i.test(e.message)) this.disconnect(); throw new Error("Spotify needs you to connect again: " + e.message); })
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async api(method, p, body, retry = true) {
    const r = await net.fetch("https://api.spotify.com/v1" + p, { method, headers: { authorization: "Bearer " + await this.access(), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && retry) { const t = this.tokens(); if (t) { t.exp = 0; this.setTokens(t); } return this.api(method, p, body, false); }
    if (r.status === 429 && retry) { await sleep(Math.min(5, +(r.headers.get("retry-after") || 1)) * 1000); return this.api(method, p, body, false); }
    if (r.status === 204 || r.status === 202) return null;
    const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) {}
    if (!r.ok) { const e = new Error((j && j.error && (j.error.message || j.error)) || "Spotify said " + r.status); e.status = r.status; e.reason = j && j.error && j.error.reason; throw e; }
    return j;
  }

  /* ---------- search + library ---------- */
  img(list) { const a = (list || []).slice().sort((x, y) => (x.width || 0) - (y.width || 0)); return (a.find(i => (i.width || 300) >= 160) || a[a.length - 1] || {}).url || ""; }
  async search(q) {
    q = String(q || "").trim().slice(0, 120); if (!q) return { tracks: [], artists: [], albums: [], playlists: [] };
    const j = await this.api("GET", "/search?" + new URLSearchParams({ q, type: "track,artist,album,playlist", limit: "10" }));
    return {
      tracks: (j.tracks?.items || []).filter(Boolean).map(t => ({ kind: "track", uri: t.uri, id: t.id, title: t.name, artist: t.artists.map(a => a.name).join(", "), album: t.album?.name || "",
        art: this.img(t.album?.images), dur: Math.round((t.duration_ms || 0) / 1000), explicit: !!t.explicit, context: t.album?.uri })),
      artists: (j.artists?.items || []).filter(Boolean).slice(0, 6).map(a => ({ kind: "artist", uri: a.uri, id: a.id, title: a.name, art: this.img(a.images), sub: "Artist" })),
      albums: (j.albums?.items || []).filter(Boolean).slice(0, 6).map(a => ({ kind: "album", uri: a.uri, id: a.id, title: a.name, artist: (a.artists || []).map(x => x.name).join(", "), art: this.img(a.images), sub: "Album · " + String(a.release_date || "").slice(0, 4) })),
      playlists: (j.playlists?.items || []).filter(Boolean).slice(0, 6).map(p => ({ kind: "playlist", uri: p.uri, id: p.id, title: p.name, art: this.img(p.images), sub: "Playlist · " + (p.owner?.display_name || "") })),
    };
  }
  async playlists() {
    const j = await this.api("GET", "/me/playlists?limit=50"), me = this.conf().user;
    return (j.items || []).filter(Boolean).map(p => ({ kind: "playlist", uri: p.uri, id: p.id, title: p.name, art: this.img(p.images), sub: (n => n != null ? `${n} song${n === 1 ? "" : "s"}` : p.owner?.display_name || "Playlist")((p.items || p.tracks || {}).total), mine: !!(p.owner && me && (p.owner.display_name === me.name || p.collaborative)) }));
  }

  /* ---------- your library: playlists, saved albums, artists you follow, liked songs ---------- */
  // (playlist song counts: Spotify renamed "tracks" to "items", so both are read)
  async library(kind) {
    if (kind === "playlists") return this.playlists();
    if (kind === "albums") {
      const j = await this.api("GET", "/me/albums?limit=50");
      return (j.items || []).map(x => x.album).filter(Boolean).map(a => ({ kind: "album", uri: a.uri, id: a.id, title: a.name, art: this.img(a.images), sub: (a.artists || []).map(x => x.name).join(", ") }));
    }
    if (kind === "artists") {
      const j = await this.api("GET", "/me/following?type=artist&limit=50");
      return ((j.artists || {}).items || []).filter(Boolean).map(a => ({ kind: "artist", uri: a.uri, id: a.id, title: a.name, art: this.img(a.images), sub: a.followers ? `${Intl.NumberFormat("en", { notation: "compact" }).format(a.followers.total)} followers` : "Artist" }));
    }
    if (kind === "liked") return this.tracks("liked");
    throw new Error("Unknown library section");
  }
  track(t, extra = {}) {
    return t && t.uri && /^spotify:track:/.test(t.uri) ? { kind: "track", uri: t.uri, id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), album: t.album ? t.album.name : "",
      art: this.img((t.album || {}).images) || extra.art || "", dur: Math.round((t.duration_ms || 0) / 1000), explicit: !!t.explicit, ...extra } : null;
  }
  // Spotify-made playlists ("This Is Tame Impala", "Today's Top Hits"...) are off-limits to newer apps' API access
  // (Spotify's rule since late 2024): their public embed player still lists the songs, so read it from there.
  async embedTracks(kind, id) {
    const r = await net.fetch(`https://open.spotify.com/embed/${kind}/${id}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" } });
    if (!r.ok) throw new Error("Spotify won't share that list (" + r.status + ")");
    const m = (await r.text()).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    const e = m && JSON.parse(m[1]).props?.pageProps?.state?.data?.entity; if (!e) throw new Error("Spotify won't share that list");
    const art = ((e.coverArt || {}).sources || [])[0]?.url || "";
    return (e.trackList || []).filter(t => /^spotify:track:/.test(t.uri || "") && t.isPlayable !== false).map(t => ({ kind: "track", uri: t.uri, id: t.uri.split(":")[2], title: t.title, artist: t.subtitle || "",
      album: "", art, dur: Math.round((t.duration || 0) / 1000), explicit: !!t.isExplicit, context: kind === "playlist" ? "spotify:playlist:" + id : kind === "album" ? "spotify:album:" + id : undefined }));
  }
  // the songs in a playlist / album / artist (their top songs), or your liked songs
  async tracks(kind, id, art) {
    try { return await this.tracksApi(kind, id, art); }
    catch (e) { if (kind !== "liked" && (e.status === 403 || e.status === 404 || e.status === 400)) return this.embedTracks(kind, id); throw e; }
  }
  async tracksApi(kind, id, art) {
    if (kind === "liked") { const j = await this.api("GET", "/me/tracks?limit=50"); return (j.items || []).map(x => this.track(x.track)).filter(Boolean); }
    if (kind === "playlist") {
      const j = await this.api("GET", `/playlists/${id}/items?limit=100`).catch(e => e.status === 404 ? this.api("GET", `/playlists/${id}/tracks?limit=100`) : Promise.reject(e));
      return (j.items || []).map(x => this.track(x.item || x.track, { context: "spotify:playlist:" + id })).filter(Boolean);
    }
    if (kind === "album") { const j = await this.api("GET", `/albums/${id}`); return ((j.tracks || {}).items || []).map(t => this.track(t, { art: this.img(j.images), album: j.name, context: j.uri })).filter(Boolean); }
    if (kind === "artist") { const j = await this.api("GET", `/artists/${id}/top-tracks?market=from_token`); return (j.tracks || []).map(t => this.track(t)).filter(Boolean); }
    throw new Error("Unknown list");
  }
  async playList(uris) {   // e.g. your liked songs, in order
    const first = async () => { const t = await this.api("GET", "/tracks/" + uris[0].split(":")[2]).catch(() => null); return { uri: uris[0], title: t ? t.name : "" }; };
    if (Date.now() - this.remoteStuck < 6 * 3600e3) return this.openDirect(await first());
    try { await this.api("PUT", "/me/player/play", { uris: uris.slice(0, 100) }); if (await this.started({ uri: uris[0] })) return { how: "played" }; return this.openDirect(await first()); }
    catch (e) { if (e.status === 403 || e.status === 404) return this.openDirect(await first()); throw e; }
  }

  /* ---------- playing ---------- */
  // Premium: play straight away on your Spotify (opening the app first if nothing is running).
  // Free accounts can't be controlled by apps (Spotify's rule), so the song opens in the Spotify app instead.
  async play(item) {
    const isTrack = /^spotify:track:/.test(item.uri);
    const body = isTrack ? (item.context && !item.solo ? { context_uri: item.context, offset: { uri: item.uri } } : { uris: [item.uri] }) : { context_uri: item.uri };
    if (isTrack && +item.position > 0) body.position_ms = Math.round(+item.position * 1000);
    const premium = !!(this.conf().user || {}).premium;
    if (premium && Date.now() - this.remoteStuck > 6 * 3600e3) {
      try { await this.api("PUT", "/me/player/play", body); if (await this.started(item)) { this.tuck(2500); return { ok: true, how: "played" }; } return this.openDirect(item); }
      catch (e) {
        if (e.status === 404 || e.reason === "NO_ACTIVE_DEVICE") {   // Spotify isn't open anywhere: start it (minimized), then play on it
          await this.wake();
          for (let i = 0; i < 14; i++) {
            await sleep(800);
            const d = await this.api("GET", "/me/player/devices").catch(() => ({ devices: [] }));
            const dev = (d.devices || []).find(x => x.is_active) || (d.devices || []).find(x => /computer/i.test(x.type)) || (d.devices || [])[0];
            if (dev) { await this.api("PUT", "/me/player/play?device_id=" + dev.id, body); if (await this.started(item)) { this.tuck(6000); return { ok: true, how: "played" }; } return this.openDirect(item); }
          }
          throw new Error("Spotify didn't open in time. Open the Spotify app and try again.");
        }
        if (e.status !== 403) throw e;
      }
    }
    return this.openDirect(item);   // free account (or stuck remote control): the Spotify app plays a song link with a start time straight away
  }
  // Spotify sometimes says "OK" but the desktop app never starts (its remote control gets stuck). Check, and if it
  // didn't start, open the song in the app directly: a song link with a start time makes the app play it.
  async started(item) {
    for (let i = 0; i < 8; i++) {
      await sleep(220);
      const st = await this.api("GET", "/me/player").catch(() => null);
      if (st && st.is_playing && st.item && (/^spotify:track:/.test(item.uri) ? st.item.uri === item.uri : true)) { this.setStuck(0); return true; }
    }
    this.setStuck(Date.now());
    return false;
  }
  setStuck(t) { this.remoteStuck = t; const c = this.conf(); c.remoteStuck = t; this.save(c);
  }
  // Open the song in the Spotify app (a song link with a start time makes it play), then make sure it really did:
  // a Spotify that's closed or still starting up sometimes only shows the song, or loads it paused.
  async openDirect(item) {
    let uri = item.uri, title = item.title || "";
    if (!/^spotify:track:/.test(uri)) {   // a playlist / album / artist: start its first song
      const [, kind, id] = uri.split(":"); const list = await this.tracks(kind, id).catch(() => []);
      if (list[0]) { uri = list[0].uri; title = list[0].title; } else { await shell.openExternal(uri); return { ok: true, how: "opened" }; }
    }
    const tok = (this.playTok = (this.playTok || 0) + 1), want = { uri, title };
    const cold = !(await this.appRunning()), long = cold || !this.playedOnce;   // the first song wakes Spotify's window up: watch it longer
    this.playedOnce = true;
    if (cold) await this.wake();   // never let a closed Spotify open in a big window
    for (let i = 0; i < 3 && tok === this.playTok; i++) {
      const at = +item.position > 0 ? Math.floor(+item.position) : 0;
      this.tuck(cold ? 25000 : long ? 12000 : 6000); await shell.openExternal(uri + `#${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}`);   // the watcher is already running when the window appears
      let got = await this.confirm(want, tok, cold && i === 0 ? 15000 : 6000);
      if (got === "paused") { if (this.media) this.media.send("play"); got = await this.confirm(want, tok, 3000); }
      if (got === "playing") { this.tuck(long ? 5000 : 2000); return { ok: true, how: "played" }; }   // and a little longer, for a window that shows up late
      if (cold && i === 0) await sleep(1200);   // let a just-opened Spotify finish loading before asking again
    }
    return { ok: true, how: tok === this.playTok ? "opened" : "played" };   // a newer song took over
  }
  // Is it playing? Windows' media info says what the Spotify app is doing; Spotify's own player state backs it up.
  async confirm(want, tok, ms) {
    const n = s => String(s || "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/ - .*$/, "").replace(/[^a-z0-9]+/g, " ").trim();
    const w = n(want.title), t0 = Date.now(); let asked = 0;
    while (Date.now() - t0 < ms && tok === this.playTok) {
      const m = this.media && this.media.meta;
      if (w && m && m.on && /spotify/i.test(m.app || "")) {
        const t = n(m.title);
        if (t && (t === w || t.includes(w) || w.includes(t))) { if (m.playing) return "playing"; if (Date.now() - t0 > 2000) return "paused"; }
      }
      if (Date.now() - asked > 1500 && this.status().connected) {
        asked = Date.now();
        const st = await this.api("GET", "/me/player").catch(() => null);
        if (st && st.item && st.item.uri === want.uri) { if (st.is_playing) return "playing"; if (Date.now() - t0 > 2000) return "paused"; }
      }
      await sleep(250);
    }
    return "";
  }
  // Start a closed Spotify minimized (its own --minimized flag) and keep its window down while it loads.
  async wake() {
    this.tuck(25000);
    const exe = path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe");
    if (fs.existsSync(exe)) { const p = spawn(exe, ["--minimized"], { detached: true, stdio: "ignore", windowsHide: true }); p.on("error", () => {}); p.unref(); }
    else await shell.openExternal("spotify:").catch(() => {});   // the Microsoft Store version: no exe to start directly
    for (let i = 0; i < 20 && !(await this.appRunning()); i++) await sleep(250);
    await sleep(1500);   // let it finish starting before it gets the song
  }
  appRunning() {
    if (this.media && this.media.meta && /spotify/i.test(this.media.meta.app || "")) return Promise.resolve(true);
    return new Promise(res => require("child_process").execFile("tasklist", ["/FI", "IMAGENAME eq Spotify.exe", "/NH"], { windowsHide: true }, (e, out) => res(!e && /spotify\.exe/i.test(out || ""))));
  }
  // what Spotify plays next (it can't be reordered by other apps; "skip to" presses Next as many times as needed)
  async upNext() {
    const j = await this.api("GET", "/me/player/queue");
    return { now: j && j.currently_playing ? this.track(j.currently_playing) : null, queue: ((j && j.queue) || []).map(t => this.track(t)).filter(Boolean).slice(0, 30) };
  }
  async skipTo(n) {
    n = Math.max(1, Math.min(30, n | 0));
    for (let i = 0; i < n; i++) { if (this.media) this.media.send("next"); await sleep(n > 1 ? 450 : 0); }
    return true;
  }
  async queue(uri) {
    try { await this.api("POST", "/me/player/queue?" + new URLSearchParams({ uri })); return true; }
    catch (e) { if (e.status === 403) throw new Error("Spotify only lets Premium accounts add to the queue from other apps"); if (e.status === 404) throw new Error("Start Spotify playing first, then add to the queue"); throw e; }
  }
  async like(id) { await this.api("PUT", "/me/library?" + new URLSearchParams({ uris: "spotify:track:" + id })).catch(async e => { if (e.status === 404 || e.status === 400) return this.api("PUT", "/me/tracks?ids=" + id); throw e; }); return true; }
  async addTo(playlistId, uri) {
    await this.api("POST", `/playlists/${playlistId}/items`, { uris: [uri] }).catch(async e => { if (e.status === 404) return this.api("POST", `/playlists/${playlistId}/tracks`, { uris: [uri] }); throw e; });
    return true;
  }
  // for the assistant: "play Blinding Lights" -> the top match, played
  async playQuery(q) { const r = await this.search(q), t = r.tracks[0]; if (!t) throw new Error(`Spotify has nothing for “${q}”`); const res = await this.play({ ...t, solo: true }); return { ...res, track: t }; }

  install() {
    const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
    h("sp:status", () => this.status());
    h("sp:setClientId", id => this.setClientId(id));
    h("sp:connect", () => this.connect());
    h("sp:disconnect", () => this.disconnect());
    h("sp:search", q => this.search(q));
    h("sp:play", item => { if (!item || !/^spotify:(track|album|artist|playlist):[A-Za-z0-9]+$/.test(item.uri || "")) throw new Error("Not a Spotify link"); return this.play(item); });
    h("sp:upNext", () => this.upNext());
    // what your Spotify is playing right now (for listening along in a call)
    h("sp:current", async () => {
      if (!this.status().connected) return null;
      const j = await this.api("GET", "/me/player/currently-playing").catch(() => null);
      const t = j && j.item; if (!t || !t.uri || !/^spotify:track:/.test(t.uri)) return null;
      return { uri: t.uri, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), art: this.img(t.album && t.album.images), dur: Math.round((t.duration_ms || 0) / 1000), pos: (j.progress_ms || 0) / 1000, playing: !!j.is_playing, at: Date.now() };
    });
    h("sp:skipTo", n => this.skipTo(n));
    h("sp:queue", uri => { if (!/^spotify:track:[A-Za-z0-9]+$/.test(uri || "")) throw new Error("Not a song"); return this.queue(uri); });
    h("sp:like", id => { if (!/^[A-Za-z0-9]+$/.test(id || "")) throw new Error("Not a song"); return this.like(id); });
    h("sp:playlists", () => this.playlists());
    h("sp:library", kind => this.library(String(kind)));
    h("sp:tracks", (kind, id) => { if (id && !/^[A-Za-z0-9]+$/.test(id)) throw new Error("Bad id"); return this.tracks(String(kind), id); });
    h("sp:playList", uris => { const list = (Array.isArray(uris) ? uris : []).filter(u => /^spotify:track:[A-Za-z0-9]+$/.test(u)); if (!list.length) throw new Error("Nothing to play"); return this.playList(list); });
    h("sp:addTo", (pid, uri) => { if (!/^[A-Za-z0-9]+$/.test(pid || "") || !/^spotify:track:[A-Za-z0-9]+$/.test(uri || "")) throw new Error("Bad playlist"); return this.addTo(pid, uri); });
    h("sp:dashboard", () => shell.openExternal("https://developer.spotify.com/dashboard/create"));
  }
}

module.exports = { Spotify, REDIRECT };
