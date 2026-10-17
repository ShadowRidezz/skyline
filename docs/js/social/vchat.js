// Voice channels: hang out in a server's voice channel with up to 10 friends at once. Everyone connects
// straight to everyone else (WebRTC, audio only); the server only says who's there and passes the
// connection signals along. Mute, deafen, a speaking ring, and you stay connected on any page.
// Go Live: share your screen with the channel. Everyone has a picture lane from the start (no renegotiating);
// the picture only goes to the people who chose to watch, so streaming to one friend costs one upload.
import { toast } from "../util.js";
import { api } from "./api.js";
import { S, emit } from "./state.js";
import { permissionWords, SHARE_QUALITY, boostScreen } from "./call.js";
import { openMic, tuneOpus, tuneVoiceSender, preferRed, voiceKbps } from "./audio.js";

const V = { live: null, viewers: new Set(), watching: null, channel: null, server: null, peers: new Map(), mic: null, noMic: "", muted: false, deafened: false, hb: 0, ctx: null, gain: null, meAn: null, meSrc: null, timer: 0, last: new Map(), seen: new Set() };
const sig = (to, kind, payload) => api.rpc("send_voice_signal", { p_channel: V.channel, p_to: to, p_kind: kind, p_payload: payload || null }).catch(() => {});

function audio() {
  if (!V.ctx) { V.ctx = new AudioContext({ latencyHint: "interactive" }); V.gain = V.ctx.createGain(); V.gain.connect(V.ctx.destination); }
  if (V.ctx.state === "suspended") V.ctx.resume();
  V.gain.gain.value = V.deafened ? 0 : Math.max(0, Math.min(3, ((S.settings.voice || {}).volume ?? 200) / 100));
  const out = (S.settings.devices || {}).out; if (out && V.ctx.setSinkId) V.ctx.setSinkId(out).catch(() => {});
  return V.ctx;
}
// the voice lane (after an offer arrives, the microphone's lane is the one it matched)
const audioTx = p => p.pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === "audio") || null;
function peer(uid, initiator) {
  let p = V.peers.get(uid); if (p) return p;
  const pc = new RTCPeerConnection({ iceServers: S.ice });
  p = { uid, pc, pending: [], el: null, src: null, an: null, made: Date.now(), vtx: null, video: null };
  V.peers.set(uid, p);
  if (V.mic) pc.addTrack(V.mic, new MediaStream([V.mic])); else pc.addTransceiver("audio", { direction: initiator ? "sendrecv" : "recvonly" });
  if (initiator) preferRed(audioTx(p));
  if (initiator) p.vtx = pc.addTransceiver("video", { direction: "sendrecv" });   // the Go Live lane (the other side gets it from the offer)
  pc.onicecandidate = e => { if (e.candidate) sig(uid, "ice", { c: e.candidate.toJSON() }); };
  pc.ontrack = e => {
    if (e.track.kind === "video") { p.video = new MediaStream([e.track]); emit("voicelive"); return; }   // someone's live screen
    const s = e.streams[0] || new MediaStream([e.track]);
    if (!p.el) { p.el = document.createElement("audio"); p.el.autoplay = true; p.el.muted = true; p.el.dataset.voice = uid; document.body.appendChild(p.el); }   // (the stream has to play somewhere to reach the sound graph)
    p.el.srcObject = s; p.el.play().catch(() => {});
    const ctx = audio(); if (p.src) try { p.src.disconnect(); } catch (er) {}
    p.src = ctx.createMediaStreamSource(s); p.an = p.an || ctx.createAnalyser(); p.an.fftSize = 512;
    p.src.connect(V.gain); p.src.connect(p.an);
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { close(uid); } emit("voice"); };
  return p;
}
function close(uid) {
  const p = V.peers.get(uid); if (!p) return;
  try { p.pc.close(); } catch (e) {} if (p.src) try { p.src.disconnect(); } catch (e) {}
  if (p.el) { p.el.srcObject = null; p.el.remove(); }
  V.peers.delete(uid); emit("voice");
}
async function flush(p) { const q = p.pending; p.pending = []; for (const c of q) { try { await p.pc.addIceCandidate(c); } catch (e) {} } }

