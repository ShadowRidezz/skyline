// Music: whatever Windows says is playing (Spotify, a YouTube tab, Apple Music...), its controls,
// synced lyrics, recently played, and the audio analysis that makes the city move with the beat.
import { Scene } from "./scene/scene.js";
import { icon } from "./social/icons.js";
import { Themes } from "./themes.js";
import { $, $$, esc, sky, toast, clamp, mmss, palette, store, debounce, fpsLoop, toHsl, fromHsl } from "./util.js";
import { Player } from "./songs.js";

const ICON = {
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`,
};
export function appName(id) {
  const s = (id || "").toLowerCase();
  const known = [["spotify", "Spotify"], ["chrome", "Chrome"], ["msedge", "Edge"], ["firefox", "Firefox"], ["opera", "Opera"], ["brave", "Brave"],
    ["applemusic", "Apple Music"], ["itunes", "iTunes"], ["zunemusic", "Media Player"], ["discord", "Discord"], ["vlc", "VLC"], ["tidal", "TIDAL"],
    ["deezer", "Deezer"], ["amazon", "Amazon Music"], ["soundcloud", "SoundCloud"], ["youtube", "YouTube Music"], ["foobar", "foobar2000"], ["musicbee", "MusicBee"]];
  const k = known.find(([n]) => s.includes(n)); if (k) return k[1];
  return ((id || "").split(/[\\/!]/).filter(Boolean).pop() || "").replace(/\.exe$/i, "");
}
// word-timed lines: [{ t, d, words: [{ t, d, w }] }] -> lines for the list, with a quiet "• • •" in long gaps
function wordLines(src) {
  const out = [];
  src.forEach((l, i) => {
    out.push({ t: l.t, end: l.t + l.d, text: l.words.map(w => w.w).join("").trim(), words: l.words });
    const next = src[i + 1];
    if (next && next.t - (l.t + l.d) > 8) out.push({ t: l.t + l.d + .4, text: "" });
  });
  return out;
}
function parseLrc(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; if (!tags.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const t of tags) out.push({ t: +t[1] * 60 + +t[2], text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}

// how far ahead of Spotify's reported position word-timed lyrics run (measured: see the notes in tickWords' tests)
const WORD_LEAD = 0.1;

/* ---------- listening to the speakers: a real spectrum when possible, the speaker level otherwise ---------- */
const Audio = {
  ctx: null, an: null, freq: null, stream: null, ok: false, failed: false, starting: false,
  bands: new Float32Array(48), peaks: { bass: .2, mid: .2, high: .2 }, avgBass: 0, lastBeat: 0,
  out: { level: 0, bass: 0, mid: 0, high: 0, beat: false },
  async start() {
    if (this.ok || this.starting || this.failed || !navigator.mediaDevices?.getDisplayMedia) return this.ok;
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } });
      const at = stream.getAudioTracks()[0];
      if (!at) throw new Error("no system audio");
      stream.getVideoTracks().forEach(t => t.stop());
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(new MediaStream([at]));
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 2048; this.an.smoothingTimeConstant = .7;
      src.connect(this.an);   // analysed only, never played back
      this.freq = new Uint8Array(this.an.frequencyBinCount);
      this.stream = stream; this.ok = true;
      at.addEventListener("ended", () => this.stop());
    } catch (e) { this.failed = true; console.log("[audio] spectrum unavailable, using the speaker level:", e.message); }
    this.starting = false;
    return this.ok;
  },
  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = this.an = this.stream = null; this.ok = false;
  },
  read() {  // -> { level, bass, mid, high, beat } all 0..1, plus this.bands for the visualisers
    const o = this.out;
    if (!this.ok) return o;
    this.an.getByteFrequencyData(this.freq);
    const f = this.freq, hz = this.ctx.sampleRate / 2 / f.length;
    const avg = (lo, hi) => { let s = 0, n = 0; for (let i = Math.max(1, Math.floor(lo / hz)); i <= Math.ceil(hi / hz) && i < f.length; i++) { s += f[i]; n++; } return n ? s / n / 255 : 0; };
    const raw = { bass: avg(30, 160), mid: avg(160, 2200), high: avg(2200, 10000) };
    for (const k in raw) { this.peaks[k] = Math.max(raw[k], this.peaks[k] * .996, .08); o[k] = clamp(raw[k] / this.peaks[k], 0, 1); }
    o.level = clamp(o.bass * .45 + o.mid * .4 + o.high * .15, 0, 1);
    this.avgBass = this.avgBass * .94 + raw.bass * .06;
    const now = performance.now();
    o.beat = raw.bass > this.avgBass * 1.32 && raw.bass > this.peaks.bass * .55 && now - this.lastBeat > 280;
    if (o.beat) this.lastBeat = now;
    const n = this.bands.length, lo = Math.log(40), hi = Math.log(12000);   // 48 bands, spaced like hearing
    for (let b = 0; b < n; b++) {
      const a = Math.exp(lo + (hi - lo) * b / n), z = Math.exp(lo + (hi - lo) * (b + 1) / n);
      const v = avg(a, z), boost = .8 + b / n * .9;
      this.bands[b] = clamp(v * boost / Math.max(.35, this.peaks.mid * 1.1 + .1), 0, 1);
    }
    return o;
  },
};

export const Music = {
  meta: { on: false }, vol: null, apps: { list: [], pin: "" }, game: false, blocked: new Set(), got: 0,
  meterLevel: 0, meterBeats: -1, color: null, color2: null, lyrics: null, lyricKey: "", lineIdx: -1, history: [], raf: 0,
  visualizer: true, lyricsOn: true, ext: { on: false }, localMeta: { on: false },

  pos() {
    const m = this.meta; if (!m.on) return 0;
    const since = m.playing ? (Date.now() - (m.at > 0 ? Math.min(m.at, Date.now()) : this.got)) / 1000 : 0;
    return clamp(m.pos + since, 0, m.dur > 0 ? m.dur : Infinity);
  },
  cmd(c, v) {
    if (!sky) return;
    if (this.meta.local && !["vol", "mute", "pin"].includes(c)) { Player.cmd(c, v); return; }   // Skyline's own player
    if (!this.meta.on && (c === "toggle" || c === "play") && Player.canStart()) { Player.play(); return; }
    if (!this.meta.on && !["vol", "mute", "pin"].includes(c)) return toast("Start some music in Spotify or any music app");
    sky.media.cmd(c, v).catch(e => toast(e.message, true));
    if (c === "toggle") { this.meta.playing = !this.meta.playing; this.got = Date.now(); this.renderControls(); this.loop(); }
  },

  /* ---------- incoming: what Windows says is playing, and Skyline's own player ---------- */
  setMeta(m) {
    if (m.on && /skyline|electron/i.test(m.app || "")) m = { on: false };   // Skyline's own player, as Windows sees it
    this.ext = m;
    this.pickSource();
  },
  setLocal(m) { this.localMeta = m || { on: false }; this.pickSource(); },
  // Skyline's player wins while it's playing, or paused when nothing else plays
  pickSource() {
    const L = this.localMeta, E = this.ext;
    this.render(L.on && (L.playing || !E.on || !E.playing) ? L : E);
  },
  localTick(pos) { if (this.meta.local) { this.meta.pos = pos; this.meta.at = Date.now(); this.got = Date.now(); } },
  render(m) {
    const prev = this.meta;
    if (m.on && !m.local && (m.title === document.title || m.title === "Skyline")) m = { on: false };
    this.meta = m; this.got = Date.now();
    document.body.classList.toggle("music-on", !!m.on);
    document.body.classList.toggle("music-playing", !!m.playing);
    const same = prev.on && m.on && prev.title === m.title && prev.artist === m.artist;
    $$("[data-np-title]").forEach(e => e.textContent = m.on ? m.title : "Nothing playing");
    $$("[data-np-artist]").forEach(e => e.textContent = m.on ? (m.artist || m.album || "") : "Play something in Spotify or any music app and it shows up here.");
    $$("[data-np-album]").forEach(e => e.textContent = m.on ? [m.album, appName(m.app)].filter(Boolean).join(" · ") : "");
    $$("[data-np-app]").forEach(e => e.textContent = m.on ? (m.playing ? "Now playing" : "Paused") + (appName(m.app) ? " · " + appName(m.app) : "") : "Music");
    if ((m.art || "") !== (prev.art || "")) this.setArt(m.art);
    if (!m.on) this.setColors(null);
    this.renderControls();
    if (m.on && !same) { this.addHistory(m); this.loadLyrics(); }
    if (!same) this.paintLySync();
    if (!m.on) { this.lyrics = null; this.renderLyrics(); }
    this.loop();
  },
  setArt(url) {
    $$("img[data-np-art]").forEach(img => {
      if (!url) { img.classList.remove("on"); img.removeAttribute("src"); this.ringColors = this.barColors = null; return; }
      img.onload = () => { img.classList.add("on"); if (img.dataset.npArt === "main") { this.setColors(palette(img)); this.setArtColors(img); } };
      // load it as a readable image, so its colours can be measured (the rings, bars and glow match the cover)
      img.onerror = () => { if (img.crossOrigin) { img.removeAttribute("crossorigin"); img.src = url; } else img.classList.remove("on"); };
      img.crossOrigin = "anonymous";
      img.src = url;
    });
    // (the glow behind the player uses the cover's colours, not a blurred copy of it: white covers turned everything grey)
  },
  // The visualizer takes its colours from the cover itself: each ring line gets the colour of the cover in the
  // direction it points, each bar the colour of that column. Red cover, red lines; a colourful cover, colourful
  // lines; black and white, white lines.
  setArtColors(img) {
    try {
      const S = 40, c = document.createElement("canvas"); c.width = c.height = S;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, S, S);
      const d = g.getImageData(0, 0, S, S).data;
      const px = (x, y) => { const i = (clamp(Math.round(y), 0, S - 1) * S + clamp(Math.round(x), 0, S - 1)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      // colourful pixels count most (black-and-white stripes shouldn't wash a purple cover out to grey)
      const all = []; for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) all.push([x, y]);
      const blend = pts => { let r = 0, gg = 0, b = 0, w = 0;
        for (const [x, y] of pts) { const q = px(x, y), [, s, l] = toHsl(q), k = s * s * (1 - Math.abs(l - .5) * 1.6) + .0004; r += q[0] * k; gg += q[1] * k; b += q[2] * k; w += k; }
        return { rgb: [r / w, gg / w, b / w], w: w / pts.length }; };
      const glow = rgb => { const [h, s, l] = toHsl(rgb); return fromHsl(h, clamp(s * 1.3, .6, 1), clamp(l, .52, .72)); };
      const whole = blend(all), mono = whole.w < .012;   // a black-and-white cover: white lines
      const main = mono ? "#e8e6f2" : glow(whole.rgb);
      const tune = c => mono ? "#e8e6f2" : c.w < .02 ? main : glow(c.rgb);   // a grey patch of a colourful cover takes the cover's main colour
      const ring = [];
      for (let i = 0; i < 96; i++) {
        const a = i / 96 * Math.PI * 2 - Math.PI / 2, pts = [];
        for (const rr of [.24, .32, .4, .47]) for (const da of [-.1, -.05, 0, .05, .1]) pts.push([S / 2 + Math.cos(a + da) * rr * S, S / 2 + Math.sin(a + da) * rr * S]);
        ring.push(tune(blend(pts)));
      }
      const bars = [];
      for (let i = 0; i < 48; i++) { const x = (i + .5) / 48 * (S - 1), pts = []; for (let y = 2; y < S - 1; y += 3) for (const dx of [-1, 0, 1]) pts.push([x + dx, y]); bars.push(tune(blend(pts))); }
      this.ringColors = ring; this.barColors = bars;
    } catch (e) { this.ringColors = this.barColors = null; }   // a cover the page can't read: the two-colour look instead
  },
  setColors(p) {
    this.color = p ? p[0] : null; this.color2 = p ? p[1] : null;
    const r = document.documentElement.style;
    if (p) { r.setProperty("--np-color", p[0]); r.setProperty("--np-color2", p[1]); } else { r.removeProperty("--np-color"); r.removeProperty("--np-color2"); }
    Scene.setTint(Themes.doc.albumTint ? this.color : null);
    document.dispatchEvent(new CustomEvent("sky:album", { detail: p || null }));
  },
  renderControls() {
    const m = this.meta, can = m.can || {};
    $$("[data-np-play]").forEach(b => { b.innerHTML = m.playing ? ICON.pause : ICON.play; b.title = m.playing ? "Pause (Space)" : "Play (Space)"; });
    $$('[data-np="shuffle"]').forEach(b => { b.classList.toggle("on", !!m.shuffle); b.classList.toggle("hidden", m.shuffle == null && !can.shuffle); });
    $$('[data-np="repeat"]').forEach(b => { b.classList.toggle("on", !!m.repeat); b.dataset.mode = m.repeat || 0; b.classList.toggle("hidden", m.repeat == null && !can.repeat);
      b.title = ["Repeat off", "Repeat this song", "Repeat all"][m.repeat || 0]; });
    $$("[data-np-seek]").forEach(s => s.classList.toggle("noseek", !can.seek));
    this.progress();
  },
  progress() {
    const m = this.meta, ok = m.on && m.dur > 1, pos = this.pos(), stale = m.playing && pos >= m.dur + 8;
    $$("[data-np-time]").forEach(e => e.classList.toggle("hidden", !ok || stale));
    if (!ok) return;
    const p = clamp(pos / m.dur, 0, 1);
    $$("[data-np-fill]").forEach(e => e.style.transform = `scaleX(${p})`);
    $$("[data-np-pos]").forEach(e => e.textContent = mmss(Math.min(pos, m.dur)));
    $$("[data-np-dur]").forEach(e => e.textContent = mmss(m.dur));
  },
  setVol(v) {
    this.vol = v; if (!v || v.vol < 0) return;
    $$("[data-np-vol]").forEach(r => { if (document.activeElement !== r) r.value = v.muted ? 0 : v.vol; r.style.setProperty("--v", (v.muted ? 0 : v.vol) + "%"); });
    $$('[data-np="mute"]').forEach(b => { b.classList.toggle("on", v.muted); b.innerHTML = volIcon(v.muted ? 0 : v.vol); });
  },
  setApps(a) {
    this.apps = a;
    const sel = $("#npSource"); if (!sel) return;
    const opts = [`<option value="">Automatic${a.list.length ? "" : " (nothing playing)"}</option>`]
      .concat(a.list.map(x => `<option value="${esc(x.id)}">${esc(appName(x.id))}${x.title ? " – " + esc(x.title).slice(0, 40) : ""}${x.status === 4 ? " ▶" : ""}</option>`));
    sel.innerHTML = opts.join(""); sel.value = a.pin || "";
    $("#npSourceRow").classList.toggle("hidden", a.list.length < 2 && !a.pin);
  },

  /* ---------- lyrics (LRCLIB, free) ---------- */
  async loadLyrics() {
    const m = this.meta, key = [m.title, m.artist].join("|");
    this.lyricKey = key; this.lyrics = null; this.lineIdx = -1; this.renderLyrics("loading");
    if (!this.lyricsOn || !sky) return this.renderLyrics();
    const r = await sky.media.lyrics({ title: m.title, artist: m.artist, album: m.album, dur: m.dur }).catch(() => null);
    if (this.lyricKey !== key) return;
    this.lyrics = r ? (r.words && r.words.length ? { lines: wordLines(r.words), plain: r.plain, instrumental: false, wordLevel: true, source: r.source }
      : { lines: parseLrc(r.synced), plain: r.plain, instrumental: r.instrumental, source: r.source || "LRCLIB" }) : null;
    this.renderLyrics(); this.paintLySync();
  },
  renderLyrics(state) {
    this.lineIdx = -1;
    const L = this.lyrics;
    let html;
    if (state === "loading") html = `<div class="ly-empty">Finding the lyrics…</div>`;
    else if (!this.lyricsOn) html = `<div class="ly-empty">Lyrics are turned off in Settings › Music.</div>`;
    else if (!this.meta.on) html = `<div class="ly-empty">Lyrics appear here when a song is playing.</div>`;
    else if (!L) html = `<div class="ly-empty">No lyrics found for this song.</div>`;
    else if (L.instrumental) html = `<div class="ly-empty">Instrumental</div>`;
    else if (L.lines.length) html = L.lines.map((l, i) => {   // long gaps (a solo, a bridge) show a quiet "• • •"
      const gap = i > 0 && l.t - L.lines[i - 1].t > 9 && !L.lines[i - 1].text;
      const body = l.words ? l.words.map((w, k) => `<span class="w" data-k="${k}">${esc(w.w)}</span>`).join("") : esc(l.text);
      return `<p data-i="${i}" data-t="${l.t}" class="${l.text ? "" : "gap"}${gap ? " long" : ""}${l.words ? " wl" : ""}" title="Jump here">${body || "• • •"}</p>`; }).join("")
      + `<div class="ly-src">${L.wordLevel ? "Word-by-word lyrics from NetEase Cloud Music" : "Lyrics from LRCLIB"} · click a line to jump there</div>`;
    else html = `<div class="ly-plain">${esc(L.plain).replace(/\n/g, "<br>")}</div>`;
    $$("[data-lyrics]").forEach(box => { box.innerHTML = html; box.scrollTop = 0; });
    $$("[data-np-line]").forEach(e => { e.textContent = ""; delete e.dataset.li; e.classList.remove("wl"); });
    this.wordLine = null; this.wordEls = null;
  },
  tickWipe() {   // the karaoke fill, moved by the music loop instead of a CSS animation
    if (this.wordLine) return this.tickWords();
    const w = this.wipeLine; if (!w || !this.wipeEls) return;
    const pct = Math.round(clamp((this.pos() + this.lyLead() - w.t) / w.dur, 0, 1) * 100);
    if (pct === this.wipePct) return; this.wipePct = pct;
    for (const el of this.wipeEls) el.style.backgroundPosition = `${100 - pct}% 0`;
  },
  // word by word: sung words are bright, the word being sung fills in over its own length, the rest wait
  tickWords() {
    const L = this.wordLine, pos = this.pos() + this.lyLead();
    let st = "";
    for (const w of L.words) { const k = (pos - w.t) / Math.max(.05, w.d); st += k >= 1 ? "2" : k > 0 ? "1" : "0"; }
    const cur = st.indexOf("1"), pct = cur >= 0 ? Math.round(clamp((pos - L.words[cur].t) / Math.max(.05, L.words[cur].d), 0, 1) * 100) : -1;
    if (st === this.wState && pct === this.wPct) return;
    const changed = st !== this.wState; this.wState = st; this.wPct = pct;
    for (const spans of this.wordEls || []) {
      if (changed) spans.forEach((el, k) => { el.classList.toggle("sung", st[k] === "2"); el.classList.toggle("now", st[k] === "1"); });
      if (cur >= 0 && spans[cur]) spans[cur].style.backgroundPosition = `${100 - pct}% 0`;
    }
  },
  // Lyrics timing. Synced lyrics are made by different people against slightly different versions of a song, so the
  // right offset is per song: fix a song once with − / + (or [ and ]) and it stays exact. New songs start from the
  // typical offset of the songs you've fixed (the part that comes from this PC), or 0.55 s before you've fixed any.
  lyKey() { const m = this.meta; return m && m.on ? (m.title + "|" + (m.artist || "")).toLowerCase() : ""; },
  lyStoreKey() { return this.lyrics && this.lyrics.wordLevel ? "sky-lysync-w" : "sky-lysync"; },
  lyStore() { try { return JSON.parse(localStorage.getItem(this.lyStoreKey()) || "{}"); } catch (e) { return {}; } },
  lyBase() {
    const v = Object.values(this.lyStore()).filter(x => typeof x === "number").sort((a, b) => a - b);
    return v.length >= 3 ? v[v.length >> 1] : this.lyrics && this.lyrics.wordLevel ? WORD_LEAD : 0.55;   // the median of your fixes: one odd song doesn't skew it
  },
  lyLead() { const own = this.lyStore()[this.lyKey()]; return typeof own === "number" ? own : this.lyBase(); },
  nudgeLyrics(d) {
    const key = this.lyKey(); if (!key) return;
    const all = this.lyStore();
    if (d === 0) delete all[key];
    else all[key] = Math.round(clamp(this.lyLead() + d, -4, 5) * 100) / 100;
    try { localStorage.setItem(this.lyStoreKey(), JSON.stringify(all)); } catch (e) {}
    this.lineIdx = -2; this.wipePct = -1; this.tickLyrics(); this.paintLySync();
  },
  paintLySync() {
    const own = typeof this.lyStore()[this.lyKey()] === "number", v = this.lyLead();
    $$("[data-lysync]").forEach(e => { e.textContent = `${v >= 0 ? "+" : ""}${v.toFixed(2)} s`; e.classList.toggle("own", own); e.title = own ? "Timing saved for this song (click to reset)" : "Default timing (tune this song with − / + or [ ])"; });
  },
  tickLyrics() {
    const L = this.lyrics; if (!L || !L.lines.length) return;
    this.tickWipe();
    const pos = this.pos() + this.lyLead();
    let i = -1; for (let k = 0; k < L.lines.length; k++) { if (L.lines[k].t <= pos) i = k; else break; }
    if (i === this.lineIdx) return;
    this.lineIdx = i;
    const boxes = $$("[data-lyrics]");
    for (const box of boxes) {
      box.querySelectorAll("p.on").forEach(p => p.classList.remove("on"));
      const p = box.querySelector(`p[data-i="${i}"]`);
      if (p) { p.classList.add("on"); if (box.offsetParent && !box.matches(":hover")) box.scrollTo({ top: p.offsetTop - box.clientHeight * (box.id === "lyricsBig" ? .42 : .38) + p.offsetHeight / 2, behavior: Themes.reduceOn() ? "auto" : "smooth" }); }
    }
    const text = i >= 0 ? L.lines[i].text : "", line = i >= 0 ? L.lines[i] : null;
    if (line && line.words) {   // word-timed: light each word as it's sung
      this.wordLine = line; this.wState = null; this.wPct = null; this.wipeLine = null;
      const html = line.words.map((w, k) => `<span class="w" data-k="${k}">${esc(w.w)}</span>`).join("");
      $$("[data-np-line]").forEach(e => { if (e.dataset.li !== String(i)) { e.dataset.li = String(i); e.classList.remove("in"); void e.offsetWidth; e.innerHTML = html; e.classList.add("in", "karaoke", "wl"); } });
      this.wordEls = [...boxes.map(b => b.querySelector("p.on")), ...$$("[data-np-line]")].filter(Boolean).map(el => [...el.querySelectorAll(".w")]);
      this.tickWords();
      return;
    }
    this.wordLine = null; this.wordEls = null;
    $$("[data-np-line]").forEach(e => { e.classList.remove("wl"); delete e.dataset.li; });
    // karaoke: the line fills in over the time until the next one
    const next = L.lines[i + 1], dur = i >= 0 ? Math.max(.6, Math.min(12, (next ? next.t : L.lines[i].t + 4) - L.lines[i].t)) : 0;
    const into = i >= 0 ? Math.max(0, this.pos() - L.lines[i].t) : 0;
    this.wipeLine = i >= 0 ? { t: L.lines[i].t, dur } : null; this.wipePct = -1;
    $$("[data-np-line]").forEach(e => { if (e.textContent !== text) { e.classList.remove("in"); void e.offsetWidth; e.textContent = text; e.classList.add("in", "karaoke"); } });
    this.wipeEls = [...boxes.map(b => b.querySelector("p.on")), ...$$("[data-np-line]")].filter(Boolean);
    this.tickWipe();
  },

  /* ---------- recently played ---------- */
  addHistory(m) {
    const h = this.history.filter(x => !(x.title === m.title && x.artist === m.artist));
    const entry = { title: m.title, artist: m.artist, album: m.album, app: m.app, at: Date.now(), art: "" };
    h.unshift(entry); this.history = h.slice(0, 40);
    if (m.art) {   // keep a tiny copy of the cover: the full one is gone once the song changes
      const img = new Image(); img.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 72;
        c.getContext("2d").drawImage(img, 0, 0, 72, 72); entry.art = c.toDataURL("image/jpeg", .8); this.saveHistory(); this.renderHistory(); } catch (e) {} };
      img.src = m.art;
    }
    this.saveHistory(); this.renderHistory();
  },
  saveHistory: debounce(function () { store.write("history", Music.history); }, 800),
  renderHistory() {
    const box = $("#history"); if (!box) return;
    box.innerHTML = this.history.length ? this.history.slice(0, 24).map(x => `<div class="hi">
      <div class="hi-art">${x.art ? `<img src="${x.art}" alt="">` : icon("music")}</div><div class="hi-t"><b>${esc(x.title)}</b><small>${esc(x.artist || appName(x.app))}</small></div>
      <span class="hi-when">${ago(x.at)}</span></div>`).join("") : `<div class="ly-empty">Songs you play show up here.</div>`;
  },

  /* ---------- the animation loop: visualisers, lyrics, scene feed ---------- */
  wantsLoop() { return !this.blocked.size && this.meta.on && !!this.meta.playing; },   // paused = no animation work at all
  loop() {
    const run = this.wantsLoop();
    this.syncAudio();
    if (!run) { if (this.raf) this.raf(); this.raf = 0; this.paintViz(true); Scene.audio({ level: 0, playing: false }); clearInterval(this.pt); this.progress(); return; }
    clearInterval(this.pt); this.pt = setInterval(() => this.progress(), 500); this.progress();
    if (this.raf) return;
    const frame = now => {
      const playing = !!this.meta.playing;
      let a;
      if (Audio.ok) a = Audio.read();
      else { const l = this.meterLevel; a = { level: l, bass: l, mid: l, high: l * .8, beat: this.meterBeat }; this.meterBeat = false; }
      Scene.audio({ ...a, playing });
      this.beatV = Math.max((this.beatV || 0) * .86, playing && a.beat ? 1 : 0);
      this.paintViz(!playing || Themes.reduceOn(), a, now / 1000);   // reads layout first, then the style writes below
      const pl = this.pl || (this.pl = [$("#player"), $(".mu-art")]), bv = Math.round(this.beatV * 50) / 50, lv = Math.round((playing ? a.level || 0 : 0) * 50) / 50;
      if (bv !== this.lastBv || lv !== this.lastLv) { this.lastBv = bv; this.lastLv = lv; for (const el of pl) if (el) { el.style.setProperty("--beat", bv); el.style.setProperty("--lvl", lv); } }
      this.tickLyrics();
      if (document.body.dataset.player === "vinyl") { const d = this.disc || (this.disc = $(".pl-disc")); if (d) { this.spin = ((this.spin || 0) + (now - (this.spinAt || now)) * .1636) % 360; d.style.transform = `rotate(${this.spin.toFixed(1)}deg)`; } }
      this.spinAt = now;
    };
    this.raf = fpsLoop(30, frame);
  },
  syncAudio() {  // the spectrum listener runs only while the window is visible and music is playing
    const want = this.wantsLoop() && this.visualizer && !Themes.reduceOn();
    clearTimeout(this.audioOff);
    if (want && !Audio.ok) Audio.start().then(ok => { if (sky) sky.media.want("meter", !ok && this.wantsLoop()); });
    if (!want && Audio.ok) this.audioOff = setTimeout(() => { if (!(this.wantsLoop() && this.visualizer)) Audio.stop(); }, 6000);   // a short pause keeps it
    if (sky) sky.media.want("meter", this.wantsLoop() && !Audio.ok && !Audio.starting);
  },
  block(reason, on) {
    if (on === this.blocked.has(reason)) return;
    if (on) this.blocked.add(reason); else this.blocked.delete(reason);
    this.loop();
  },

  paintViz(rest, a = {}, t = 0) {
    const bands = Audio.ok ? Audio.bands : null, lv = a.level || 0, now = performance.now();
    if (!this.vc || now - this.vcAt > 1000) {   // colours change rarely: don't ask for styles every frame
      const root = getComputedStyle(document.documentElement), c1 = root.getPropertyValue("--np-color").trim() || "#5b9cff";
      this.vc = [c1, root.getPropertyValue("--np-color2").trim() || c1]; this.vcAt = now;
    }
    const [c1, c2] = this.vc;
    for (const cv of this.vizEls || (this.vizEls = $$("canvas[data-viz]"))) {
      if (!cv.offsetParent) continue;
      const kind = cv.dataset.viz, dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const val = i => rest ? .04 : bands ? bands[Math.floor(i)] : clamp(lv * (.35 + .65 * Math.abs(Math.sin(t * (1.6 + (i % 7) * .45) + i * 1.3))), 0, 1);
      if (kind === "bars") {
        const n = 48, gap = 2, bw = (w - gap * (n - 1)) / n, gr = g.createLinearGradient(0, h, 0, 0);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr; g.shadowColor = c1; g.shadowBlur = rest ? 0 : 10;
        const bc = this.barColors;
        for (let i = 0; i < n; i++) { const v = Math.max(.03, val(i)), bh = v * h; if (bc) { g.fillStyle = g.shadowColor = bc[i]; } g.beginPath(); g.roundRect(i * (bw + gap), h - bh, bw, bh, Math.min(2, bw / 2)); g.fill(); }
      } else if (kind === "ring") {
        const n = 96, cx = w / 2, cy = h / 2, r0 = Math.min(w, h) * .36, len = Math.min(w, h) * .13;
        g.lineCap = "round"; g.lineWidth = Math.max(2, r0 * .022); g.shadowColor = c1; g.shadowBlur = rest ? 0 : 14;
        for (let i = 0; i < n; i++) {
          const k = i < n / 2 ? i : n - 1 - i, v = Math.max(.04, val(k * 48 / (n / 2))), a0 = i / n * Math.PI * 2 - Math.PI / 2;
          g.strokeStyle = this.ringColors ? this.ringColors[i] : i % 2 ? c2 : c1; if (this.ringColors) g.shadowColor = this.ringColors[i]; g.globalAlpha = .55 + v * .45;
          g.beginPath(); g.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0); g.lineTo(cx + Math.cos(a0) * (r0 + len * v + 2), cy + Math.sin(a0) * (r0 + len * v + 2)); g.stroke();
        }
        g.globalAlpha = 1;
      } else if (kind === "mini") {
        const n = 7, bw = 3.5, gap = 3;
        g.fillStyle = c1;
        for (let i = 0; i < n; i++) { const v = Math.max(.12, val(i * 5 + 2)); g.beginPath(); g.roundRect(i * (bw + gap), h - v * h, bw, v * h, 1.5); g.fill(); }
      }
    }
    const glowV = rest ? .35 : .35 + (a.bass ?? lv) * .5;
    $$("[data-np-glow]").forEach(e => { e.style.opacity = glowV.toFixed(3); e.style.transform = `scale(${(1 + (rest ? 0 : (a.bass ?? lv) * .07)).toFixed(3)})`; });
  },

  /* ---------- start ---------- */
  async init(settings) {
    this.visualizer = settings.visualizer !== false; this.lyricsOn = settings.lyrics !== false;
    this.history = (await store.read("history")) || [];
    this.renderHistory(); this.renderLyrics();
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-np]"); if (!b) return;
      const c = b.dataset.np;
      if (c === "shuffle") return this.cmd("shuffle", this.meta.shuffle ? 0 : 1);
      if (c === "repeat") return this.cmd("repeat", ((this.meta.repeat || 0) + 1) % 3);
      if (c === "mute") return this.cmd("mute", this.vol && this.vol.muted ? 0 : 1);
      if (c === "mini") return sky && sky.mini.toggle();
      this.cmd(c);
    });
    document.addEventListener("click", e => {
      const p = e.target.closest("[data-lyrics] p[data-t]");
      if (p && this.meta.on && (this.meta.can || {}).seek) { const t = Math.max(0, +p.dataset.t - .15); this.meta.pos = t; this.meta.at = Date.now(); this.got = Date.now(); this.cmd("seek", t.toFixed(2)); this.lineIdx = -2; this.tickLyrics(); return; }
      const f = e.target.closest("[data-lyf]"); if (f) this.fullLyrics(f.dataset.lyf === "open");
      const nd = e.target.closest("[data-lynudge]"); if (nd) this.nudgeLyrics(+nd.dataset.lynudge);
      if (e.target.closest("[data-lysync]")) this.nudgeLyrics(0);
    });
    document.addEventListener("keydown", e => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "Escape" && !$("#lyFull").classList.contains("hidden")) { e.stopPropagation(); this.fullLyrics(false); }
      else if (e.key.toLowerCase() === "y" && !e.ctrlKey && !e.altKey) this.fullLyrics($("#lyFull").classList.contains("hidden"));
    }, true);
    let seeking = null;   // click or drag on a progress bar to jump in the song
    const seekAt = (el, x) => { const r = el.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * this.meta.dur; };
    document.addEventListener("pointerdown", e => {
      const s = e.target.closest("[data-np-seek]"); if (!s || !this.meta.on || !(this.meta.can || {}).seek || !(this.meta.dur > 1)) return;
      seeking = s; s.setPointerCapture(e.pointerId); s.classList.add("drag");
      const fill = s.querySelector("[data-np-fill]"), move = ev => { const t = seekAt(s, ev.clientX); fill.style.transform = `scaleX(${t / this.meta.dur})`; s._t = t; };
      move(e); s.onpointermove = move;
      s.onpointerup = ev => { s.onpointermove = s.onpointerup = null; s.classList.remove("drag"); seeking = null;
        const t = s._t ?? seekAt(s, ev.clientX); this.meta.pos = t; this.meta.at = Date.now(); this.got = Date.now(); this.cmd("seek", t.toFixed(2)); this.progress(); this.lineIdx = -2; };
    });
    const sendVol = debounce(v => this.cmd("vol", v), 60);
    document.addEventListener("input", e => { if (e.target.matches("[data-np-vol]")) { e.target.style.setProperty("--v", e.target.value + "%"); sendVol(e.target.value); } });
    $("#npSource")?.addEventListener("change", e => { this.cmd("pin", e.target.value); toast(e.target.value ? `Following ${appName(e.target.value)}` : "Following whatever Windows picks"); });
    document.addEventListener("visibilitychange", () => this.block("hidden", document.hidden));
    if (document.hidden) this.blocked.add("hidden");
    if (sky) {
      sky.media.onMeta(m => this.setMeta(m));
      sky.media.onVol(v => this.setVol(v));
      sky.media.onApps(a => this.setApps(a));
      sky.media.onLevel(d => { this.meterLevel = d.level; if (this.meterBeats >= 0 && d.beats !== this.meterBeats) this.meterBeat = true; this.meterBeats = d.beats; });
      // (a full-screen game no longer pauses Skyline: the bars, lyrics and background keep going; a window that's
      // really hidden or minimised still rests by itself)
      sky.media.onGame(g => { this.game = g; });
      const s = await sky.media.state();
      if (s.vol) this.setVol(s.vol); if (s.apps) this.setApps(s.apps); this.setMeta(s.meta || { on: false });
      if (s.game) this.game = true;
    }
  },
  fullLyrics(on) {   // big, centred lyrics over the city
    const el = $("#lyFull"); if (!el) return;
    el.classList.toggle("hidden", !on); document.body.classList.toggle("lyrics-full", on);
    if (on) { this.lineIdx = -2; this.tickLyrics(); }
  },
  setOption(k, v) {
    if (k === "visualizer") { this.visualizer = v; this.loop(); }
    if (k === "lyrics") { this.lyricsOn = v; if (v && this.meta.on) this.loadLyrics(); else this.renderLyrics(); }
  },
};

function volIcon(v) {
  const waves = v <= 0 ? `<path d="M16 9l5 6M21 9l-5 6"/>` : v < 40 ? `<path d="M16 9.5a3.5 3.5 0 0 1 0 5"/>` : `<path d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10"/>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/>${waves}</svg>`;
}
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 90 ? "now" : s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export { volIcon };
