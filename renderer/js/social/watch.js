// Together in a call: watch the same YouTube video (play, pause and jumps stay in sync for both of you),
// or listen along to the song someone's playing on Spotify. Everything travels over the call's own data channel.
import { $, esc, sky, toast, dialog } from "../util.js";
import { icon } from "./icons.js";
import { S } from "./state.js";

const YT = "https://www.youtube-nocookie.com";
const W = { yt: null, sp: null, call: null, quiet: 0, info: { time: 0, state: -1 }, last: { time: 0, state: -1 }, beat: 0, spTimer: 0, along: false, iframe: null };

export function ytId(text) {
  const s = String(text || "").trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}
const send = m => { const c = W.call; if (c && c.sendData) c.sendData({ t: "watch", ...m }); };
const cmd = (func, args = []) => { const f = W.iframe; if (f && f.contentWindow) try { f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), YT); } catch (e) {} };

/* ---------- the YouTube player in the call ---------- */
function mount(host) {
  if (!W.yt || !host) return;
  if (W.iframe && W.iframe.dataset.vid === W.yt.id) { if (W.iframe.parentElement !== host) host.appendChild(W.iframe); return; }
  const f = W.iframe = document.createElement("iframe");
  f.dataset.vid = W.yt.id; f.allow = "autoplay; encrypted-media; fullscreen"; f.title = "Watching together";
  f.src = `${YT}/embed/${encodeURIComponent(W.yt.id)}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1&playsinline=1${W.yt.time > 1 ? "&start=" + Math.floor(W.yt.time) : ""}`;
  host.innerHTML = ""; host.appendChild(f);
  const hi = () => { if (W.iframe !== f) return; try { f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT); } catch (e) {} };
  f.addEventListener("load", () => { hi(); setTimeout(hi, 600); setTimeout(hi, 1500); if (!W.yt.playing) setTimeout(() => cmd("pauseVideo"), 900); });
}
// what the player says: when you press play / pause or jump, your friend's player does the same
addEventListener("message", e => {
  if (e.origin !== YT || !W.yt || !W.iframe || e.source !== W.iframe.contentWindow) return;
  let d; try { d = JSON.parse(e.data); } catch (er) { return; }
  const info = d && d.info; if (!info) return;
  if (typeof info.currentTime === "number") W.info.time = info.currentTime;
  if (typeof info.playerState === "number") W.info.state = info.playerState;
  W.yt.time = W.info.time;
  if (Date.now() < W.quiet) { W.last = { ...W.info }; return; }   // (a change we just made because of them)
  const st = W.info.state, playing = st === 1, jumped = Math.abs(W.info.time - (W.last.time + (W.last.state === 1 ? (Date.now() - (W.last.at || Date.now())) / 1000 : 0))) > 2.5;
  if ((st === 1 || st === 2) && (st !== W.last.state || jumped)) { W.yt.playing = playing; send({ kind: "yt", id: W.yt.id, time: W.info.time, playing }); }
  W.last = { time: W.info.time, state: st, at: Date.now() };
});
function applyYt(m) {
  const fresh = !W.yt || W.yt.id !== m.id;
  W.yt = { id: m.id, time: m.time || 0, playing: !!m.playing, by: m.by || "them" };
  if (fresh) { W.iframe = null; rerender(); return; }
  W.quiet = Date.now() + 1500;
  const target = (m.time || 0) + (m.playing ? .25 : 0);
  if (Math.abs(W.info.time - target) > 1.5) cmd("seekTo", [target, true]);
  cmd(m.playing ? "playVideo" : "pauseVideo");
}

/* ---------- listening along on Spotify ---------- */
async function shareSong() {
  if (!sky.spotify) return;
  const cur = await sky.spotify.current().catch(() => null);
  if (!cur) { toast("Play a song on Spotify first (and link Spotify in Settings › Music).", true); return; }
  W.sp = { ...cur, mine: true }; send({ kind: "sp", ...cur }); rerender();
  clearInterval(W.spTimer);
  W.spTimer = setInterval(async () => {   // keep your friend in step: new song, a pause, or a jump
    if (!W.sp || !W.sp.mine) return clearInterval(W.spTimer);
    const c = await sky.spotify.current().catch(() => null); if (!c) return;
    const drift = Math.abs(c.pos - (W.sp.pos + (W.sp.playing ? (Date.now() - W.sp.at) / 1000 : 0)));
    if (c.uri !== W.sp.uri || c.playing !== W.sp.playing || drift > 4) { W.sp = { ...c, mine: true }; send({ kind: "sp", ...c }); rerender(); }
  }, 4000);
}
async function follow() {   // play what they're playing, from the same moment
  const s = W.sp; if (!s || s.mine || !s.playing) return;
  const pos = s.pos + (Date.now() - s.got) / 1000 + .4;
  // (Premium plays it through Spotify's API; anyone else, straight in the Spotify app)
  try { await sky.spotify.open({ uri: s.uri, title: s.title, position: pos }); } catch (e) { toast(e.message || "Couldn't play it on your Spotify.", true); }
}
function applySp(m) {
  const prev = W.sp;
  W.sp = { uri: m.uri, title: m.title, artist: m.artist, art: m.art, pos: m.pos || 0, playing: !!m.playing, got: Date.now(), mine: false };
  if (W.along && (!prev || prev.uri !== m.uri || Math.abs((prev.pos || 0) - (m.pos || 0)) > 5)) follow();
  rerender();
}

