// Sky's voice: Kokoro (natural, expressive, on this PC) by default; ElevenLabs if you add a key; Piper (the older,
// flatter voices Jarvis uses) as the last fallback. Microsoft's free "Edge" voices stopped letting apps in (Oct 2026),
// so Edge voice choices now speak with Kokoro.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { ipcMain, app } = require("electron");
const { Kokoro, KOKORO_VOICES, KOKORO_DEFAULT } = require("./kokoro");
const { Eleven } = require("./eleven");

const NAMES = { alan: ["Alan", "Calm British gentleman (the Jarvis voice)"], jenny_dioco: ["Jenny", "Warm British woman"], lessac: ["Lessac", "Clear American woman"],
  ryan: ["Ryan", "Friendly American man"], amy: ["Amy", "Bright American woman"], northern_english_male: ["Northern", "Northern English man"],
  cori: ["Cori", "Soft British woman"], joe: ["Joe", "Easygoing American man"], kristin: ["Kristin", "Gentle American woman"], hfc_male: ["Harper", "Deep American man"], hfc_female: ["Hailey", "Lively American woman"] };

class Voice {
  constructor(dataDir, getWin) {
    this.getWin = getWin; this.proc = null; this.key = ""; this.waiting = []; this.err = ""; this.eleven = new Eleven(dataDir); this.kokoro = new Kokoro();
    this.outDir = path.join(os.tmpdir(), "skyline-voice"); fs.mkdirSync(this.outDir, { recursive: true });
    this.dir = app.isPackaged ? path.join(process.resourcesPath, "piper") : path.join(__dirname, "..", "vendor", "piper");
    this.extra = [path.join(app.getPath("desktop"), "Jarvis", "piper", "voices"), path.join(os.homedir(), "OneDrive", "Desktop", "Jarvis", "piper", "voices"), path.join(os.homedir(), "Desktop", "Jarvis", "piper", "voices")];
  }
  exe() { const e = path.join(this.dir, "piper.exe"); return fs.existsSync(e) ? e : null; }
  voices() {
    const out = [], seen = new Set();
    for (const d of [path.join(this.dir, "voices"), ...this.extra]) {
      let files = []; try { files = fs.readdirSync(d).filter(f => f.endsWith(".onnx") && fs.existsSync(path.join(d, f + ".json"))); } catch (e) {}
      for (const f of files) {
        const id = f.replace(/\.onnx$/, ""); if (seen.has(id)) continue; seen.add(id);
        const m = id.match(/^([a-z]{2})_([A-Z]{2})-(.+?)-(x_low|low|medium|high)$/) || [], [n, desc] = NAMES[m[3]] || [cap(m[3] || id), ""];
        out.push({ id, name: n, desc: desc || (m[2] === "GB" ? "British" : "American"), accent: m[2] === "GB" ? "UK" : m[2] || "", file: path.join(d, f), fromJarvis: d !== path.join(this.dir, "voices") });
      }
    }
    const first = id => id === "en_GB-jenny_dioco-medium" ? 0 : id === "en_GB-alan-medium" ? 1 : 2;
    return out.sort((a, b) => first(a.id) - first(b.id) || a.name.localeCompare(b.name));
  }
  // ElevenLabs (if you added a key) and Kokoro first (the natural ones), then the older Piper voices
  async status() {
    const kokoro = this.kokoro.available() ? KOKORO_VOICES.map(([id, name, desc, accent]) => ({ id: "kokoro:" + id, name, desc: desc + " · on this PC", accent, natural: true })) : [];
    let eleven = [], elevenError = ""; try { eleven = await this.eleven.voices(); } catch (e) { elevenError = e.message; }
    return { state: "ready", eleven: this.eleven.has(), elevenError, voices: [...eleven, ...kokoro, ...this.voices().map(({ file, ...v }) => ({ ...v, name: v.name + " (classic)", desc: v.desc + " · older, flatter voice" }))], error: "" };
  }

