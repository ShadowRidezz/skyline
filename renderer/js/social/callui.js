// What you see of a call: the incoming-call card, the call stage above the conversation,
// a small call bar when you're elsewhere, and the screen/window picker for sharing.
import { $, esc, toast } from "../util.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { S, emit, friend, statusOf, avatar } from "./state.js";
import { Call, SHARE_QUALITY } from "./call.js";

const ENDED = {
  no_answer: "No answer", unreachable: "Couldn't reach them. They may have just gone offline.", declined: "Call declined", busy: "They're in another call", missed: "Missed call", ended_by_them: "Call ended",
  ended: "Call ended", failed: "Couldn't connect. Your networks may need a relay (TURN) server to reach each other.", lost: "Connection lost",
  their_device: "They couldn't start their microphone", declined_by_you: "Call declined",
};
let tick = 0, ringer = null, pickerOpen = false, volT = 0;
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ---------- starting and receiving ---------- */
async function start(f, video, opts = {}) {
  if (S.call && S.call.state !== "ended") { toast(S.call.peer.id === f.id ? "You're already in a call with them" : "You're already in a call", true); return; }
  if (statusOf(f) === "offline") { toast(`${f.display_name} is offline. You can call when they're back.`, true); return; }
  const id = crypto.randomUUID();
  const call = new Call({ id, peer: f, role: "caller", video, ice: S.ice, devices: S.settings.devices || {}, send: sender(id, f.id), onChange: changed });
  S.call = call; call.wantShare = !!opts.share;
  goChat(f.id); changed(call);
  call.voice = S.settings.voice || {}; call.joinMuted = !!call.voice.joinMuted;
  try { await call.start(); if (call.noMic) toast("No microphone: you'll hear them, but they won't hear you. " + call.noMic, true); }
  catch (e) { call.end(e.code === "offline" ? "offline" : "error"); toast(e.message, true); return; }
}
const sender = (callId, to) => (kind, payload) => api.rpc("send_signal", { p_call: callId, p_to: to, p_kind: kind, p_payload: payload || null });

async function onSignal(sig) {
  if (!sig || sig.to_id !== S.me.id) return;
  if (sig.kind === "ring") {
    if (Date.now() - new Date(sig.created_at).getTime() > 30000) return;   // an old ring replayed after reconnecting
    const f = friend(sig.from_id); if (!f) return;
    if ((S.call && S.call.state !== "ended") || S.incoming) { sender(sig.call_id, sig.from_id)("busy", {}).catch(() => {}); return; }
    const call = new Call({ id: sig.call_id, peer: f, role: "callee", video: !!(sig.payload && sig.payload.video), ice: S.ice, devices: S.settings.devices || {}, send: sender(sig.call_id, f.id), onChange: changed });
    call.seen.add(sig.id); call.ringTimer = setTimeout(() => { if (call.state === "incoming") call.end("missed"); }, 32000);
    S.call = call; S.incoming = call; changed(call);
    call.send("ringing", {}).catch(() => {});   // tell the caller this PC is ringing
    const dnd = (S.settings.status || "online") === "dnd";
    if (!dnd || (S.settings.notify || {}).dndCalls) ring(true);
    if (!document.hasFocus() || document.hidden) api.notify({ title: `${f.display_name} is calling`, body: call.wantVideo ? "Video call · open Skyline to answer" : "Voice call · open Skyline to answer", target: { chat: f.id } });
    return;
  }
  if (S.call && S.call.id === sig.call_id && sig.from_id === S.call.peer.id) S.call.signal(sig);
}