/* ---------- what the call shows ---------- */
function rerender() { import("./callui.js").then(m => m.CallUI.renderStage()).catch(() => {}); }
// a bar across the top of the call: what's being shared, and the buttons for it
function barHtml(peer) {
  let h = "";
  if (W.sp) h += `<div class="sx-together sp">${W.sp.art ? `<img src="${esc(W.sp.art)}" alt="">` : `<span class="sx-tg-ic">${icon("music")}</span>`}
    <span class="sx-tg-t"><small>${W.sp.mine ? "You're sharing your song" : esc(peer.display_name) + " is listening to"}</small><b>${esc(W.sp.title)}</b><em>${esc(W.sp.artist || "")}${W.sp.playing ? "" : " · paused"}</em></span>
    ${W.sp.mine ? `<button class="btn xs" data-wt="stopsp">Stop sharing</button>` : W.along ? `<button class="btn xs" data-wt="unfollow">Stop listening along</button>` : `<button class="btn xs primary" data-wt="follow">${icon("music")}Listen along</button>`}</div>`;
  if (W.yt) h += `<div class="sx-together yt"><span class="sx-tg-ic">${icon("play")}</span><span class="sx-tg-t"><small>Watching together</small><b>Play, pause and skipping stay in sync</b></span><button class="btn xs" data-wt="stopyt">Stop</button></div>`;
  return h;
}
async function menu(anchor) {
  const items = [["Watch a YouTube video", "play", "yt"], ["Share the song I'm playing", "music", "sp"]];
  const m = document.createElement("div"); m.className = "sx-menu sx-wt-menu"; m.setAttribute("role", "menu");
  m.innerHTML = `<div class="sx-menu-head"><b>Together</b><small>Both of you see and hear it</small></div>` + items.map(([l, ic]) => `<button role="menuitem">${icon(ic)}<span>${l}</span></button>`).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + "px"; m.style.top = Math.max(8, r.top - m.offsetHeight - 8) + "px";
  const shut = () => { m.remove(); document.removeEventListener("mousedown", out, true); }, out = e => { if (!m.contains(e.target)) shut(); };
  setTimeout(() => document.addEventListener("mousedown", out, true));
  [...m.querySelectorAll("button")].forEach((b, i) => b.onclick = async () => {
    shut();
    if (items[i][2] === "sp") return shareSong();
    const link = await dialog({ title: "Watch a YouTube video together", text: "Paste the video's link. You both see it, and play, pause and skipping stay in sync.", input: "", ok: "Watch together" });
    const id = ytId(link); if (link == null) return;
    if (!id) return toast("That doesn't look like a YouTube link.", true);
    W.yt = { id, time: 0, playing: true, by: "me" }; W.iframe = null; send({ kind: "yt", id, time: 0, playing: true }); rerender();
  });
}

export const Watch = {
  attach(call) { W.call = call; W.yt = null; W.sp = null; W.along = false; W.iframe = null; clearInterval(W.spTimer); call.onData = m => { if (m && m.t === "watch") this.receive(m); }; },
  end() { W.call = null; W.yt = null; W.sp = null; W.along = false; W.iframe = null; clearInterval(W.spTimer); },
  receive(m) {
    const peer = W.call && W.call.peer;
    if (m.kind === "yt" && ytId(m.id) === m.id) { const first = !W.yt; applyYt(m); if (first && peer) toast(`${peer.display_name} started a video for you both`); }
    else if (m.kind === "sp" && /^spotify:track:[A-Za-z0-9]+$/.test(m.uri || "")) applySp(m);
    else if (m.kind === "stopyt") { W.yt = null; W.iframe = null; rerender(); }
    else if (m.kind === "stopsp") { W.sp = null; W.along = false; rerender(); }
  },
  watching: () => !!W.yt,
  videoKey: () => W.yt ? "watch:" + W.yt.id : "",
  mount, barHtml,
  async click(a, b) {
    if (a === "together") return menu(b);
    if (a === "stopyt") { W.yt = null; W.iframe = null; send({ kind: "stopyt" }); return rerender(); }
    if (a === "stopsp") { W.sp = null; clearInterval(W.spTimer); send({ kind: "stopsp" }); return rerender(); }
    if (a === "follow") { W.along = true; rerender(); return follow(); }   // no Spotify link or Premium needed to listen along
    if (a === "unfollow") { W.along = false; return rerender(); }
  },
};