  // one Piper process per voice + speed; each line in gives one wav out (its path on stdout)
  ensure(voiceId, rate) {
    const v = this.voices().find(x => x.id === voiceId) || this.voices()[0]; if (!v || !this.exe()) throw new Error("Skyline's voice isn't available");
    const key = v.id + "|" + rate.toFixed(2);
    if (this.proc && this.key === key) return;
    this.kill();
    const p = spawn(this.exe(), ["--model", v.file, "--output_dir", this.outDir, "--length_scale", (1 / rate).toFixed(3), "--sentence_silence", "0.08", "--noise_scale", "0.72", "--noise_w", "0.85"],
      { cwd: this.dir, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = p; this.key = key; this.rate = JSON.parse(fs.readFileSync(v.file + ".json", "utf8")).audio.sample_rate || 22050;
    p.stdin.on("error", () => {}); p.stderr.on("data", () => {});
    readline.createInterface({ input: p.stdout }).on("line", line => { const w = this.waiting.shift(); if (w) w.done(line.trim()); });
    p.on("exit", () => { if (this.proc === p) { this.proc = null; this.key = ""; } for (const w of this.waiting.splice(0)) w.fail(new Error("The voice stopped")); });
    p.on("error", e => { this.err = e.message; });
  }
  kill() { if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch (e) {} } this.proc = null; this.key = ""; }
  async say(text, voiceId, speed) {
    text = String(text || "").replace(/[\r\n]+/g, " ").trim().slice(0, 600); if (!text) throw new Error("Nothing to say");
    const rate = Math.min(1.8, Math.max(.6, +speed || 1));
    if (/^eleven:/.test(voiceId || "")) {
      // the slider's 1.3 is "normal"; ElevenLabs voices sound best near their own pace
      try { return { mp3: await this.eleven.speak(text, voiceId.slice(7), 1 + (rate - 1.3) * .6) }; }
      catch (e) { console.log("[voice] ElevenLabs:", e.message); voiceId = "kokoro:" + KOKORO_DEFAULT; }   // out of characters or offline: Kokoro instead
    }
    if (/^edge:/.test(voiceId || "")) voiceId = "kokoro:" + (/en-GB/.test(voiceId) ? "bf_emma" : KOKORO_DEFAULT);   // Microsoft closed the Edge voices to apps
    if (/^kokoro:/.test(voiceId || "") && this.kokoro.available()) {
      // the speed slider was made for Piper (1.3 = normal there)
      try { return await this.kokoro.speak(text, voiceId.slice(7), 1 + (rate - 1.3) * .8); }
      catch (e) { console.log("[voice] Kokoro:", e.message); if (!this.exe()) throw e; voiceId = (this.voices().find(v => /jenny/.test(v.id)) || this.voices()[0] || {}).id; }
    }
    if (/^kokoro:/.test(voiceId || "")) voiceId = (this.voices().find(v => /jenny/.test(v.id)) || this.voices()[0] || {}).id;
    this.ensure(voiceId, rate);
    const file = await new Promise((done, fail) => {
      const t = setTimeout(() => fail(new Error("The voice took too long")), 15000);
      this.waiting.push({ done: f => { clearTimeout(t); done(f); }, fail: e => { clearTimeout(t); fail(e); } });
      this.proc.stdin.write(text + "\n");
    });
    const buf = fs.readFileSync(file); fs.unlink(file, () => {});
    return { rate: buf.readUInt32LE(24) || this.rate, pcm: wavToFloat(buf) };
  }
  install() {
    const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
    h("tts:status", () => this.status());
    h("tts:prepare", voice => { if (!/^eleven:/.test(voice || "")) this.kokoro.load().catch(() => {}); return true; });
    h("tts:elevenKey", async k => { await this.eleven.setKey(k); return this.status(); });
    h("tts:elevenClear", () => { this.eleven.clearKey(); return this.status(); });
    h("tts:load", () => { this.kokoro.load().catch(() => {}); return this.status(); });
    h("tts:say", (text, voice, speed) => this.say(text, voice, speed));
    h("tts:remove", () => this.status());
  }
  stop() { this.kill(); }
}
const cap = s => String(s || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
// 16-bit PCM WAV -> Float32 samples
function wavToFloat(buf) {
  let off = 12, data = null;
  while (off + 8 <= buf.length) { const id = buf.toString("ascii", off, off + 4), size = buf.readUInt32LE(off + 4); if (id === "data") { data = buf.subarray(off + 8, off + 8 + size); break; } off += 8 + size + (size & 1); }
  if (!data) data = buf.subarray(44);
  const n = data.length >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return out;
}

module.exports = { Voice };
