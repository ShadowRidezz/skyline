// The Music page's right-hand panel: lyrics, up next, your Spotify library, search, recent songs and stats.
// (Adding your own song files was removed; the small player below stays only for songs added before.)
import { Stats, Queue } from "./musicextra.js";
import { $, $$, esc, sky, toast, mmss, debounce, store } from "./util.js";
import { FX } from "./fx.js";
import { SpotifyUI, SpotifyLib } from "./spotify.js";

const NOTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const TABS = ["lyrics", "queue", "lib", "find", "recent", "stats"];
const S = { list: [], filter: "", tab: TABS.includes(store.local("songsTab")) ? store.local("songsTab") : "lyrics", found: [], q: "" };
let Music = null;

/* ---------- the player ---------- */
export const Player = {
  audio: null, queue: [], idx: -1, shuffle: false, repeat: 0, cur: null, vol: store.local("songVol") ?? 1,
  init() {
    const a = this.audio = new Audio(); a.preload = "auto"; a.volume = this.vol;
    a.addEventListener("play", () => this.emit()); a.addEventListener("pause", () => this.emit());
    a.addEventListener("loadedmetadata", () => this.emit()); a.addEventListener("seeked", () => this.emit());
    a.addEventListener("timeupdate", () => { if (Music && this.cur) Music.localTick(a.currentTime); });
    a.addEventListener("ended", () => { if (this.repeat === 1) { a.currentTime = 0; a.play(); } else this.step(1, true); });
    a.addEventListener("error", () => { if (!this.cur) return; toast(`Couldn't play “${this.cur.title}”. Is the file still there?`, true); this.step(1, true); });
    if ("mediaSession" in navigator) {   // the keyboard's media keys and Windows' media flyout control Skyline's player too
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => this.play()); ms.setActionHandler("pause", () => this.pause());
      ms.setActionHandler("nexttrack", () => this.step(1)); ms.setActionHandler("previoustrack", () => this.step(-1));
      ms.setActionHandler("seekto", d => this.seek(d.seekTime));
    }
  },
  active() { return !!this.cur; },
  canStart() { return !!this.cur || S.list.length > 0; },
  meta() {
    const s = this.cur, a = this.audio; if (!s) return { on: false };
    return { on: true, local: true, title: s.title, artist: s.artist, album: s.album, app: "Skyline", art: s.art ? `sky://song/${s.id}.jpg` : "",
      playing: !a.paused, pos: a.currentTime || 0, at: Date.now(), dur: a.duration || s.dur || 0, shuffle: this.shuffle ? 1 : 0, repeat: this.repeat,
      can: { seek: true, shuffle: true, repeat: true, next: true, prev: true } };
  },
  emit() {
    if (Music) Music.setLocal(this.meta());
    if ("mediaSession" in navigator && this.cur) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: this.cur.title, artist: this.cur.artist || "", album: this.cur.album || "" });
      navigator.mediaSession.playbackState = this.audio.paused ? "paused" : "playing";
    }
    $$("[data-song]").forEach(r => { r.classList.toggle("now", !!this.cur && r.dataset.song === this.cur.id); r.classList.toggle("playing", !!this.cur && r.dataset.song === this.cur.id && !this.audio.paused); });
  },
  // play a list of songs starting at one of them
  start(ids, at = 0, { shuffle } = {}) {
    if (!ids.length) return toast("Add some songs first", true);
    if (shuffle != null) this.shuffle = !!shuffle;
    this.queue = ids.slice(); this.idx = Math.max(0, Math.min(at, ids.length - 1));
    if (this.shuffle) { const first = this.queue[this.idx]; this.queue = shuffled(this.queue.filter(x => x !== first)); this.queue.unshift(first); this.idx = 0; }
    this.load(this.queue[this.idx], true);
  },
  load(id, autoplay) {
    const s = S.list.find(x => x.id === id); if (!s) return;
    this.cur = s; this.audio.src = `sky://song/${s.id}`;
    if (autoplay) { if (Music && Music.ext && Music.ext.playing) sky.media.cmd("pause").catch(() => {}); this.audio.play().catch(e => toast("Couldn't play: " + e.message, true)); sky.songs.played(id); }
    this.emit();
  },
  play() { if (!this.cur) { const ids = S.list.map(x => x.id); return this.start(ids, 0, { shuffle: true }); } if (Music && Music.ext && Music.ext.playing) sky.media.cmd("pause").catch(() => {}); this.audio.play().catch(() => {}); },
  pause() { this.audio.pause(); },
  toggle() { this.audio.paused ? this.play() : this.pause(); },
  seek(t) { if (this.cur && isFinite(t)) { this.audio.currentTime = Math.max(0, t); this.emit(); } },
  step(d, auto) {
    if (!this.queue.length) return;
    if (d < 0 && this.audio.currentTime > 4) { this.seek(0); return; }
    let i = this.idx + d;
    if (i >= this.queue.length) { if (this.repeat === 2 || !auto) i = 0; else { this.pause(); this.seek(0); return; } }
    if (i < 0) i = this.queue.length - 1;
    this.idx = i; this.load(this.queue[i], true);
  },
  stop() { this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); this.cur = null; this.queue = []; this.idx = -1; this.emit(); },
  cmd(c, v) {
    if (c === "toggle") return this.toggle();
    if (c === "play") return this.play();
    if (c === "pause") return this.pause();
    if (c === "next") return this.step(1);
    if (c === "prev") return this.step(-1);
    if (c === "seek") return this.seek(+v);
    if (c === "shuffle") { this.shuffle = !!+v; if (this.shuffle && this.cur) { const rest = shuffled(this.queue.filter(x => x !== this.cur.id)); this.queue = [this.cur.id, ...rest]; this.idx = 0; } this.emit(); return; }
    if (c === "repeat") { this.repeat = (+v || 0) % 3; this.emit(); }
  },
};
function shuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- the panel ---------- */
function rows() {
  const f = S.filter.toLowerCase(), list = f ? S.list.filter(s => `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(f)) : S.list;
  return list.slice().sort((a, b) => (a.artist || "~").localeCompare(b.artist || "~") || (a.album || "").localeCompare(b.album || "") || a.title.localeCompare(b.title));
}
function render() {
  const box = $("#songs"); if (!box) return;
  $$("#songTabs button").forEach(b => { const on = b.dataset.v === S.tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  const cur = $(`#songTabs button[data-v="${S.tab}"]`), line = $(".mu-tabline");
  if (cur && line) { line.style.width = cur.offsetWidth + "px"; line.style.transform = `translateX(${cur.offsetLeft}px)`; }
  $$(".sg-pane").forEach(p => p.classList.toggle("hidden", p.dataset.pane !== S.tab));
  $$(".mu-lytools").forEach(t => t.classList.toggle("hidden", S.tab !== "lyrics"));
  if (S.tab === "stats") Stats.render();
  if (S.tab === "queue") Queue.render();
  document.body.classList.toggle("lib-open", S.tab === "lib");
  if (S.tab === "lib" && !S.libPainted) { S.libPainted = true; SpotifyLib.paint();   // and ask again: never trust an old "not connected"
    SpotifyUI.status(true).then(() => { if (S.tab === "lib") SpotifyLib.paint(); }); }
  if (S.tab !== "lib") S.libPainted = false;
  const fd = $("#sgFound");
  const spHead = $("#spHead"); if (spHead) spHead.innerHTML = S.tab === "find" && SpotifyUI.connected() ? SpotifyUI.headHTML() : "";
  if ($("#sgFindQ")) $("#sgFindQ").placeholder = SpotifyUI.connected() ? "Search Spotify: songs, artists, albums, playlists…" : "Any song or artist… e.g. Blinding Lights";
  if (S.tab === "find" && fd && SpotifyUI.connected()) { SpotifyUI.paint(); return; }
  if (S.tab === "find" && fd && !fd.dataset.busy) {
    fd.innerHTML = (S.found.length ? "" : S.setup ? SpotifyUI.setupHTML() : "") + (S.found.length ? S.found.map((r, i) => `<div class="sg-row web" data-found-song="${i}" style="--i:${Math.min(i, 30)}">
        <div class="sg-art">${r.art ? `<img src="${esc(r.art)}" alt="" loading="lazy">` : NOTE}</div>
        <div class="sg-t"><b>${esc(r.title)}${r.explicit ? ` <i class="ex">E</i>` : ""}</b><small>${esc([r.artist, r.album, r.year].filter(Boolean).join(" · "))}</small></div>
        <div class="sg-web">${S.hasSp ? `<button class="btn xs sp-btn" data-sgw="spotify" title="Play it in your Spotify app">${SpotifyUI.icon}Play</button><button class="btn xs ghost" data-sgw="youtube" title="Play it on YouTube in your browser">YouTube</button>`
          : `<button class="btn xs primary" data-sgw="youtube" title="Play it on YouTube in your browser">▶ YouTube</button><button class="btn xs" data-sgw="spotify" title="Open it in Spotify">Spotify</button>`}</div></div>`).join("")
      : `<div class="sg-empty slim"><b>Find any song</b><p>${S.hasSp ? "Search a song or artist and press Play: it starts right away in your Spotify app. Nothing to set up." : "Search a song or artist, then play it on YouTube."}</p>
          ${S.setup ? "" : `<button class="btn xs ghost" data-sg="spsetup">More Spotify features (your playlists, queue, likes)…</button>`}</div>`);
  }
}

async function refresh() { if (!sky) return; S.list = await sky.songs.list().catch(() => []); render(); }
async function addPaths(paths) {
  if (!paths.length) return;
  toast(`Adding music…`);
  try { const added = await sky.songs.add(paths); await refresh(); afterAdd(added); } catch (e) { toast(e.message, true); }
}
function afterAdd(added) {
  if (!added) return;
  if (!added.length) return toast("Those songs are already in your music (or weren't songs Skyline can play)");
  toast(`Added ${added.length} song${added.length > 1 ? "s" : ""} ✦`); FX.sound("success");
  S.tab = "mine"; render();
  if (!Player.cur) Player.start(added.map(s => s.id), 0);
}
export async function pickSongs(folder) {
  if (!sky) return;
  const added = await sky.songs.pick(folder).catch(e => { toast(e.message, true); return null; });
  if (added) { await refresh(); afterAdd(added); }
}
async function find(q) {
  if (SpotifyUI.connected()) { if (q) SpotifyUI.search(q); else SpotifyUI.clear(); return; }
  S.q = q; const fd = $("#sgFound"); if (!q) { S.found = []; return render(); }
  fd.dataset.busy = "1"; fd.innerHTML = `<div class="g-loading"><i></i><i></i><i></i><span>Searching…</span></div>`;
  try { S.found = await sky.songs.search(q); } catch (e) { S.found = []; toast(e.message, true); }
  delete fd.dataset.busy; render();
  if (!S.found.length) fd.innerHTML = `<div class="sg-empty slim"><b>Nothing found for “${esc(q)}”.</b><p>Check the spelling, or try the artist's name.</p></div>`;
}
function songMenu(anchor, s) {
  const m = $("#gMenu"); if (!m) return;
  const items = [["▶ Play", () => Player.start(rows().map(x => x.id), rows().findIndex(x => x.id === s.id))], ["⤷ Play next", () => { if (!Player.cur) return Player.start([s.id]); Player.queue.splice(Player.idx + 1, 0, s.id); toast(`“${s.title}” plays next`); }],
    ["📁 Show in folder", () => sky.songs.reveal(s.id)], null, ["✕ Remove from Skyline", async () => { if (Player.cur && Player.cur.id === s.id) Player.stop(); await sky.songs.remove([s.id]); refresh(); toast("Removed. The file itself is untouched"); }, "danger"]];
  m.innerHTML = items.map((it, i) => it ? `<button data-mi="${i}" class="${it[2] || ""}">${esc(it[0])}</button>` : "<hr>").join("");
  const r = anchor.getBoundingClientRect(); m.classList.remove("hidden");
  m.style.left = Math.min(innerWidth - m.offsetWidth - 10, r.right - m.offsetWidth) + "px";
  m.style.top = (r.bottom + m.offsetHeight + 8 > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + "px";
  const close = () => { m.classList.add("hidden"); document.removeEventListener("pointerdown", out, true); };
  const out = e => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("pointerdown", out, true));
  m.onclick = e => { const b = e.target.closest("[data-mi]"); if (!b) return; close(); items[+b.dataset.mi][1](); };
}

export const Songs = {
  get list() { return S.list; },
  async init(music) {
    Music = music; Player.init();
    if (!sky) return;
    await refresh();
    await SpotifyUI.status();
    S.hasSp = await sky.songs.hasSpotify().catch(() => false);
    const box = $("#songs");
    $("#songTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.tab = b.dataset.v; store.local("songsTab", S.tab); render(); if (S.tab === "find") setTimeout(() => $("#sgFindQ").focus(), 30); });
    $("#sgFindForm").addEventListener("submit", e => { e.preventDefault(); find($("#sgFindQ").value.trim()); });
    $("#sgFindQ").addEventListener("input", e => { if (!e.target.value.trim() && SpotifyUI.connected()) SpotifyUI.clear(); });   // emptied: back to your recent searches
    box.addEventListener("submit", async e => { const f = e.target.closest('[data-sp="form"]'); if (!f) return; e.preventDefault(); e.stopPropagation(); if (await SpotifyUI.submitSetup(f)) { SpotifyLib.reset(); S.libPainted = false; render(); } }, true);
    box.addEventListener("click", async e => {
      if (S.tab === "lib" && e.target.closest("[data-spsec], [data-spl], [data-lplay], [data-lc], [data-ltk]")) { await SpotifyLib.click(e); return; }
      if ((S.tab === "find" || S.tab === "lib") && e.target.closest("[data-sp], [data-spc], [data-spt], [data-spr], [data-spq], [data-spqx], [data-sprc]")) { const r = await SpotifyUI.click(e); if (r === "rerender") { SpotifyLib.reset(); S.libPainted = false; render(); } return; }
      const a = e.target.closest("[data-sg]");
      if (a && a.dataset.sg === "spsetup") { S.setup = true; return render(); }
      const w = e.target.closest("[data-sgw]"), fr = e.target.closest("[data-found-song]");
      if (w && fr) {
        const r = S.found[+fr.dataset.foundSong], q = `${r.title} ${r.artist}`;
        if (w.dataset.sgw === "youtube") { toast(`Opening “${r.title}” on YouTube…`); sky.songs.youtube(q).catch(er => toast(er.message, true)); }
        else {
          toast(`🎧 Finding “${r.title}” on Spotify…`); w.disabled = true;
          sky.songs.spotify(q, r.title).then(res => toast(res.how === "played" ? `▶ Playing “${res.title || r.title}” on Spotify` : res.how === "opened" ? `Opened “${res.title || r.title}” in Spotify` : `Couldn't find it exactly, so Spotify is searching for it`))
            .catch(er => toast(er.message, true)).finally(() => { w.disabled = false; });
        }
      }
    });
    addEventListener("resize", () => { const cur = $(`#songTabs button[data-v="${S.tab}"]`), line = $(".mu-tabline"); if (cur && line) { line.style.width = cur.offsetWidth + "px"; line.style.transform = `translateX(${cur.offsetLeft}px)`; } });
    render();
  },
  // for the assistant: play by id, by artist, or everything shuffled
  async play({ id, artist, query, shuffle } = {}) {
    if (!S.list.length || (id && !S.list.some(s => s.id === id))) await refresh();
    if (!S.list.length) { return false; }
    if (id) { const ids = rows().map(x => x.id); Player.start(ids, Math.max(0, ids.indexOf(id)), { shuffle: false }); return true; }
    if (artist) { const ids = S.list.filter(s => s.artist === artist).map(s => s.id); Player.start(ids, 0, { shuffle: true }); return true; }
    const q = String(query || "").toLowerCase(), ids = (q ? S.list.filter(s => `${s.title} ${s.artist}`.toLowerCase().includes(q)) : S.list).map(s => s.id);
    Player.start(ids.length ? ids : S.list.map(s => s.id), 0, { shuffle: shuffle !== false }); return true;
  },
  show(tab) { if (tab) { S.tab = tab === "mine" ? "lyrics" : tab; render(); } else render(); },
  refresh,
};
