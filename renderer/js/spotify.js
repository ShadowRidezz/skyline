// Spotify inside Skyline's "Find a song": connect once, then search all of Spotify and play, queue,
// like or add to a playlist without leaving the app.
import { $, esc, sky, toast, mmss, dialog, store } from "./util.js";
import { icon } from "./social/icons.js";
import { FX } from "./fx.js";

const SPOT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-8.9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.2.9zm1.2-2.8a.8.8 0 0 1-1.1.3c-2.7-1.7-6.9-2.2-10.2-1.2a.8.8 0 1 1-.4-1.5c3.7-1.1 8.4-.6 11.5 1.3.4.2.5.7.2 1.1zm.1-2.9C14.7 8.8 9.3 8.6 6.2 9.6a.9.9 0 1 1-.6-1.8c3.6-1.1 9.6-.9 13.3 1.4a.9.9 0 0 1-1 1.5z"/></svg>`;
const SP = { status: null, res: null, lists: null, busy: false };
// what you searched and played lately (kept on this PC), shown before you type
const RECENT = { q: store.local("spRecentQ") || [], t: store.local("spRecentT") || [] };
const remember = {
  q(q) { q = q.trim(); if (!q) return; RECENT.q = [q, ...RECENT.q.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 10); store.local("spRecentQ", RECENT.q); },
  t(t) { if (!t || !t.uri) return; const keep = { kind: t.kind || "track", uri: t.uri, id: t.id, title: t.title, artist: t.artist || "", album: t.album || "", art: t.art || "", dur: t.dur || 0, explicit: !!t.explicit };
    RECENT.t = [keep, ...RECENT.t.filter(x => x.uri !== t.uri)].slice(0, 12); store.local("spRecentT", RECENT.t); },
};

