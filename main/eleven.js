// ElevenLabs: the most human-sounding voices there are (breaths, warmth, real emotion), the top voice engine Jarvis
// supports too. Optional: it needs your own ElevenLabs key (a free account includes about 10,000 characters a month).
// The key is stored encrypted (Windows DPAPI via safeStorage) and never reaches the interface.
const fs = require("fs");
const path = require("path");
const { safeStorage, net } = require("electron");

const API = "https://api.elevenlabs.io/v1";

class Eleven {
  constructor(dataDir) { this.file = path.join(dataDir, "voicekeys.json"); this.list = null; this.listAt = 0; }
  conf() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { return {}; } }
  save(c) { const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(c), "utf8"); fs.renameSync(tmp, this.file); }
  key() {
    if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
    const c = this.conf();
    if (c.eleven && safeStorage.isEncryptionAvailable()) { try { return safeStorage.decryptString(Buffer.from(c.eleven, "base64")); } catch (e) {} }
    return "";
  }
  has() { return !!this.key(); }
  async setKey(k) {
    k = String(k || "").trim(); if (!/^[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error("That doesn't look like an ElevenLabs key");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't encrypt the key on this PC");
    const old = this.conf(); this.save({ ...old, eleven: safeStorage.encryptString(k).toString("base64") }); this.list = null;
    try { await this.voices(true); } catch (e) { this.save(old); this.list = null; throw e; }   // a key that doesn't work isn't kept
    return true;
  }
  clearKey() { const c = this.conf(); delete c.eleven; this.save(c); this.list = null; return true; }
  async voices(force) {
    const key = this.key(); if (!key) return [];
    if (this.list && !force && Date.now() - this.listAt < 3600e3) return this.list;
    const r = await net.fetch(API + "/voices", { headers: { "xi-api-key": key } });
    if (r.status === 401) throw new Error("ElevenLabs didn't accept that key");
    if (!r.ok) throw new Error("ElevenLabs didn't answer (" + r.status + ")");
    const j = await r.json(), cap = s => String(s || "").replace(/^./, c => c.toUpperCase());
    this.list = (j.voices || []).map(v => { const l = v.labels || {};
      return { id: "eleven:" + v.voice_id, name: String(v.name || "Voice").split(/\s+[-–]\s+/)[0].slice(0, 24), desc: [cap(l.description || l.descriptive), l.gender ? cap(l.gender === "female" ? "woman" : l.gender === "male" ? "man" : l.gender) : "", cap(l.use_case || "")].filter(Boolean).join(" · ") + " · ElevenLabs",
        accent: cap(l.accent || ""), gender: l.gender || "", eleven: true }; }).slice(0, 60);
    this.listAt = Date.now();
    return this.list;
  }
  // text -> mp3. Speed 1 = natural.
  async speak(text, voiceId, speed = 1) {
    const key = this.key(); if (!key) throw new Error("No ElevenLabs key");
    const r = await net.fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, { method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.38, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: Math.max(0.7, Math.min(1.2, speed)) } }) });
    if (!r.ok) { const msg = r.status === 401 ? "ElevenLabs didn't accept the key" : r.status === 402 || r.status === 429 ? "Your ElevenLabs characters ran out for now" : "ElevenLabs didn't answer (" + r.status + ")"; throw new Error(msg); }
    return Buffer.from(await r.arrayBuffer());
  }
}

module.exports = { Eleven };