function changed(call) {
  if (call !== S.call) return;
  if (call.state !== "incoming") { if (S.incoming === call) S.incoming = null; ring(false); }
  if (call.state === "connected" && call.wantShare) { call.wantShare = false; pickScreen(); }
  if (call.state === "ended") {
    const msg = ENDED[call.reason] || (call.reason && call.reason.length > 12 ? call.reason : "Call ended");
    if (call.reason !== "declined_by_you") toast(msg, ["failed", "lost", "their_device", "unreachable"].includes(call.reason) || call.reason.length > 24);
    clearInterval(tick); tick = 0;
    setTimeout(() => { if (S.call === call) { S.call = null; renderAll(); } }, 50);
  } else if (!tick) tick = setInterval(() => { const d = $(".sx-call-time"); if (d && S.call) d.textContent = timeText(S.call); $$("[data-calltime]").forEach(x => x.textContent = timeText(S.call)); }, 1000);
  renderAll();
}
const $$ = s => [...document.querySelectorAll(s)];
function renderAll() { renderIncoming(); renderStage(); renderDock(); renderSlot(); sound(); emit("call"); }
const timeText = c => c.state === "calling" ? (c.ringing ? "Ringing…" : "Calling…") : c.state === "connecting" ? "Connecting…" : c.state === "reconnecting" ? "Reconnecting…" : c.state === "connected" ? mmss(c.duration) : c.state === "incoming" ? "Incoming call" : "";
function goChat(id) { document.dispatchEvent(new CustomEvent("sky:goto", { detail: "social" })); import("./social.js").then(m => m.Social.open({ kind: "chat", id })); }

/* ---------- the ring ---------- */
let actx = null;
function ring(on) {
  clearInterval(ringer); ringer = null;
  if (!on || (S.settings.notify || {}).sound === false) return;
  const beep = () => { try { actx = actx || new AudioContext(); const t = actx.currentTime;
    for (const [f, d] of [[660, 0], [880, .18], [660, .9], [880, 1.08]]) { const o = actx.createOscillator(), g = actx.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.07, t + d + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d + .3); o.connect(g).connect(actx.destination); o.start(t + d); o.stop(t + d + .32); } } catch (e) {} };
  beep(); ringer = setInterval(beep, 3000);
}

/* ---------- incoming call card (shown anywhere in Skyline) ---------- */
function renderIncoming() {
  let el = $("#sxIncoming"); const c = S.incoming;
  if (!c || c.state !== "incoming") { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "sxIncoming"; el.className = "sx-incoming"; el.setAttribute("role", "alertdialog"); document.body.appendChild(el);
    el.onclick = e => { const b = e.target.closest("[data-in]"); if (!b) return; const a = b.dataset.in;
      if (a === "decline") c.decline(); else { goChat(c.peer.id); c.voice = S.settings.voice || {}; c.joinMuted = !!c.voice.joinMuted; c.accept(a === "video").then(() => { if (c.noMic) toast("No microphone: you'll hear them, but they won't hear you. " + c.noMic, true); }).catch(er => toast(er.message, true)); } }; }
  el.setAttribute("aria-label", `${c.peer.display_name} is calling`);
  el.innerHTML = `<div class="sx-in-who">${avatar(c.peer, 44)}<span><b>${esc(c.peer.display_name)}</b><small>Incoming ${c.wantVideo ? "video" : "voice"} call</small></span></div>
    <div class="sx-in-acts"><button class="sx-cbtn end" data-in="decline" title="Decline" aria-label="Decline">${icon("phoneOff")}</button>
      <button class="sx-cbtn" data-in="video" title="Answer with video" aria-label="Answer with video">${icon("video")}</button>
      <button class="sx-cbtn go" data-in="voice" title="Answer" aria-label="Answer">${icon("phone")}</button></div>`;
}