// someone's signal (only ever to you, from someone in your channel)
async function onSignal(row) {
  if (!row || V.seen.has(row.id)) return; V.seen.add(row.id);
  if (!V.channel || row.channel_id !== V.channel || row.from_id === S.me.id) return;
  const from = row.from_id, d = row.payload || {};
  try {
    if (row.kind === "offer") {
      const old = V.peers.get(from); if (old && old.pc.remoteDescription) close(from);   // they reconnected: start fresh (one made just for early candidates is kept)
      const p = peer(from);
      await p.pc.setRemoteDescription(tuneOpus(boostScreen(d.sdp, 2), voiceKbps(S.settings.voice))); preferRed(audioTx(p)); await flush(p);
      p.vtx = p.pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === "video") || null;
      if (p.vtx) p.vtx.direction = "sendrecv";
      if (V.live && V.viewers.has(from)) sendTo(p);
      const ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans);
      sig(from, "answer", { sdp: p.pc.localDescription.toJSON() });
      { const a = audioTx(p); if (a) tuneVoiceSender(a.sender, voiceKbps(S.settings.voice)); }
    } else if (row.kind === "answer") {
      const p = V.peers.get(from); if (p && !p.pc.currentRemoteDescription) { await p.pc.setRemoteDescription(tuneOpus(boostScreen(d.sdp, 2), voiceKbps(S.settings.voice))); { const a = audioTx(p); if (a) tuneVoiceSender(a.sender, voiceKbps(S.settings.voice)); } await flush(p); }
    } else if (row.kind === "ice" && d.c) {
      const p = V.peers.get(from) || peer(from);
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.c).catch(() => {}); else p.pending.push(d.c);
    } else if (row.kind === "bye") close(from);
    else if (row.kind === "watch") { V.viewers.add(from); const p = V.peers.get(from); if (p && V.live) sendTo(p); emit("voice"); }
    else if (row.kind === "unwatch") { V.viewers.delete(from); const p = V.peers.get(from); if (p && p.vtx) p.vtx.sender.replaceTrack(null).catch(() => {}); emit("voice"); }
  } catch (e) { console.log("[voice]", e); }
}
async function call(uid) {   // you joined: you connect to each person already there
  const p = peer(uid, true);
  const offer = await p.pc.createOffer(); await p.pc.setLocalDescription(offer);
  sig(uid, "offer", { sdp: p.pc.localDescription.toJSON() });
}

async function join(cid, sid) {
  if (V.channel === cid) return;
  if (S.call && S.call.state !== "ended") { toast("Leave your call first.", true); return; }
  if (V.channel) await leave(true);
  const vo = S.settings.voice || {}, dev = (S.settings.devices || {}).mic;
  V.noMic = "";
  try { V.mic = await openMic(dev, vo); }
  catch (e) { V.mic = null; V.noMic = permissionWords(e, "microphone"); toast("No microphone: you can listen, but nobody hears you. " + V.noMic, true); }
  V.channel = cid; V.server = sid; V.muted = !!vo.joinMuted; V.deafened = false; if (V.mic) V.mic.enabled = !V.muted;
  let others = [];
  try { others = await api.rpc("voice_join", { p_channel: cid }) || []; }
  catch (e) { toast(e.message, true); stopMic(); V.channel = V.server = null; emit("voice"); return; }
  audio();
  if (V.muted) api.rpc("voice_state", { p_muted: true, p_deafened: false }).catch(() => {});
  for (const o of others) call(o.id).catch(() => {});
  clearInterval(V.hb); V.hb = setInterval(() => api.rpc("voice_heartbeat").catch(e => { if (e.code === "not_in_voice") { toast("You were disconnected from voice."); leave(true); } }), 15000);
  if (!V.timer) V.timer = setInterval(speaking, 100);
  sound("join"); emit("voice"); emit("voicelist");
}
/* ---------- Go Live ---------- */
// your screen to one viewer, at the quality you picked
async function sendTo(p) {
  if (!p.vtx || !V.live) return;
  try {
    await p.vtx.sender.replaceTrack(V.live.track);
    const q = SHARE_QUALITY[V.live.quality] || SHARE_QUALITY.smooth, prm = p.vtx.sender.getParameters();
    if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
    Object.assign(prm.encodings[0], { maxBitrate: q.kbps * 1000, maxFramerate: q.fps, scaleResolutionDownBy: 1, priority: "high", networkPriority: "high" });
    prm.degradationPreference = q.keep; await p.vtx.sender.setParameters(prm);
  } catch (e) {}
}
async function goLive() {
  if (!V.channel) return;
  if (V.live) return stopLive();
  const { CallUI } = await import("./callui.js");
  CallUI.pickScreen(async (stream, quality) => {
    const track = stream.getVideoTracks()[0]; if (!track) throw new Error("Nothing to share.");
    track.contentHint = (SHARE_QUALITY[quality] || {}).hint || "motion";
    V.live = { track, quality }; track.onended = () => { if (V.live && V.live.track === track) stopLive(); };
    for (const uid of V.viewers) { const p = V.peers.get(uid); if (p) sendTo(p); }
    api.rpc("voice_state", { p_live: true }).catch(() => {});
    toast("You're live. Friends in the channel can click LIVE to watch."); emit("voice"); emit("voicelist");
  }, "Go Live: share your screen");
}
function stopLive() {
  if (!V.live) return;
  const t = V.live.track; V.live = null;
  for (const p of V.peers.values()) if (p.vtx) p.vtx.sender.replaceTrack(null).catch(() => {});
  try { t.onended = null; t.stop(); } catch (e) {}
  V.viewers.clear();
  if (V.channel) api.rpc("voice_state", { p_live: false }).catch(() => {});
  emit("voice"); emit("voicelist");
}
// watching someone's stream (they only send it once you ask)
function watch(uid) {
  if (!V.channel || uid === S.me.id) return;
  if (V.watching && V.watching !== uid) sig(V.watching, "unwatch");
  V.watching = uid; sig(uid, "watch"); emit("voicelive");
}
function unwatch() { if (!V.watching) return; const uid = V.watching; V.watching = null; if (V.channel) sig(uid, "unwatch"); emit("voicelive"); }