export const SpotifyUI = {
  icon: SPOT,
  async status(force) {
    if (!sky) return null;
    if (!SP.status || !SP.status.connected || force) {
      for (let i = 0; i < 3; i++) { const s = await sky.spotify.status().catch(() => null); if (s) { SP.status = s; break; } await new Promise(r => setTimeout(r, 400)); }
    }
    return SP.status;
  },
  connected() { return !!(SP.status && SP.status.connected); },
  // unlink: Skyline forgets its sign-in to your Spotify (your account and the Spotify app are untouched)
  async unlink() {
    if (!(await dialog({ title: "Unlink Spotify?", text: "Skyline forgets its sign-in to your Spotify account, so your playlists and library won't show here. The Spotify app and your account stay exactly as they are. You can link it again any time.", ok: "Unlink Spotify", danger: true }))) return false;
    SP.status = await sky.spotify.disconnect(); SP.res = null; SP.lists = null;
    toast("Spotify unlinked"); document.dispatchEvent(new CustomEvent("sky:spotify")); return true;
  },
  // the setup card: three short steps, then "Connect"
  setupHTML() {
    const st = SP.status || {};
    return `<div class="sp-setup"><div class="sp-logo">${SPOT}</div><b>Search Spotify right here</b>
      <p>Connect your Spotify once and you can search every song, album and playlist, play them, add to your queue, like songs and add them to your playlists without leaving Skyline.</p>
      <ol>
        <li>Open the Spotify developer page and log in with your Spotify account. <button class="btn xs" data-sp="dash">Open it ↗</button></li>
        <li>Create an app. Any name works (e.g. “Skyline”). Under <b>Redirect URIs</b> paste <code class="sp-copy" data-sp="copy" title="Click to copy">${esc(st.redirect || "http://127.0.0.1:43821/callback")}</code>, tick <b>Web API</b>, and save.</li>
        <li>Open the app's <b>Settings</b>, copy the <b>Client ID</b> and paste it here:</li></ol>
      <form class="sp-id" data-sp="form"><input id="spClientId" placeholder="Client ID (32 letters and numbers)" value="${esc(st.clientId || "")}" spellcheck="false" autocomplete="off" maxlength="40"><button class="btn sm primary sp-btn">${SPOT}Connect Spotify</button></form>
      <small>You sign in on Spotify's own page: Skyline never sees your password. Playing songs straight from Skyline needs Spotify Premium (Spotify's rule); with a free account they open in the Spotify app.</small>
      <small><b>No Premium?</b> Skip this: with <b>Spicetify</b> (a free add-on for the Spotify app), Skyline can search and play through the Spotify app itself. See Settings › Music.</small></div>`;
  },
  headHTML() {
    const u = SP.status.user || {};
    return `<div class="sp-head"><span class="sp-badge">${SPOT}Spotify</span><span>${esc(u.name || "Connected")}${u.premium ? " · Premium" : " · Free"}</span><span class="sp"></span>
      <button class="btn xs ghost" data-sp="lists">Your playlists</button><button class="btn xs ghost" data-sp="off" title="Unlink your Spotify account from Skyline">Unlink</button></div>`;
  },
  resultsHTML() {
    const r = SP.res;
    if (SP.busy) return `<div class="g-loading"><i></i><i></i><i></i><span>Searching Spotify…</span></div>`;
    if (!r) return SP.lists ? this.cardsHTML("Your playlists", SP.lists) : this.recentHTML();
    if (!r.tracks.length && !r.artists.length && !r.albums.length && !r.playlists.length) return `<div class="sg-empty slim"><b>Nothing on Spotify for that.</b><p>Check the spelling, or try the artist's name.</p></div>`;
    return (r.tracks.length ? `<div class="sp-sec">Songs</div>` + r.tracks.map((t, i) => `<div class="sg-row sp-row" data-spt="${i}" style="--i:${i}">
        <div class="sg-art">${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : SPOT}<span class="sg-go"><svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg></span></div>
        <div class="sg-t"><b>${esc(t.title)}${t.explicit ? ` <i class="ex">E</i>` : ""}</b><small>${esc([t.artist, t.album].filter(Boolean).join(" · "))}</small></div>
        <span class="sg-d">${t.dur ? mmss(t.dur) : ""}</span>
        <div class="sp-acts"><button class="ibtn xs" data-spa="queue" title="Add to queue">${icon("plus")}</button><button class="ibtn xs" data-spa="like" title="Save to Liked Songs">${icon("heart")}</button><button class="ibtn xs" data-spa="add" title="Add to a playlist">⋯</button></div></div>`).join("") : "")
      + this.cardsHTML("Artists", r.artists) + this.cardsHTML("Albums", r.albums) + this.cardsHTML("Playlists", r.playlists);
  },
  // before you search: your recent searches and the songs you played from search
  recentHTML() {
    if (!RECENT.q.length && !RECENT.t.length) return `<div class="sg-empty slim"><b>Search all of Spotify</b><p>Songs, artists, albums and playlists. Tip: the assistant plays Spotify too: “play Blinding Lights”.</p></div>`;
    return (RECENT.q.length ? `<div class="sp-sec sp-sec-row"><span>Recent searches</span><button class="link" data-sprc="q">Clear</button></div>
        <div class="sp-chips">${RECENT.q.map((q, i) => `<span class="sp-chip"><button data-spq="${i}" title="Search “${esc(q)}” again"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>${esc(q)}</button><button class="x" data-spqx="${i}" title="Remove" aria-label="Remove “${esc(q)}”">${icon("x")}</button></span>`).join("")}</div>` : "")
      + (RECENT.t.length ? `<div class="sp-sec sp-sec-row"><span>Recently played from search</span><button class="link" data-sprc="t">Clear</button></div>` + RECENT.t.map((t, i) => `<div class="sg-row sp-row" data-spr="${i}" style="--i:${i}">
        <div class="sg-art">${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : SPOT}<span class="sg-go"><svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg></span></div>
        <div class="sg-t"><b>${esc(t.title)}${t.explicit ? ` <i class="ex">E</i>` : ""}</b><small>${esc([t.artist, t.album].filter(Boolean).join(" · "))}</small></div>
        <span class="sg-d">${t.dur ? mmss(t.dur) : ""}</span>
        <div class="sp-acts"><button class="ibtn xs" data-spa="queue" title="Add to queue">${icon("plus")}</button><button class="ibtn xs" data-spa="like" title="Save to Liked Songs">${icon("heart")}</button><button class="ibtn xs" data-spa="add" title="Add to a playlist">⋯</button></div></div>`).join("") : "");
  },
  cardsHTML(title, list) {
    if (!list || !list.length) return "";
    return `<div class="sp-sec">${title}</div><div class="sp-cards">${list.map(c => `<button class="sp-card ${c.kind}" data-spc="${esc(c.uri)}" title="Play ${esc(c.title)}">
      <span class="sp-img">${c.art ? `<img src="${esc(c.art)}" alt="" loading="lazy">` : SPOT}<i><svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg></i></span><b>${esc(c.title)}</b><small>${esc(c.sub || c.artist || "")}</small></button>`).join("")}</div>`;
  },
  async search(q) {
    remember.q(q); SP.busy = true; SP.res = null; this.paint();
    try { SP.res = await sky.spotify.search(q); } catch (e) { toast(clean(e), true); }
    SP.busy = false; this.paint();
  },
  clear() { SP.res = null; SP.lists = null; this.paint(); },
  paint() { const fd = $("#sgFound"); if (fd && this.connected()) fd.innerHTML = this.resultsHTML(); },
  async play(item) {
    if (item && item.kind === "track") remember.t(item);
    try { const r = await sky.spotify.play(item); toast(r.how === "played" ? `Playing “${item.title}” on Spotify` : `Opened “${item.title}” in Spotify`); FX.sound("success"); }
    catch (e) { toast(clean(e), true); }
  },
  // clicks inside the Find tab (returns true when handled)
  async click(e) {
    const a = e.target.closest("[data-sp]");
    if (a) {
      const k = a.dataset.sp;
      if (k === "dash") sky.spotify.dashboard();
      if (k === "copy") { navigator.clipboard.writeText(a.textContent.trim()).then(() => toast("Copied: paste it into Redirect URIs")); }
      if (k === "off") { if (await SpotifyUI.unlink()) return "rerender"; }
      if (k === "lists") { try { SP.res = null; SP.lists = await sky.spotify.playlists(); this.paint(); } catch (er) { toast(clean(er), true); } }
      return true;
    }
    const rq = e.target.closest("[data-spq], [data-spqx], [data-sprc]");
    if (rq) {
      if (rq.dataset.spq != null) { const q = RECENT.q[+rq.dataset.spq], inp = $("#sgFindQ"); if (q) { if (inp) inp.value = q; this.search(q); } }
      else if (rq.dataset.spqx != null) { RECENT.q.splice(+rq.dataset.spqx, 1); store.local("spRecentQ", RECENT.q); this.paint(); }
      else { RECENT[rq.dataset.sprc] = []; store.local(rq.dataset.sprc === "q" ? "spRecentQ" : "spRecentT", []); this.paint(); }
      return true;
    }
    const rr = e.target.closest("[data-spr]");
    if (rr) {
      const t = RECENT.t[+rr.dataset.spr], act = e.target.closest("[data-spa]"); if (!t) return true;
      if (!act) { this.play(t); return true; }
      try {
        if (act.dataset.spa === "queue") { await sky.spotify.queue(t.uri); toast(`Added “${t.title}” to your queue`); }
        if (act.dataset.spa === "like") { await sky.spotify.like(t.id); toast(`Saved “${t.title}” to Liked Songs`); act.classList.add("on"); }
        if (act.dataset.spa === "add") this.addMenu(act, t);
      } catch (er) { toast(clean(er), true); }
      return true;
    }
    const card = e.target.closest("[data-spc]");
    if (card) { const all = SP.res ? [...SP.res.artists, ...SP.res.albums, ...SP.res.playlists] : SP.lists || []; const c = all.find(x => x.uri === card.dataset.spc); if (c) this.play(c); return true; }
    const row = e.target.closest("[data-spt]");
    if (row && SP.res) {
      const t = SP.res.tracks[+row.dataset.spt], act = e.target.closest("[data-spa]");
      if (!act) { this.play(t); return true; }
      try {
        if (act.dataset.spa === "queue") { await sky.spotify.queue(t.uri); toast(`Added “${t.title}” to your queue`); }
        if (act.dataset.spa === "like") { await sky.spotify.like(t.id); toast(`Saved “${t.title}” to Liked Songs`); act.classList.add("on"); }
        if (act.dataset.spa === "add") this.addMenu(act, t);
      } catch (er) { toast(clean(er), true); }
      return true;
    }
    return false;
  },
  async addMenu(anchor, t) {
    let lists = SP.lists; if (!lists) { try { lists = SP.lists = await sky.spotify.playlists(); } catch (e) { return toast(clean(e), true); } }
    const mine = lists.filter(p => p.mine); if (!mine.length) return toast("You don't have playlists of your own yet", true);
    const m = $("#gMenu"); m.innerHTML = `<div class="menu-h">Add to playlist</div>` + mine.slice(0, 30).map((p, i) => `<button data-mi="${i}">${esc(p.title)}</button>`).join("");
    const r = anchor.getBoundingClientRect(); m.classList.remove("hidden");
    m.style.left = Math.min(innerWidth - m.offsetWidth - 10, r.right - m.offsetWidth) + "px";
    m.style.top = (r.bottom + m.offsetHeight + 8 > innerHeight ? Math.max(10, r.top - m.offsetHeight - 6) : r.bottom + 6) + "px";
    const close = () => { m.classList.add("hidden"); document.removeEventListener("pointerdown", out, true); };
    const out = e => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("pointerdown", out, true));
    m.onclick = async e => { const b = e.target.closest("[data-mi]"); if (!b) return; close(); const p = mine[+b.dataset.mi];
      try { await sky.spotify.addTo(p.id, t.uri); toast(`Added “${t.title}” to ${p.title}`); } catch (er) { toast(clean(er), true); } };
  },
  async submitSetup(form) {
    const id = form.querySelector("#spClientId").value.trim(), btn = form.querySelector("button");
    try {
      SP.status = await sky.spotify.setClientId(id);
      btn.disabled = true; btn.innerHTML = `${SPOT}Finish in your browser…`;
      toast("Sign in on Spotify's page in your browser, then come back");
      SP.status = await sky.spotify.connect();
      toast(`Spotify connected${SP.status.user ? ": hi " + SP.status.user.name : ""}!`); FX.confetti(innerWidth * .7, innerHeight * .5);
      return true;
    } catch (e) { toast(clean(e), true); btn.disabled = false; btn.innerHTML = `${SPOT}Connect Spotify`; return false; }
  },
};
/* ---------- your Spotify library: playlists, albums, artists you follow, liked songs ---------- */
const LIB = { section: "playlists", lists: {}, detail: null, tracks: [], busy: false, err: "" };
const SECTIONS = [["playlists", "Playlists"], ["albums", "Albums"], ["artists", "Artists"], ["liked", "Liked Songs"]];
export const SpotifyLib = {
  html() {
    if (!SpotifyUI.connected()) return `<div class="sp-libintro"><div class="sp-logo">${SPOT}</div><b>Your Spotify library, right here</b>
      <p>See all your playlists, saved albums, the artists you follow and your liked songs, and play them in one click. Spotify only shares your library after you sign in through its official login, which needs a one-time setup below.</p></div>` + SpotifyUI.setupHTML();
    const st = SP.status, head = `<div class="sp-head"><span class="sp-badge">${SPOT}Spotify</span><span>${esc((st.user || {}).name || "")}${st.user ? (st.user.premium ? " · Premium" : " · Free") : ""}</span><span class="sp"></span>
      ${st.needsReconnect ? `<button class="btn xs sp-btn" data-spl="reconnect" title="Needed once to see the artists you follow">Reconnect</button>` : ""}<button class="btn xs ghost" data-spl="refresh" title="Refresh your library">Refresh</button><button class="btn xs ghost" data-sp="off" title="Unlink your Spotify account from Skyline">Unlink</button></div>`;
    if (LIB.detail) return head + this.detailHTML();
    const seg = `<div class="seg sm sp-seg">${SECTIONS.map(([k, n]) => `<button data-spsec="${k}" class="${LIB.section === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
    const list = LIB.lists[LIB.section];
    let body;
    if (LIB.busy && !list) body = `<div class="g-loading"><i></i><i></i><i></i><span>Loading your ${LIB.section === "liked" ? "liked songs" : LIB.section}…</span></div>`;
    else if (LIB.err && !list) body = `<div class="sg-empty slim"><b>Couldn't load that.</b><p>${esc(LIB.err)}</p></div>`;
    else if (!list) body = "";
    else if (LIB.section === "liked") body = this.tracksHTML(list, true);
    else body = list.length ? `<div class="sp-lib">${list.map((c, i) => `<div class="sp-lc ${c.kind}" data-lc="${i}" title="${esc(c.title)}">
        <span class="sp-img">${c.art ? `<img src="${esc(c.art)}" alt="" loading="lazy">` : SPOT}<button class="sp-play" data-lplay="${i}" title="Play" aria-label="Play"><svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg></button></span><b>${esc(c.title)}</b><small>${esc(c.sub || "")}</small></div>`).join("")}</div>`
      : `<div class="sg-empty slim"><b>Nothing here yet.</b><p>${LIB.section === "artists" ? "Follow artists on Spotify and they'll show up here." : "Save some on Spotify and they'll show up here."}</p></div>`;
    if (!list && !LIB.busy) this.load(LIB.section);
    return head + seg + body;
  },
  detailHTML() {
    const d = LIB.detail;
    return `<div class="sp-detail"><button class="btn xs ghost" data-spl="back">← Back</button>
      <div class="sp-dhead"><span class="sp-img big ${d.kind}">${d.art ? `<img src="${esc(d.art)}" alt="">` : SPOT}</span>
        <div><small>${esc({ playlist: "Playlist", album: "Album", artist: "Artist · top songs" }[d.kind] || "")}</small><h3>${esc(d.title)}</h3><p>${esc(d.sub || "")}</p>
          <button class="btn sm sp-btn" data-spl="playall">${SPOT}Play</button></div></div>
      ${LIB.busy ? `<div class="g-loading"><i></i><i></i><i></i><span>Loading songs…</span></div>` : this.tracksHTML(LIB.tracks, false)}</div>`;
  },
  tracksHTML(list, liked) {
    if (!list.length) return `<div class="sg-empty slim"><b>No songs.</b></div>`;
    return (liked ? `<div class="row sp-likedbar"><button class="btn sm sp-btn" data-spl="playliked">${SPOT}Play liked songs</button><span class="muted">${list.length} most recent</span></div>` : "")
      + list.map((t, i) => `<div class="sg-row sp-row" data-ltk="${i}" style="--i:${Math.min(i, 30)}">
        <div class="sg-art">${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : SPOT}<span class="sg-go"><svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg></span></div>
        <div class="sg-t"><b>${esc(t.title)}${t.explicit ? ` <i class="ex">E</i>` : ""}</b><small>${esc([t.artist, t.album].filter(Boolean).join(" · "))}</small></div>
        <span class="sg-d">${t.dur ? mmss(t.dur) : ""}</span>
        <div class="sp-acts"><button class="ibtn xs" data-ltq title="Add to queue">${icon("plus")}</button><button class="ibtn xs" data-ltl title="Save to Liked Songs">${icon("heart")}</button></div></div>`).join("");
  },
  async load(section) {
    LIB.busy = true; LIB.err = ""; this.paint();
    try { LIB.lists[section] = await sky.spotify.library(section); } catch (e) { LIB.err = clean(e); }
    LIB.busy = false; this.paint();
  },
  async open(item) {
    LIB.detail = item; LIB.tracks = []; LIB.busy = true; this.paint();
    try { LIB.tracks = await sky.spotify.tracks(item.kind, item.id); } catch (e) { toast(clean(e), true); }
    LIB.busy = false; this.paint();
  },
  paint() { const box = $("#spLib"); if (box) { box.innerHTML = this.html(); } },
  async click(e) {
    const sec = e.target.closest("[data-spsec]"); if (sec) { LIB.section = sec.dataset.spsec; this.paint(); return true; }
    const a = e.target.closest("[data-spl]");
    if (a) {
      const k = a.dataset.spl;
      if (k === "back") { LIB.detail = null; this.paint(); }
      if (k === "refresh") { LIB.lists = {}; LIB.detail = null; this.paint(); }
      if (k === "reconnect") { try { toast("Sign in on Spotify's page in your browser, then come back"); SP.status = await sky.spotify.connect(); LIB.lists = {}; this.paint(); toast("Reconnected"); } catch (er) { toast(clean(er), true); } }
      if (k === "playall" && LIB.detail) SpotifyUI.play(LIB.detail);
      if (k === "playliked") { const l = LIB.lists.liked || []; try { const r = await sky.spotify.playList(l.map(t => t.uri)); toast(r.how === "played" ? "Playing your liked songs" : "Opened in Spotify"); } catch (er) { toast(clean(er), true); } }
      return true;
    }
    const pl = e.target.closest("[data-lplay]"); if (pl) { const c = (LIB.lists[LIB.section] || [])[+pl.dataset.lplay]; if (c) SpotifyUI.play(c); return true; }
    const card = e.target.closest("[data-lc]"); if (card) { const c = (LIB.lists[LIB.section] || [])[+card.dataset.lc]; if (c) this.open(c); return true; }
    const row = e.target.closest("[data-ltk]");
    if (row) {
      const list = LIB.detail ? LIB.tracks : LIB.lists.liked || [], t = list[+row.dataset.ltk]; if (!t) return true;
      try {
        if (e.target.closest("[data-ltq]")) { await sky.spotify.queue(t.uri); toast(`Added “${t.title}” to your queue`); }
        else if (e.target.closest("[data-ltl]")) { await sky.spotify.like(t.id); toast(`Saved “${t.title}”`); }
        else SpotifyUI.play(LIB.detail && LIB.detail.kind !== "artist" ? t : { ...t, solo: true });
      } catch (er) { toast(clean(er), true); }
      return true;
    }
    return false;
  },
  reset() { LIB.lists = {}; LIB.detail = null; },
};
const clean = e => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
