// Sky's voice: Kokoro, a natural, expressive neural voice that runs on this PC (free, unlimited, works offline).
// The model (Kokoro-82M, ~90 MB) ships with Skyline; it's loaded once and kept ready, and sentences are made
// one at a time so the first one is ready in under a second and the rest keep ahead of the playback.
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
// the best-sounding English voices (Kokoro's own quality grades: Heart A, Bella A-, Nicole B-, Emma B-)
const VOICES = [
  ["af_heart", "Heart", "Warm, soulful woman (the most natural)", "US"],
  ["af_bella", "Bella", "Bright, expressive woman", "US"],
  ["af_nicole", "Nicole", "Soft, calm woman (almost a whisper)", "US"],
  ["bf_emma", "Emma", "Warm British woman", "UK"],
  ["bf_isabella", "Isabella", "Smooth British woman", "UK"],
  ["af_sky", "Sky", "Light, airy woman", "US"],
  ["af_aoede", "Aoede", "Relaxed, low woman", "US"],
  ["am_michael", "Michael", "Easygoing man", "US"],
  ["am_fenrir", "Fenrir", "Deep man", "US"],
  ["bm_george", "George", "Classic British man", "UK"],
];
const DEFAULT = "af_heart";

class Kokoro {
  constructor() { this.tts = null; this.loading = null; this.queue = Promise.resolve(); this.err = ""; }
  dir() { return app.isPackaged ? path.join(process.resourcesPath, "kokoro") : path.join(__dirname, "..", "vendor", "kokoro"); }
  available() { return fs.existsSync(path.join(this.dir(), MODEL, "onnx", "model_quantized.onnx")); }
  // load the model (once); everything comes from Skyline's own files, nothing is downloaded
  load() {
    if (this.tts) return Promise.resolve(this.tts);
    if (!this.loading) this.loading = (async () => {
      const tf = require("@huggingface/transformers");
      tf.env.localModelPath = this.dir(); tf.env.allowRemoteModels = false; tf.env.allowLocalModels = true;
      const { KokoroTTS } = require("kokoro-js");
      const t = Date.now();
      this.tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "cpu" });
      await this.tts.generate("Hi.", { voice: DEFAULT });   // the first sentence is always slower: get it out of the way
      console.log("[voice] Kokoro ready in", Date.now() - t, "ms");
      return this.tts;
    })().catch(e => { this.loading = null; this.err = e.message; throw e; });
    return this.loading;
  }
  // one sentence -> { rate, pcm } (Float32 samples). Sentences are made one after another, in order.
  speak(text, voice = DEFAULT, speed = 1) {
    const v = VOICES.some(x => x[0] === voice) ? voice : DEFAULT;
    const job = this.queue.then(async () => {
      const tts = await this.load();
      const a = await tts.generate(String(text).slice(0, 500), { voice: v, speed: Math.min(1.4, Math.max(.7, speed)) });
      return { rate: a.sampling_rate, pcm: a.audio };
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

module.exports = { Kokoro, KOKORO_VOICES: VOICES, KOKORO_DEFAULT: DEFAULT };
