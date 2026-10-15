// How Sky talks: Kokoro, a natural voice on this PC (or ElevenLabs if you add a key), spoken sentence by sentence so it
// starts almost at once, with its loudness feeding the assistant's orb. Falls back to the Windows voice.
import { sky } from "./util.js";

export const DEFAULT_VOICE = "kokoro:af_heart";

// 32-bit float samples -> a 16-bit WAV file
function wav(pcm, rate) {
  const n = pcm.length, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf), str = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); d.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); d.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}

const V = { ctx: null, gain: null, an: null, data: null, token: 0, sources: [], speaking: false, status: { state: "none" }, subs: new Set() };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function audio() {
  if (!V.ctx) {
    V.ctx = new AudioContext(); V.gain = V.ctx.createGain(); V.an = V.ctx.createAnalyser(); V.an.fftSize = 512;
    V.gain.connect(V.an); V.an.connect(V.ctx.destination); V.data = new Float32Array(V.an.fftSize);
  }
  if (V.ctx.state === "suspended") V.ctx.resume();
  return V.ctx;
}

// Written words -> words worth saying.
export function speakable(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "").replace(/[“”"«»]/g, "").replace(/[‘’]/g, "'")
    .replace(/\p{Extended_Pictographic}|️/gu, "").replace(/[*_#`~|<>]/g, "")
    .replace(/°\s?F\b/g, " degrees").replace(/°\s?C\b/g, " degrees Celsius").replace(/°/g, " degrees")
    .replace(/(\d)\s?%/g, "$1 percent").replace(/&/g, " and ").replace(/\s+[–—]\s+/g, ", ").replace(/\s›\s/g, ", ")
    .replace(/\be\.g\./gi, "for example").replace(/\bi\.e\./gi, "that is").replace(/\s+/g, " ").trim();
}
// Short pieces, so the first one is ready almost at once and long replies never stall.
export function pieces(text) {
  const raw = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text], out = [];
  for (let s of raw) {
    s = s.trim(); if (!s) continue;
    if (out.length && (out[out.length - 1].length < 18 || s.length < 8) && out[out.length - 1].length + s.length < 160) out[out.length - 1] += " " + s;
    else if (s.length > 220) { for (const c of s.match(/.{1,200}(\s|$)/g) || [s]) out.push(c.trim()); }
    else out.push(s);
  }
  // the first piece is what you wait for: keep it short (split a long first sentence at a comma)
  if (out[0] && out[0].length > 70) { const m = out[0].match(/^(.{18,80}?[,—–])\s+(.{12,})$/); if (m) out.splice(0, 1, m[1], m[2]); }
  return out.filter(Boolean);
}

export const Voice = {
  get speaking() { return V.speaking; },
  status() { return V.status; },
  on(fn) { V.subs.add(fn); return () => V.subs.delete(fn); },
  async init() {
    if (!sky || !sky.voice) return;
    V.status = await sky.voice.status().catch(() => V.status);
    sky.voice.onStatus(s => { V.status = s; for (const f of V.subs) f(s); });
  },
  ready() { return V.status.state === "ready"; },
  usable() { return V.status.state === "ready"; },
  voices() { return V.status.voices || []; },
  warm() { if (sky && sky.voice) sky.voice.load().catch(() => {}); },
  prepare(voice) { if (sky && sky.voice && sky.voice.prepare) sky.voice.prepare(voice || DEFAULT_VOICE).catch(() => {}); },   // connect to the voice ahead of time
  async refresh() { if (sky && sky.voice) { V.status = await sky.voice.status().catch(() => V.status); for (const f of V.subs) f(V.status); } return V.status; },
  // the speaker's loudness right now, 0..1 (for the orb)
  level() {
    if (!V.speaking || !V.an) return 0;
    V.an.getFloatTimeDomainData(V.data); let s = 0; for (let i = 0; i < V.data.length; i++) s += V.data[i] * V.data[i];
    return Math.min(1, Math.sqrt(s / V.data.length) * 6);
  },
  stop() {
    V.token++; V.speaking = false;
    for (const s of V.sources) { try { s.stop(); } catch (e) {} } V.sources = [];
    try { speechSynthesis.cancel(); } catch (e) {}
  },
  // speak with the neural voice; resolves when finished (or stopped). Throws if the neural voice can't be used.
  async neural(text, { voice = DEFAULT_VOICE, speed = 1.3, onStart } = {}) {
    this.stop(); const tok = V.token, ctx = audio();
    if (ctx.state !== "running") { await Promise.race([ctx.resume(), sleep(400)]); if (ctx.state !== "running") throw new Error("audio is blocked"); }
    const parts = pieces(speakable(text)); if (!parts.length) return;
    // up to three pieces are being made at once, so later ones are ready before they're needed
    const made = [], make = i => { if (i < parts.length && !made[i]) { made[i] = sky.voice.say(parts[i], voice, speed); made[i].catch(() => {}); } return made[i]; };
    make(0); make(1); make(2);
    let at = 0, started = false;
    for (let i = 0; i < parts.length; i++) {
      const res = await make(i); if (tok !== V.token) return;
      make(i + 3);
      let buf;
      if (res.mp3) {   // a natural voice: compressed audio
        const u8 = res.mp3 instanceof Uint8Array ? res.mp3 : new Uint8Array(res.mp3);
        buf = await ctx.decodeAudioData(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); if (tok !== V.token) return;
      } else {
        const pcm = res.pcm instanceof Float32Array ? res.pcm : new Float32Array(res.pcm);
        const n = pcm.length, fade = Math.min(240, n >> 3);   // tiny fades: no clicks between pieces
        for (let k = 0; k < fade; k++) { pcm[k] *= k / fade; pcm[n - 1 - k] *= k / fade; }
        buf = ctx.createBuffer(1, n, res.rate); buf.copyToChannel(pcm, 0);
      }
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(V.gain);
      const t = Math.max(ctx.currentTime + .03, at); src.start(t); at = t + buf.duration + (/[.!?]$/.test(parts[i]) ? .14 : .06);
      V.sources.push(src);
      if (!started) { started = true; V.speaking = true; onStart && onStart(); }
    }
    // done when the last piece ends, or by the clock if the sound device stalls
    const last = V.sources[V.sources.length - 1];
    if (last) await new Promise(res => { last.onended = res; setTimeout(res, Math.max(0, (at - ctx.currentTime) * 1000) + 400); });
    if (tok === V.token) { V.speaking = false; V.sources = []; }
  },
  // Sky's voice through a plain audio player: works even when Skyline is hidden in the tray (a hidden window can't
  // always start the normal sound path, which used to drop Sky to the Windows voice, e.g. for the 11 pm bedtime line)
  async neuralQuiet(text, { voice = DEFAULT_VOICE, speed = 1.3, onStart } = {}) {
    this.stop(); const tok = V.token, parts = pieces(speakable(text)); if (!parts.length) return;
    const made = parts.map(p => sky.voice.say(p, voice, speed)); made.forEach(m => m.catch(() => {}));
    for (let i = 0; i < parts.length; i++) {
      const res = await made[i]; if (tok !== V.token) return;
      const blob = res.mp3 ? new Blob([res.mp3 instanceof Uint8Array ? res.mp3 : new Uint8Array(res.mp3)], { type: "audio/mpeg" }) : wav(res.pcm instanceof Float32Array ? res.pcm : new Float32Array(res.pcm), res.rate);
      const url = URL.createObjectURL(blob), el = new Audio(url);
      try {
        await el.play();
        if (i === 0) { V.speaking = true; onStart && onStart(); }
        await new Promise(r => { el.onended = el.onerror = r; setTimeout(r, (el.duration || 30) * 1000 + 800); });
      } finally { URL.revokeObjectURL(url); }
      if (tok !== V.token) { el.pause(); return; }
    }
    if (tok === V.token) V.speaking = false;
  },
  // the Windows voice (always there)
  windows(text, { name = "", rate = 1, onStart } = {}) {
    this.stop(); const tok = V.token;
    return new Promise(res => {
      try {
        const u = new SpeechSynthesisUtterance(speakable(text)), vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
        u.voice = vs.find(v => v.name === name) || vs.find(v => /aria|jenny|natural/i.test(v.name)) || vs.find(v => /zira/i.test(v.name)) || vs[0] || null;
        u.rate = rate; u.onstart = () => { if (tok === V.token) { V.speaking = true; onStart && onStart(); } };
        u.onend = u.onerror = () => { if (tok === V.token) V.speaking = false; res(); };
        u.onboundary = () => { V.boundary = performance.now(); };
        speechSynthesis.speak(u);
      } catch (e) { res(); }
    });
  },
  windowsLevel() { return V.speaking && performance.now() - (V.boundary || 0) < 260 ? .5 + Math.random() * .3 : V.speaking ? .15 : 0; },
  // little sounds: Skyline starts listening, heard you, or something went wrong
  chime(kind) {
    try {
      const ctx = audio(), now = ctx.currentTime, notes = kind === "listen" ? [[660, 0], [990, .09]] : kind === "heard" ? [[880, 0]] : kind === "error" ? [[330, 0], [247, .12]] : [[740, 0], [1110, .08]];
      for (const [f, d] of notes) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, now + d); g.gain.linearRampToValueAtTime(.09, now + d + .015); g.gain.exponentialRampToValueAtTime(.0001, now + d + .28);
        o.connect(g).connect(ctx.destination); o.start(now + d); o.stop(now + d + .3);
      }
    } catch (e) {}
  },
};