async function leave(quiet) {
  if (!V.channel) return;
  stopLive(); if (V.watching) { V.watching = null; emit("voicelive"); }
  for (const uid of [...V.peers.keys()]) { sig(uid, "bye"); close(uid); }
  clearInterval(V.hb); V.hb = 0; clearInterval(V.timer); V.timer = 0;
  stopMic();
  V.channel = V.server = null; V.last.clear();
  document.querySelectorAll("[data-vu].speaking").forEach(e => e.classList.remove("speaking"));
  await api.rpc("voice_leave").catch(() => {});
  if (!quiet) sound("leave");
  emit("voice"); emit("voicelist");
}
function stopMic() { if (V.mic) { V.mic.stop(); V.mic = null; } if (V.meSrc) try { V.meSrc.disconnect(); } catch (e) {} V.meSrc = null; }
function mute() {
  if (!V.channel) return; V.muted = !V.muted; if (V.deafened && !V.muted) V.deafened = false;
  if (V.mic) V.mic.enabled = !V.muted; audio();
  api.rpc("voice_state", { p_muted: V.muted, p_deafened: V.deafened }).catch(() => {}); sound(V.muted ? "mute" : "unmute"); emit("voice");
}
function deafen() {
  if (!V.channel) return; V.deafened = !V.deafened; V.muted = V.deafened ? true : false;
  if (V.mic) V.mic.enabled = !V.muted; audio();
  api.rpc("voice_state", { p_muted: V.muted, p_deafened: V.deafened }).catch(() => {}); sound(V.deafened ? "mute" : "unmute"); emit("voice");
}
// the voice list changed (someone joined or left): drop connections to people who've gone
function sync(list) {
  if (!V.channel) return;
  const here = new Set((list || []).map(x => x.id));
  if (!here.has(S.me.id) && list) { /* (the list may be a moment behind your own join) */ }
  for (const uid of [...V.peers.keys()]) if (!here.has(uid)) { const p = V.peers.get(uid); if (p && Date.now() - (p.made || 0) > 10000) close(uid); }
  // the one you're watching stopped streaming (or left)
  if (V.watching) { const w = (list || []).find(x => x.id === V.watching); if (!w || !w.live) { V.watching = null; emit("voicelive"); } }
}
// who's talking: a green ring on their name in the channel list
function level(an) { if (!an) return 0; const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length); }
function speaking() {
  if (!V.channel) return;
  const now = Date.now(), ctx = V.ctx;
  if (V.mic && ctx && !V.meSrc) { V.meSrc = ctx.createMediaStreamSource(new MediaStream([V.mic])); V.meAn = V.meAn || ctx.createAnalyser(); V.meAn.fftSize = 512; V.meSrc.connect(V.meAn); }
  const mark = (uid, on) => { if (on) V.last.set(uid, now); const t = now - (V.last.get(uid) || 0) < 300; document.querySelectorAll(`[data-vu="${uid}"]`).forEach(e => e.classList.toggle("speaking", t)); };
  mark(S.me.id, !V.muted && !!V.mic && level(V.meAn) > .025);
  for (const [uid, p] of V.peers) mark(uid, !V.deafened && level(p.an) > .018);
}
// the little join / leave / mute sounds
function sound(kind) {
  try {
    const ctx = audio(), t = ctx.currentTime, notes = { join: [523, 784], leave: [784, 523], mute: [440], unmute: [660] }[kind] || [600];
    notes.forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t + i * .09); g.gain.linearRampToValueAtTime(.05, t + i * .09 + .01); g.gain.exponentialRampToValueAtTime(.0001, t + i * .09 + .22); o.connect(g).connect(ctx.destination); o.start(t + i * .09); o.stop(t + i * .09 + .25); });
  } catch (e) {}
}
addEventListener("beforeunload", () => { if (V.channel) api.rpc("voice_leave").catch(() => {}); });

export const VoiceChat = {
  join, leave, mute, deafen, onSignal, sync, goLive, stopLive, watch, unwatch,
  stream: uid => { const p = V.peers.get(uid); return p && p.video; },
  setVolume: () => { if (V.ctx) audio(); },
  state: () => ({ live: !!V.live, viewers: V.viewers.size, watching: V.watching, channel: V.channel, server: V.server, muted: V.muted, deafened: V.deafened, noMic: V.noMic, peers: [...V.peers.values()].map(p => ({ uid: p.uid, state: p.pc.connectionState })) }),
  inVoice: () => !!V.channel,
};
