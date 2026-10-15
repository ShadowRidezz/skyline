// Two more Music tabs: Stats (what you listen to most, and how much) and Up next (Spotify's queue).
import { $, esc, sky, toast } from "./util.js";

const clean = e => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const mins = m => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;

export const Stats = {
  range: "week",
  async render() {
    const box = $("#sgStats"); if (!box || !sky) return;
    box.onclick = e => this.click(e);
    let st; try { st = await sky.plays.stats(this.range); } catch (e) { box.innerHTML = `<div class="pg-empty">${esc(clean(e))}</div>`; return; }
    const seg = `<div class="seg sm st-range">${[["week", "This week"], ["month", "30 days"], ["all", "All time"]].map(([v, n]) => `<button data-strange="${v}" class="${this.range === v ? "on" : ""}">${n}</button>`).join("")}</div>`;
    if (!st.plays) { box.innerHTML = `<div class="st-head">${seg}</div><div class="pg-empty">📊 Nothing counted ${this.range === "all" ? "yet" : "in this time"}. Skyline counts every song you listen to for 20 seconds or more (Spotify, YouTube, your own songs), starting now.</div>`; return; }
    const max = Math.max(1, ...st.weeks.map(w => w.mins));
    box.innerHTML = `<div class="st-head">${seg}<span class="sp"></span><span class="ct-note">since ${new Date(st.since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
      <button class="btn sm primary st-wrap" data-wrapped>🎁 This week's Wrapped</button><div class="st-tiles"><div class="pg-stat"><b>${mins(st.mins)}</b><span>listened</span></div><div class="pg-stat"><b>${st.plays}</b><span>songs played</span></div><div class="pg-stat"><b>${st.artists.length ? esc(st.artists[0].name) : "–"}</b><span>top artist</span></div></div>
      <h4 class="st-h">Minutes per week</h4>
      <div class="st-weeks">${st.weeks.map((w, i) => `<div class="st-wk" title="${mins(w.mins)}, week of ${new Date(w.from).toLocaleDateString(undefined, { month: "short", day: "numeric" })}"><i style="--h:${(w.mins / max * 100).toFixed(1)}%"></i><small>${i === st.weeks.length - 1 ? "now" : new Date(w.from).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</small></div>`).join("")}</div>
      <div class="st-cols"><div><h4 class="st-h">Top songs</h4>${st.songs.map((s, i) => `<div class="st-row"><span class="st-n">${i + 1}</span><span class="st-t"><b>${esc(s.title)}</b><small>${esc(s.artist || "")}</small></span><span class="st-v">${s.plays}× · ${mins(Math.round(s.secs / 60))}</span></div>`).join("")}</div>
        <div><h4 class="st-h">Top artists</h4>${st.artists.map((a, i) => `<div class="st-row"><span class="st-n">${i + 1}</span><span class="st-t"><b>${esc(a.name)}</b></span><span class="st-v">${a.plays} plays</span></div>`).join("")}</div></div>`;
  },
  click(e) { const r = e.target.closest("[data-strange]"); if (r) { this.range = r.dataset.strange; this.render(); return true; } return false; },
};

export const Queue = {
  async render() {
    const box = $("#sgQueue"); if (!box || !sky) return;
    box.onclick = e => this.click(e);
    const st = await sky.spotify.status().catch(() => ({}));
    if (!st.connected) { box.innerHTML = `<div class="pg-empty">Connect Spotify (the 🎧 Spotify tab) to see what's playing next.</div>`; return; }
    box.innerHTML = `<div class="g-loading"><i></i><i></i><i></i><span>Asking Spotify…</span></div>`;
    let q; try { q = await sky.spotify.upNext(); } catch (e) { box.innerHTML = `<div class="pg-empty">${esc(clean(e))}</div>`; return; }
    this.q = q;
    if (!q.now && !q.queue.length) {   // Spotify's servers don't know what the app is playing (happens when its remote control is stuck)
      box.innerHTML = `<div class="st-head"><b>Up next on Spotify</b><span class="sp"></span><button class="btn xs ghost" data-qref>↻ Refresh</button></div>
        <div class="pg-empty">Spotify isn't telling its servers what's playing right now, so the queue can't be read. This is the same Spotify glitch that stops remote play on this PC. Fully quitting Spotify (tray icon › Quit) and opening it again usually fixes it.</div>`;
      return;
    }
    const row = (t, i, now) => `<div class="qu-row ${now ? "now" : ""}">${t.art ? `<img src="${esc(t.art)}" alt="">` : `<span class="qu-ph">♪</span>`}<span class="st-t"><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></span>
      ${now ? `<span class="qu-tag">Now playing</span>` : `<button class="btn xs" data-qjump="${i}" title="Skip ahead to this song">▶ Play now</button>`}</div>`;
    box.innerHTML = `<div class="st-head"><b>Up next on Spotify</b><span class="sp"></span><button class="btn xs ghost" data-qref>↻ Refresh</button></div>
      ${q.now ? row(q.now, -1, true) : ""}${q.queue.length ? q.queue.map((t, i) => row(t, i)).join("") : `<div class="pg-empty">The queue is empty. Add songs from the Spotify tab (⋯ › Add to queue).</div>`}
      <p class="muted qu-note">Spotify doesn't let other apps reorder its queue; "Play now" skips ahead to that song.</p>`;
  },
  async click(e) {
    if (e.target.closest("[data-qref]")) { this.render(); return true; }
    const j = e.target.closest("[data-qjump]"); if (!j) return false;
    j.disabled = true; const t = this.q.queue[+j.dataset.qjump];
    try { await sky.spotify.skipTo(+j.dataset.qjump + 1); toast(`▶ ${t ? t.title : "Skipping ahead"}`); } catch (er) { toast(clean(er), true); }
    setTimeout(() => this.render(), 1800); return true;
  },
};
