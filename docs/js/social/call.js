// One call between two friends: a direct WebRTC connection (microphone, camera, shared screen),
// set up through the server's call signals (ring → accept → offer/answer/ICE) and torn down cleanly.
// Three fixed lanes (sound, camera, screen) are agreed once, so turning the camera or screen on and off
// later never needs renegotiation: a lane just gets a track or loses it.
import { openMic, tuneOpus, tuneVoiceSender, preferRed, voiceKbps } from "./audio.js";
const RING_MS = 30000;

export class Call {
  constructor({ id, peer, role, video, ice, send, devices = {}, onChange }) {
    this.id = id; this.peer = peer; this.role = role; this.wantVideo = !!video; this.ice = ice; this.send = send; this.devices = devices;
    this.onChange = onChange || (() => {});
    this.state = role === "caller" ? "calling" : "incoming";
    this.local = { mic: null, cam: null, screen: null };
    this.remote = { audio: null, cam: null, screen: null };
    this.muted = false; this.peerState = { mic: true, cam: false, screen: false };
    this.pending = []; this.seen = new Set(); this.startedAt = 0; this.reason = "";
  }
  set(state, extra) { this.state = state; if (extra) Object.assign(this, extra); this.onChange(this); }

  /* ---------- your microphone and camera ---------- */
  async media(video) {
    const d = this.devices, v = this.voice || {};
    // no microphone (or not allowed): still call; you hear them, they can't hear you
    try { this.local.mic = await openMic(d.mic, v); } catch (e) { this.noMic = permissionWords(e, "microphone"); this.local.mic = null; }
    if (video) {   // no camera: still call with your voice
      try { this.local.cam = (await navigator.mediaDevices.getUserMedia({ video: { deviceId: d.cam ? { ideal: d.cam } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })).getVideoTracks()[0] || null; }
      catch (e) { this.camError = permissionWords(e, "camera"); this.local.cam = null; }
    }
    if (this.local.mic) this.local.mic.enabled = !this.muted;
    if (this.joinMuted && this.local.mic && !this.mutedOnce) { this.mutedOnce = true; this.muted = true; this.local.mic.enabled = false; }
  }

  /* ---------- starting, answering, ending ---------- */
  async start() {   // you're calling
    await this.media(this.wantVideo);
    await this.send("ring", { video: this.wantVideo });
    this.ringTimer = setTimeout(() => { if (this.state === "calling") this.hangup("no_answer"); }, RING_MS);
    // their Skyline answers "ringing" straight away; silence means it isn't running (they're really offline)
    this.reachTimer = setTimeout(() => { if (this.state === "calling" && !this.ringing) this.hangup("unreachable"); }, 9000);
    this.onChange(this);
  }
  async accept(video) {   // you're answering
    if (this.state !== "incoming") return;
    clearTimeout(this.ringTimer);
    this.set("connecting");
    await this.media(video);
    await this.send("accept", {});
    this.connectTimer = setTimeout(() => { if (this.state === "connecting") this.hangup("failed"); }, 25000);
  }
  decline() { if (this.state !== "incoming") return; this.send("decline", {}).catch(() => {}); this.end("declined_by_you"); }
  hangup(reason = "ended") {
    if (this.state === "ended") return;
    const kind = this.state === "calling" ? "cancel" : "end";
    this.send(kind, { reason }).catch(() => {});
    this.end(reason);
  }
  end(reason) {
    if (this.state === "ended") return;
    clearTimeout(this.ringTimer); clearTimeout(this.connectTimer); clearTimeout(this.lostTimer); clearTimeout(this.reachTimer);
    for (const k of ["mic", "cam", "screen"]) if (this.local[k]) { this.local[k].onended = null; this.local[k].stop(); this.local[k] = null; }
    try { if (this.dc) this.dc.close(); } catch (e) {}
    try { if (this.pc) this.pc.close(); } catch (e) {}
    this.pc = null;
    this.set("ended", { reason, endedAt: Date.now() });
  }

  /* ---------- the connection ---------- */
  makePc() {
    const pc = this.pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: "max-bundle" });
    pc.onicecandidate = e => { if (e.candidate) this.send("ice", { c: e.candidate.toJSON() }).catch(() => {}); };
    pc.ontrack = e => {
      const i = pc.getTransceivers().indexOf(e.transceiver), lane = ["audio", "cam", "screen"][i];
      if (!lane) return;
      this.remote[lane] = new MediaStream([e.track]);
      e.track.onunmute = () => this.onChange(this); e.track.onmute = () => this.onChange(this);
      this.onChange(this);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") { clearTimeout(this.connectTimer); clearTimeout(this.lostTimer); if (!this.startedAt) this.startedAt = Date.now(); this.set("connected"); this.sendState(); this.tuneScreen(); }
      else if (s === "disconnected") { this.set("reconnecting"); clearTimeout(this.lostTimer); this.lostTimer = setTimeout(() => { if (this.pc && this.pc.connectionState !== "connected") this.hangup("lost"); }, 15000); }
      else if (s === "failed") this.hangup("failed");
    };
    pc.ondatachannel = e => this.useChannel(e.channel);
    return pc;
  }
  useChannel(dc) {
    this.dc = dc;
    dc.onopen = () => this.sendState();
    dc.onmessage = e => { try { const m = JSON.parse(e.data); if (!m || typeof m !== "object") return;
      if (m.t) { if (this.onData) this.onData(m); return; }   // something shared (watching together)
      this.peerState = { mic: !!m.mic, cam: !!m.cam, screen: !!m.screen }; this.onChange(this); } catch (er) {} };
  }
  sendData(obj) { if (this.dc && this.dc.readyState === "open" && JSON.stringify(obj).length < 8000) this.dc.send(JSON.stringify(obj)); }
  sendState() {
    if (this.dc && this.dc.readyState === "open") this.dc.send(JSON.stringify({ mic: !this.muted && !!this.local.mic, cam: !!this.local.cam, screen: !!this.local.screen }));
  }
  async flushIce() {
    if (!this.pc || !this.pc.remoteDescription) return;
    const q = this.pending; this.pending = [];
    for (const c of q) { try { await this.pc.addIceCandidate(c); } catch (e) {} }
  }

  // a signal from the other person (each arrives once, even if the live feed reconnects)
  async signal(sig) {
    if (this.seen.has(sig.id)) return; this.seen.add(sig.id);
    const p = sig.payload || {};
    try {
      if (sig.kind === "ringing" && this.role === "caller") { this.ringing = true; this.onChange(this); }
      else if (sig.kind === "accept" && this.role === "caller" && this.state === "calling") {
        clearTimeout(this.ringTimer); this.set("connecting");
        const pc = this.makePc();
        this.tx = [
          pc.addTransceiver(this.local.mic || "audio", { direction: "sendrecv" }),
          pc.addTransceiver(this.local.cam || "video", { direction: "sendrecv" }),
          pc.addTransceiver("video", { direction: "sendrecv" }),
        ];
        preferRed(this.tx[0]); preferGpuCodec(this.tx[2]);
        this.useChannel(pc.createDataChannel("state"));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.send("offer", { sdp: pc.localDescription.toJSON() });
        this.connectTimer = setTimeout(() => { if (this.state === "connecting") this.hangup("failed"); }, 25000);
      } else if (sig.kind === "offer" && this.role === "callee" && this.state === "connecting" && !this.pc) {
        const pc = this.makePc();
        await pc.setRemoteDescription(tuneOpus(boostScreen(p.sdp), voiceKbps(this.voice)));
        this.tx = pc.getTransceivers();
        this.tx.forEach(t => { t.direction = "sendrecv"; });
        preferRed(this.tx[0]); preferGpuCodec(this.tx[2]);
        if (this.tx[0]) await this.tx[0].sender.replaceTrack(this.local.mic);
        if (this.tx[1] && this.local.cam) await this.tx[1].sender.replaceTrack(this.local.cam);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.send("answer", { sdp: pc.localDescription.toJSON() });
        if (this.tx[0]) tuneVoiceSender(this.tx[0].sender, voiceKbps(this.voice));
        await this.flushIce();
      } else if (sig.kind === "answer" && this.pc && !this.pc.currentRemoteDescription) {
        await this.pc.setRemoteDescription(tuneOpus(boostScreen(p.sdp), voiceKbps(this.voice)));
        if (this.tx && this.tx[0]) tuneVoiceSender(this.tx[0].sender, voiceKbps(this.voice));
        await this.flushIce();
      } else if (sig.kind === "ice" && p.c) {
        this.pending.push(p.c); await this.flushIce();
      } else if (sig.kind === "decline") this.end(p.reason === "device" ? "their_device" : "declined");
      else if (sig.kind === "busy") this.end("busy");
      else if (sig.kind === "cancel") this.end(this.state === "incoming" ? "missed" : "ended_by_them");
      else if (sig.kind === "end") this.end("ended_by_them");
    } catch (e) { console.log("[call] signal", sig.kind, e.message); }
  }

  /* ---------- controls ---------- */
  toggleMute() {
    this.muted = !this.muted;
    if (this.local.mic) this.local.mic.enabled = !this.muted;
    this.sendState(); this.onChange(this);
  }
  // after a microphone is plugged in during a call: try again
  async retryMic() {
    try {
      this.local.mic = await openMic(this.devices.mic, this.voice || {}); this.local.mic.enabled = !this.muted; this.noMic = null;
      if (this.tx && this.tx[0]) await this.tx[0].sender.replaceTrack(this.local.mic);
      this.sendState(); this.onChange(this); return true;
    } catch (e) { this.noMic = permissionWords(e, "microphone"); this.onChange(this); return false; }
  }
  async toggleCam() {
    if (this.local.cam) {
      const t = this.local.cam; this.local.cam = null; t.stop();
      if (this.tx && this.tx[1]) await this.tx[1].sender.replaceTrack(null);
    } else {
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: this.devices.cam ? { ideal: this.devices.cam } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
      catch (e) { throw new Error(permissionWords(e, "camera")); }
      this.local.cam = s.getVideoTracks()[0];
      if (this.tx && this.tx[1]) await this.tx[1].sender.replaceTrack(this.local.cam);
    }
    this.sendState(); this.onChange(this);
  }
  // share the screen or window picked in Skyline's picker (the main process hands that exact source to Chromium)
  async shareScreen(stream, quality = "smooth") {
    const t = stream.getVideoTracks()[0]; if (!t) throw new Error("Nothing to share.");
    this.shareQ = SHARE_QUALITY[quality] ? quality : "smooth";
    t.contentHint = SHARE_QUALITY[this.shareQ].hint;
    if (this.local.screen) this.local.screen.stop();
    this.local.screen = t;
    t.onended = () => { if (this.local.screen === t) this.stopShare(); };   // stopped from Windows, or the window closed
    if (this.tx && this.tx[2]) { await this.tx[2].sender.replaceTrack(t); this.tuneScreen(); }
    this.sendState(); this.onChange(this);
  }
  async stopShare() {
    const t = this.local.screen; this.local.screen = null;
    if (t) { t.onended = null; t.stop(); }
    if (this.tx && this.tx[2]) await this.tx[2].sender.replaceTrack(null).catch(() => {});
    this.sendState(); this.onChange(this);
  }
  async tuneScreen() {   // the shared screen is sent at the size and smoothness picked, with room to look clean
    const s = this.tx && this.tx[2] && this.tx[2].sender; if (!s) return;
    const q = SHARE_QUALITY[this.shareQ] || SHARE_QUALITY.smooth;
    try {
      const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      Object.assign(p.encodings[0], { maxBitrate: q.kbps * 1000, maxFramerate: q.fps, scaleResolutionDownBy: 1, priority: "high", networkPriority: "high" });
      p.degradationPreference = q.keep; await s.setParameters(p);
    } catch (e) {}
  }
  get duration() { return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0; }
}

