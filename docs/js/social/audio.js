// How your voice sounds on calls and in voice channels (one place, so calls, voice channels and the phone app match).
// - The microphone is opened at 48 kHz, the rate Opus (the call codec) works in, so nothing gets resampled.
// - "Clear voice" cleans it up before it's sent: a low cut takes out desk bumps, fan rumble and breath pops, and a
//   gentle leveller keeps you at one volume (quiet words lift, shouting doesn't clip).
// - Opus is told to send at 64 kbps (128 in Studio; WebRTC's default is ~32 kbps and it often sat near 20, which is what made calls sound like a phone),
//   with in-band error correction, and RED (every packet also carries the last one) so a dropped packet costs nothing.
export const VOICE_QUALITY = {
  standard: { label: "Standard", kbps: 32, note: "Less data, for a weak connection." },
  high: { label: "High", kbps: 64, note: "Clear, full voice. Best for most calls." },
  studio: { label: "Studio", kbps: 128, note: "Everything your mic picks up, for a good mic and headphones. Noise suppression and automatic volume are off." },
};
const quality = v => VOICE_QUALITY[v && v.quality] ? v.quality : "high";
export const voiceKbps = v => VOICE_QUALITY[quality(v)].kbps;

// your microphone, cleaned up: returns a track to send (stopping it stops the microphone too)
export async function openMic(deviceId, v = {}) {
  const studio = quality(v) === "studio";
  const raw = (await navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: deviceId ? { ideal: deviceId } : undefined,
    echoCancellation: v.echo !== false,
    noiseSuppression: !studio && v.noise !== false,
    autoGainControl: !studio && v.agc !== false,
    channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 16 }, latency: { ideal: 0.01 },
  } })).getAudioTracks()[0];
  if (v.clear === false) return raw;
  try {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(new MediaStream([raw]));
    const low = ctx.createBiquadFilter(); low.type = "highpass"; low.frequency.value = 85; low.Q.value = 0.7;
    // a light leveller: only touches loud peaks, quickly, so it never pumps or sounds squashed
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22; comp.knee.value = 14; comp.ratio.value = studio ? 2 : 3; comp.attack.value = 0.004; comp.release.value = 0.22;
    const gain = ctx.createGain(); gain.gain.value = studio ? 1 : 1.15;   // (makes up what the leveller takes off)
    const dest = ctx.createMediaStreamDestination(); dest.channelCount = 1;
    src.connect(low).connect(comp).connect(gain).connect(dest);
    const out = dest.stream.getAudioTracks()[0];
    const stopOut = out.stop.bind(out);
    out.stop = () => { stopOut(); raw.stop(); ctx.close().catch(() => {}); };
    out.raw = raw;
    raw.addEventListener("ended", () => { out.dispatchEvent(new Event("ended")); if (out.onended) out.onended(); });
    return out;
  } catch (e) { return raw; }   // (no sound processing here: send the microphone as it is)
}

// what we ask of the other side's encoder lives in the description we apply from them: Opus at full rate, error correction on
export function tuneOpus(desc, kbps = 64) {
  try {
    if (!desc || !desc.sdp) return desc;
    const parts = desc.sdp.split(/\r\n(?=m=)/), i = parts.findIndex(p => /^m=audio/.test(p)); if (i < 0) return desc;
    let sec = parts[i];
    const pt = (/a=rtpmap:(\d+) opus\/48000/i.exec(sec) || [])[1]; if (!pt) return desc;
    const want = { minptime: "10", useinbandfec: "1", usedtx: "0", stereo: "0", "sprop-stereo": "0", maxplaybackrate: "48000", "sprop-maxcapturerate": "48000", maxaveragebitrate: String(kbps * 1000) };
    const fm = new RegExp("a=fmtp:" + pt + " ([^\\r\\n]*)");
    const have = {}; const m = fm.exec(sec);
    if (m) m[1].split(";").forEach(kv => { const [k, val] = kv.split("="); if (k) have[k.trim()] = (val || "").trim(); });
    const line = "a=fmtp:" + pt + " " + Object.entries({ ...have, ...want }).map(([k, val]) => k + "=" + val).join(";");
    sec = m ? sec.replace(fm, line) : sec.replace(new RegExp("(a=rtpmap:" + pt + " [^\\r\\n]*)"), "$1\r\n" + line);
    parts[i] = sec;
    return { type: desc.type, sdp: parts.join("\r\n") };
  } catch (e) { return desc; }
}

// your side: the voice gets the bandwidth first, and RED is preferred when both sides have it
export async function tuneVoiceSender(sender, kbps = 64) {
  try {
    const p = sender.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    Object.assign(p.encodings[0], { maxBitrate: (kbps + 32) * 1000, priority: "high", networkPriority: "high" });
    await sender.setParameters(p);
  } catch (e) {}
}
export function preferRed(tx) {
  try {
    const caps = RTCRtpReceiver.getCapabilities("audio"); if (!caps || !tx || !tx.setCodecPreferences) return;
    const rank = c => /red/i.test(c.mimeType) ? 0 : /opus/i.test(c.mimeType) ? 1 : 2;
    tx.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
  } catch (e) {}
}