/* ---------- the call stage, above the conversation with that friend ---------- */
function renderStage() {
  const slot = $("#sxStageSlot"); if (!slot) return;
  const c = S.call;
  if (!c || c.state === "ended" || c.state === "incoming" || S.view.kind !== "chat" || S.view.id !== c.peer.id) { if (slot.firstChild) { slot.innerHTML = ""; slot.className = "sx-stage-slot"; } return; }
  const sharingThem = c.peerState.screen && c.remote.screen, sharingMe = !!c.local.screen;
  const camThem = c.peerState.cam && c.remote.cam, camMe = !!c.local.cam;
  const mode = sharingThem || sharingMe ? "share" : camThem || camMe ? "video" : "voice";
  slot.className = "sx-stage-slot on " + mode;
  if (!slot.querySelector(".sx-stage")) {
    slot.innerHTML = `<div class="sx-stage" id="sxStage">
      <div class="sx-stage-main" id="sxStageMain"></div>
      <div class="sx-stage-strip" id="sxStageStrip"></div>
      <div class="sx-stage-top"><span class="sx-stage-state"><i class="sx-live-dot"></i><span class="sx-call-time"></span></span><span class="sp"></span>
        <button class="ibtn" data-cc="full" title="Full screen" aria-label="Full screen">${icon("expand")}</button></div>
      <div class="sx-ctrl" id="sxCtrl"></div>
    </div>`;
    slot.querySelector(".sx-stage").onclick = controls;
    slot.querySelector(".sx-stage").oninput = e => { if (e.target.matches("[data-cc-vol]")) { setVolume(+e.target.value); S.settings.voice = { ...(S.settings.voice || {}), volume: +e.target.value }; clearTimeout(volT); volT = setTimeout(() => api.rpc("save_settings", { p_data: S.settings }).catch(() => {}), 800); } };
  }
  slot.querySelector(".sx-call-time").textContent = timeText(c);
  let warn = slot.querySelector(".sx-nomic");
  if (c.noMic && !warn) { warn = document.createElement("div"); warn.className = "sx-nomic"; slot.querySelector(".sx-stage").appendChild(warn); }
  if (warn) { if (c.noMic) warn.innerHTML = `${icon("micOff")}<span>No microphone, so they can't hear you. You can still hear them.</span><button class="btn xs" data-cc="retrymic">Try again</button>`; else warn.remove(); }
  // the people and pictures
  const tile = (who, stream, me, muted, label) => `<div class="sx-tile${stream ? " has-video" : ""}${me ? " me" : ""}" data-tile="${me ? "me" : "them"}">
      ${stream ? `<video autoplay playsinline ${me ? "muted" : ""} data-stream="${label}"></video>` : `<div class="sx-tile-av">${avatar(who, 72)}</div>`}
      <span class="sx-tile-name">${muted ? icon("micOff") : ""}${esc(me ? "You" : who.display_name)}</span></div>`;
  const main = $("#sxStageMain"), strip = $("#sxStageStrip");
  const themMuted = !c.peerState.mic, meMuted = c.muted;
  let mainKey, mainHtml, stripHtml;
  if (mode === "share") {
    const mine = sharingMe && !sharingThem;
    mainKey = "share:" + (mine ? "me" : "them");
    mainHtml = `<div class="sx-share"><video autoplay playsinline ${mine ? "muted" : ""} data-stream="${mine ? "myscreen" : "screen"}"></video>
      <span class="sx-share-tag">${icon("screen")}${mine ? "You're sharing your screen" : esc(c.peer.display_name) + " is sharing their screen"}</span>
      ${mine ? `<button class="btn sm danger-solid sx-share-stop" data-cc="stopshare">${icon("screenOff")}Stop sharing</button>` : ""}
      <span class="sx-share-q" data-shareq></span>
      <button class="sx-share-full" data-cc="sharefull" title="Full screen (double-click)" aria-label="Show the shared screen full screen">${icon("expand")}</button></div>`;
    stripHtml = tile(c.peer, camThem ? c.remote.cam : null, false, themMuted, "cam") + tile(S.me, camMe ? c.local.cam : null, true, meMuted, "mycam");
  } else if (mode === "video") {
    mainKey = "video";   // the other person stays the big picture (their camera, or their avatar); you're the small one
    mainHtml = tile(c.peer, camThem ? c.remote.cam : null, false, themMuted, "cam");
    stripHtml = tile(S.me, camMe ? c.local.cam : null, true, meMuted, "mycam");
  } else {
    mainKey = "voice";
    mainHtml = `<div class="sx-voice">${tile(c.peer, null, false, themMuted)}${tile(S.me, null, true, meMuted)}</div>
      ${c.state !== "connected" ? `<p class="sx-voice-state">${esc(c.state === "calling" ? `${c.ringing ? "Ringing" : "Calling"} ${c.peer.display_name}…` : c.state === "reconnecting" ? "Reconnecting…" : "Connecting…")}</p>` : ""}`;
    stripHtml = "";
  }
  if (main.dataset.k !== mainKey + themMuted + meMuted + c.state) {
    main.dataset.k = mainKey + themMuted + meMuted + c.state; main.innerHTML = mainHtml;
    const sh = main.querySelector(".sx-share"); if (sh) { sh.ondblclick = e => { if (!e.target.closest("button")) shareFull(); }; shareStats(); }
  }
  if (strip.dataset.k !== stripHtml) { strip.dataset.k = stripHtml; strip.innerHTML = stripHtml; }
  const streams = { cam: c.remote.cam, screen: c.remote.screen, mycam: c.local.cam ? new MediaStream([c.local.cam]) : null, myscreen: c.local.screen ? new MediaStream([c.local.screen]) : null };
  slot.querySelectorAll("video[data-stream]").forEach(v => { const s = streams[v.dataset.stream]; const id = s && s.getTracks()[0] && s.getTracks()[0].id; if (v.dataset.tid !== id) { v.dataset.tid = id || ""; v.srcObject = s || null; } });
  // controls
  $("#sxCtrl").innerHTML = `
    <button class="sx-cbtn${c.muted || !c.local.mic ? " off" : ""}" data-cc="mute" title="${!c.local.mic ? "No microphone" : c.muted ? "Unmute" : "Mute"}" aria-label="${c.muted ? "Unmute" : "Mute"}" aria-pressed="${c.muted}" ${c.local.mic ? "" : "disabled"}>${icon(c.muted || !c.local.mic ? "micOff" : "mic")}</button>
    <button class="sx-cbtn${camMe ? " active" : ""}" data-cc="cam" title="${camMe ? "Turn camera off" : "Turn camera on"}" aria-label="Camera" aria-pressed="${camMe}" ${c.state === "calling" ? "" : ""}>${icon(camMe ? "video" : "videoOff")}</button>
    <button class="sx-cbtn${sharingMe ? " active" : ""}" data-cc="share" title="${sharingMe ? "Stop sharing" : "Share your screen"}" aria-label="Share screen" aria-pressed="${sharingMe}" ${c.state !== "connected" && c.state !== "reconnecting" ? "disabled" : ""}>${icon(sharingMe ? "screenOff" : "screen")}</button>
    <label class="sx-callvol" title="Their volume"><span>${icon("volume")}</span><input type="range" class="rg" min="0" max="300" step="10" value="${(S.settings.voice || {}).volume ?? 200}" data-cc-vol aria-label="Their volume"></label>
    <button class="sx-cbtn end" data-cc="end" title="${c.state === "calling" ? "Cancel call" : "Leave call"}" aria-label="End call">${icon("phoneOff")}</button>`;
}
async function controls(e) {
  const b = e.target.closest("[data-cc]"); if (!b || !S.call) return;
  const c = S.call, a = b.dataset.cc;
  try {
    if (a === "mute") c.toggleMute();
    else if (a === "cam") await c.toggleCam();
    else if (a === "share") { if (c.local.screen) await c.stopShare(); else await pickScreen(); }
    else if (a === "stopshare") await c.stopShare();
    else if (a === "end") c.hangup("ended");
    else if (a === "retrymic") { if (await c.retryMic()) toast("Microphone on"); else toast(c.noMic, true); }
    else if (a === "sharefull") shareFull();
    else if (a === "full") { const st = $("#sxStage"); if (document.fullscreenElement) document.exitFullscreen(); else st.requestFullscreen().catch(() => {}); }
  } catch (er) { toast(er.message, true); }
}

