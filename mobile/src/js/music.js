// The music player on Home: what you're listening to on Spotify right now, on any of your devices (this phone,
// your PC, a speaker), with play/pause and skip. A web app can't see what the phone itself is playing, so this asks
// Spotify. Sign in once with Spotify's own page (PKCE: Skyline never sees your password); the sign-in stays on this phone.
const ID = (window.SKY_CONFIG && SKY_CONFIG.spotifyId) || "";
const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const REDIRECT = location.origin + location.pathname;
const KEY = "sky-spotify";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
const keep = t => { try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch (e) {} };
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const Music = {
  now: null, at: 0, onChange: null, timer: 0, busy: false,
  available: () => !!ID,
  connected: () => !!(load() && load().refresh),

  async connect() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48))), state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    sessionStorage.setItem("sky-sp-pkce", JSON.stringify({ verifier, state }));
    location.href = "https://accounts.spotify.com/authorize?" + new URLSearchParams({ client_id: ID, response_type: "code", redirect_uri: REDIRECT, code_challenge_method: "S256", code_challenge: challenge, state, scope: SCOPES });
  },
  disconnect() { keep(null); this.now = null; this.emit(); },

  // back from Spotify's sign-in page: swap the code for tokens, then tidy the address bar
  async finishSignIn() {
    const q = new URLSearchParams(location.search), code = q.get("code"), err = q.get("error"), state = q.get("state");
    if (!code && !err) return null;
    let pk = null; try { pk = JSON.parse(sessionStorage.getItem("sky-sp-pkce")); } catch (e) {}
    sessionStorage.removeItem("sky-sp-pkce");
    ["code", "state", "error"].forEach(k => q.delete(k));
    history.replaceState(history.state, "", location.pathname + (q.toString() ? "?" + q : ""));
    if (err) return err === "access_denied" ? "cancelled" : err;
    if (!pk || pk.state !== state) return "expired";   // (not the sign-in this phone started)
    try { keep(await this.token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: ID, code_verifier: pk.verifier })); return "ok"; }
    catch (e) { return e.message; }
  },
  async token(body, old = {}) {
    const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || "Spotify said no");
    return { access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60e3 };
  },
  async access() {
    let t = load(); if (!t || !t.refresh) return null;
    if (Date.now() > t.exp) {
      try { t = await this.token({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: ID }, t); keep(t); }
      catch (e) { if (/invalid_grant|revoked/i.test(e.message)) keep(null); return null; }
    }
    return t.access;
  },
  async api(path, method = "GET") {
    const a = await this.access(); if (!a) return null;
    const r = await fetch("https://api.spotify.com/v1" + path, { method, headers: { Authorization: "Bearer " + a } });
    if (r.status === 204 || r.status === 202) return {};
    if (r.status === 401) { const t = load(); if (t) { t.exp = 0; keep(t); } return null; }
    return r.ok ? r.json().catch(() => ({})) : null;
  },

  // what's playing: polled every few seconds while Home is on screen
  async refresh() {
    if (!this.connected() || this.busy) return;
    this.busy = true;
    try {
      const p = await this.api("/me/player?additional_types=episode");
      const it = p && p.item;
      this.now = it ? { title: it.name, artist: (it.artists || []).map(a => a.name).join(", ") || (it.show && it.show.name) || "", art: ((it.album || it.show || {}).images || [{}])[0].url || "",
        playing: !!p.is_playing, pos: p.progress_ms || 0, dur: it.duration_ms || 0, device: p.device ? p.device.name : "", url: it.external_urls && it.external_urls.spotify } : null;
      this.at = Date.now(); this.emit();
    } catch (e) {} finally { this.busy = false; }
  },
  start() { this.stop(); this.refresh(); this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 5000); },
  stop() { clearInterval(this.timer); this.timer = 0; },
  position() { const n = this.now; if (!n) return 0; return Math.min(n.dur, n.pos + (n.playing ? Date.now() - this.at : 0)); },
  async control(what) {
    const n = this.now; if (!n) return;
    if (what === "toggle") { n.pos = this.position(); this.at = Date.now(); n.playing = !n.playing; this.emit(); await this.api(n.playing ? "/me/player/play" : "/me/player/pause", "PUT"); }
    if (what === "next") await this.api("/me/player/next", "POST");
    if (what === "prev") await this.api("/me/player/previous", "POST");
    setTimeout(() => this.refresh(), 450);
  },
  emit() { if (this.onChange) this.onChange(this.now); },
};