// how a shared screen is sent. Smooth: games and video. Sharp: text and code at full size. Saver: slow internet.
export const SHARE_QUALITY = {
  smooth: { label: "Smooth", sub: "1080p · 60 fps", w: 1920, h: 1080, fps: 60, kbps: 12000, hint: "motion", keep: "balanced" },
  sharp: { label: "Sharp", sub: "Full size · 30 fps", w: 3840, h: 2160, fps: 30, kbps: 14000, hint: "detail", keep: "maintain-resolution" },
  saver: { label: "Data saver", sub: "720p · 30 fps", w: 1280, h: 720, fps: 30, kbps: 2500, hint: "motion", keep: "balanced" },
};
// the shared screen starts sharp: a call normally starts at a low bitrate and climbs slowly, so a shared screen
// looked blurry for the first seconds. The screen lane (the third one) is told to start high and never drop below a floor.
// (lane: which media section carries the screen: 3 in a call, 2 in a voice channel)
export function boostScreen(desc, lane = 3) {
  try {
    if (!desc || !desc.sdp) return desc;
    const parts = desc.sdp.split(/\r\n(?=m=)/);   // [session, m=audio, m=video (camera), m=video (screen)]
    if (parts.length <= lane || !/^m=video/.test(parts[lane])) return desc;
    let sec = parts[lane];
    const pts = (/^m=video \d+ [A-Z/]+ ([\d ]+)/.exec(sec) || [, ""])[1].trim().split(/\s+/).filter(Boolean);
    const want = "x-google-start-bitrate=6000;x-google-min-bitrate=1500;x-google-max-bitrate=16000";
    for (const pt of pts) {
      const codec = (new RegExp("a=rtpmap:" + pt + " ([A-Za-z0-9-]+)/").exec(sec) || [])[1] || "";
      if (!/^(VP8|VP9|H264|AV1)$/i.test(codec)) continue;   // (not rtx / red / ulpfec)
      const fm = new RegExp("(a=fmtp:" + pt + " [^\r\n]*)");
      if (fm.test(sec)) { if (!/x-google-start-bitrate/.test(sec.match(fm)[1])) sec = sec.replace(fm, "$1;" + want); }
      else sec = sec.replace(new RegExp("(a=rtpmap:" + pt + " [^\r\n]*)"), "$1\r\na=fmtp:" + pt + " " + want);
    }
    if (!/\r\nb=AS:/.test(sec)) sec = sec.replace(/(\r\nc=[^\r\n]*)/, "$1\r\nb=AS:16000");
    parts[lane] = sec;
    return { type: desc.type, sdp: parts.join("\r\n") };
  } catch (e) { return desc; }
}
// the screen lane prefers H.264 (usually encoded by the graphics card, so sharing a game costs it little); others stay as fallbacks
function preferGpuCodec(tx) {
  try {
    const caps = RTCRtpReceiver.getCapabilities("video"); if (!caps || !tx || !tx.setCodecPreferences) return;
    const rank = c => /h264/i.test(c.mimeType) ? (/42e01f|4d00|640c/i.test(c.sdpFmtpLine || "") ? 0 : 1) : /vp9/i.test(c.mimeType) ? 2 : 3;
    tx.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
  } catch (e) {}
}

export function permissionWords(e, what) {
  const n = e && e.name;
  if (n === "NotAllowedError" || n === "SecurityError") return `Skyline isn't allowed to use your ${what}. Check Windows Settings → Privacy & security → ${what === "camera" ? "Camera" : "Microphone"}.`;
  if (n === "NotFoundError" || n === "OverconstrainedError") return `No ${what} was found.`;
  if (n === "NotReadableError" || n === "AbortError") return `Your ${what} is being used by another app.`;
  return `Couldn't start your ${what}${e && e.message ? ": " + e.message : "."}`;
}