// the shared screen alone, filling the monitor; Esc or the button (or another double-click) comes back
function shareFull() {
  const sh = $(".sx-share"); if (!sh) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else sh.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}
// what's actually arriving (or going out), shown small on the shared screen: 1920×1080 · 60 fps
let qTimer = 0;
function shareStats() {
  clearInterval(qTimer);
  qTimer = setInterval(async () => {
    const tag = $("[data-shareq]"), c = S.call; if (!tag || !c || !c.pc) { if (!tag) clearInterval(qTimer); return; }
    const v = $(".sx-share video"); if (!v || !v.videoWidth) { tag.textContent = ""; return; }
    let fps = 0;
    try { (await c.pc.getStats()).forEach(r => { if (r.kind === "video" && (r.type === "inbound-rtp" || r.type === "outbound-rtp") && r.frameWidth === v.videoWidth && r.framesPerSecond) fps = Math.round(r.framesPerSecond); }); } catch (e) {}
    tag.textContent = `${v.videoWidth}×${v.videoHeight}${fps ? ` · ${fps} fps` : ""}`;
  }, 1500);
}

/* ---------- the call bar: shown when the conversation isn't on screen ---------- */
function renderDock() {
  let el = $("#sxDock"); const c = S.call;
  const here = document.querySelector("#view-social:not(.hidden)") && S.view.kind === "chat" && c && S.view.id === c.peer.id;
  if (!c || c.state === "ended" || c.state === "incoming" || here) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "sxDock"; el.className = "sx-dock"; document.body.appendChild(el);
    el.onclick = e => { const b = e.target.closest("[data-dk]"); if (!b || !S.call) return; const a = b.dataset.dk;
      if (a === "open") goChat(S.call.peer.id); else if (a === "mute") S.call.toggleMute(); else if (a === "end") S.call.hangup("ended"); }; }
  el.innerHTML = `<button class="sx-dock-who" data-dk="open" title="Back to the call"><span class="sx-ring" data-speaker="them">${avatar(c.peer, 30)}</span><span><b>${esc(c.peer.display_name)}</b><small data-calltime>${timeText(c)}</small></span></button>
    ${c.local.screen ? `<span class="sx-dock-share" title="You're sharing your screen">${icon("screen")}</span>` : ""}
    <button class="sx-cbtn sm${c.muted ? " off" : ""}" data-dk="mute" title="${c.muted ? "Unmute" : "Mute"}" aria-label="Mute">${icon(c.muted ? "micOff" : "mic")}</button>
    <button class="sx-cbtn sm end" data-dk="end" title="Leave call" aria-label="End call">${icon("phoneOff")}</button>`;
}
// their voice: one sound path for the whole app (so you keep hearing them on any page, and never twice), made louder
// with a compressor + gain you can set (calls used to come through quiet). It also tells who's talking.
const SND = { ctx: null, src: null, gain: null, comp: null, an: null, mineAn: null, mineSrc: null, timer: 0, last: { them: 0, me: 0 } };
function sound() {
  let au = $("#sxAudio"); const c = S.call, s = c && c.state !== "ended" ? c.remote.audio || null : null;
  if (!s) { if (au) { au.srcObject = null; au.remove(); } stopSound(); return; }
  if (!au) { au = document.createElement("audio"); au.id = "sxAudio"; au.autoplay = true; au.muted = true; document.body.appendChild(au); }   // (the stream must play somewhere for the sound graph to get it)
  if (au.srcObject !== s) {
    au.srcObject = s; au.play().catch(() => {});
    try {
      const ctx = SND.ctx || (SND.ctx = new AudioContext({ latencyHint: "interactive" }));
      if (ctx.state === "suspended") ctx.resume();
      if (SND.src) try { SND.src.disconnect(); } catch (e) {}
      SND.src = ctx.createMediaStreamSource(s);
      if (!SND.gain) {
        SND.comp = ctx.createDynamicsCompressor(); SND.comp.threshold.value = -30; SND.comp.knee.value = 18; SND.comp.ratio.value = 4; SND.comp.attack.value = .004; SND.comp.release.value = .2;
        SND.gain = ctx.createGain(); SND.an = ctx.createAnalyser(); SND.an.fftSize = 512;
        SND.comp.connect(SND.gain).connect(ctx.destination);
      }
      SND.src.connect(SND.comp); SND.src.connect(SND.an);
      setVolume((S.settings.voice || {}).volume ?? 200);
      const out = (S.settings.devices || {}).out; if (out && ctx.setSinkId) ctx.setSinkId(out).catch(() => {});
    } catch (e) { au.muted = false; }   // (no sound graph: plain playback)
  }
  if (c.local.mic && (!SND.mineSrc || SND.mineSrc.mediaStream.getAudioTracks()[0] !== c.local.mic) && SND.ctx) {
    if (SND.mineSrc) try { SND.mineSrc.disconnect(); } catch (e) {}
    SND.mineSrc = SND.ctx.createMediaStreamSource(new MediaStream([c.local.mic])); SND.mineAn = SND.mineAn || SND.ctx.createAnalyser(); SND.mineAn.fftSize = 512; SND.mineSrc.connect(SND.mineAn);
  }
  if (!SND.timer) SND.timer = setInterval(speaking, 90);
}
export function setVolume(pct) { if (SND.gain) SND.gain.gain.value = Math.max(0, Math.min(3, (+pct || 0) / 100)); }
function level(an) { if (!an) return 0; const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length); }
function speaking() {
  const c = S.call; if (!c || c.state === "ended") return stopSound();
  const now = Date.now(), them = c.peerState.mic !== false && level(SND.an) > .018, me = !c.muted && !!c.local.mic && level(SND.mineAn) > .025;
  if (them) SND.last.them = now; if (me) SND.last.me = now;
  const t = now - SND.last.them < 280, m = now - SND.last.me < 280;   // a little hold, so the ring doesn't flicker between words
  document.querySelectorAll('[data-tile="them"], [data-speaker="them"]').forEach(e => e.classList.toggle("speaking", t));
  document.querySelectorAll('[data-tile="me"], [data-speaker="me"]').forEach(e => e.classList.toggle("speaking", m));
}
function stopSound() {
  clearInterval(SND.timer); SND.timer = 0;
  for (const k of ["src", "mineSrc"]) if (SND[k]) { try { SND[k].disconnect(); } catch (e) {} SND[k] = null; }
  document.querySelectorAll(".speaking").forEach(e => e.classList.remove("speaking"));
}
function renderSlot() {
  const el = $("#sxCallSlot"); if (!el) return; const c = S.call;
  if (!c || c.state === "ended" || c.state === "incoming") { el.innerHTML = ""; return; }
  el.innerHTML = `<button class="sx-callpill" data-sx="chat:${c.peer.id}"><i class="sx-live-dot"></i><span><b>${c.state === "connected" ? "In a call" : esc(timeText(c))}</b><small>${esc(c.peer.display_name)}${c.state === "connected" ? ` · <span data-calltime>${timeText(c)}</span>` : ""}</small></span></button>`;
}

/* ---------- the screen and window picker ---------- */
async function pickScreen() {
  if (pickerOpen || !S.call) return; pickerOpen = true; let quality = SHARE_QUALITY[S.settings.shareQuality] ? S.settings.shareQuality : "smooth";
  const m = $("#dlg");
  m.innerHTML = `<div class="dlg-box sx-picker" role="dialog" aria-modal="true" aria-label="Share your screen"><div class="sx-add-head"><h3>Share your screen</h3><span class="sp"></span><button class="ibtn" data-p="close" aria-label="Close">${icon("x")}</button></div>
    <div class="seg sm" id="sxPickTabs"><button class="on" data-p="tab:screen">Screens</button><button data-p="tab:window">Windows</button></div>
    <div class="sx-pick-grid" id="sxPickGrid"><div class="sx-skel tile"></div><div class="sx-skel tile"></div></div>
    <div class="sx-pick-q" role="radiogroup" aria-label="Quality">${Object.entries(SHARE_QUALITY).map(([k, q]) => `<button role="radio" data-p="q:${k}" aria-checked="${k === quality}" class="${k === quality ? "on" : ""}"><b>${q.label}</b><small>${q.sub}</small></button>`).join("")}</div>
    <div class="dlg-acts"><button class="btn ghost" data-p="close">Cancel</button><button class="btn primary" data-p="go" disabled>${icon("screen")}Share</button></div></div>`;
  m.classList.remove("hidden");
  let list = [], tab = "screen", sel = null;
  const close = () => { m.classList.add("hidden"); m.onclick = null; pickerOpen = false; document.removeEventListener("keydown", key, true); };
  const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", key, true);
  const draw = () => {
    const items = list.filter(s => tab === "screen" ? s.screen : !s.screen);
    $("#sxPickGrid").innerHTML = items.length ? items.map(s => `<button class="sx-pick${sel === s.id ? " on" : ""}" data-p="sel:${esc(s.id)}" title="${esc(s.name)}">
        <span class="sx-pick-img">${s.thumb ? `<img src="${s.thumb}" alt="">` : icon("screen")}</span><span class="sx-pick-name">${s.icon ? `<img src="${s.icon}" alt="">` : ""}<span>${esc(s.name)}</span></span></button>`).join("")
      : `<p class="sx-none">${tab === "screen" ? "No screens found." : "No windows to share."}</p>`;
    m.querySelector('[data-p="go"]').disabled = !sel;
    m.querySelectorAll("#sxPickTabs button").forEach(b => b.classList.toggle("on", b.dataset.p === "tab:" + tab));
  };
  try { list = await api.screens(); sel = (list.find(s => s.screen) || {}).id || null; draw(); }
  catch (e) { $("#sxPickGrid").innerHTML = `<p class="sx-none bad">Couldn't list your screens: ${esc(e.message)}</p>`; }
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-p]"); if (!b) return;
    const [a, x] = b.dataset.p.split(/:(.*)/);
    if (a === "close") return close();
    if (a === "tab") { tab = x; sel = (list.find(s => (tab === "screen") === s.screen) || {}).id || null; return draw(); }
    if (a === "sel") { sel = x; return draw(); }
    if (a === "q") { quality = x; S.settings.shareQuality = x; api.rpc("save_settings", { p_data: S.settings }).catch(() => {}); m.querySelectorAll("[data-p^='q:']").forEach(q => { const on = q.dataset.p === "q:" + x; q.classList.toggle("on", on); q.setAttribute("aria-checked", on); }); return; }
    if (a === "go" && sel && S.call) {
      b.disabled = true;
      try {
        await api.shareSource(sel);
        const q = SHARE_QUALITY[quality];
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } }, audio: false });
        await S.call.shareScreen(stream, quality);
        close();
      } catch (er) { b.disabled = false; toast(er.name === "NotAllowedError" ? "Screen sharing was blocked." : "Couldn't share: " + er.message, true); }
    }
  };
}

export const CallUI = {
  init() {
    document.addEventListener("sky:view", () => renderDock());
    addEventListener("beforeunload", () => { if (S.call && S.call.state !== "ended") S.call.hangup("ended"); });
  },
  start, onSignal, renderStage, renderSlot, renderDock, pickScreen,
};
