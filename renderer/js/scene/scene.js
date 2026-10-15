// Controls the live background (drawn in a worker) and makes theme previews on this thread.
import { Renderer, canvas } from "./engine.js";
import { fpsLoop } from "../util.js";

export const Scene = {
  worker: null, el: null, theme: null, opts: { reduce: false, weather: null, fps: 30 }, paused: new Set(),

  init(cv) {
    this.el = cv;
    const off = cv.transferControlToOffscreen();
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.worker.postMessage({ type: "init", canvas: off }, [off]);
    addEventListener("resize", () => { clearTimeout(this.rt); this.rt = setTimeout(() => this.push(), 160); });
    document.addEventListener("visibilitychange", () => this.pause("hidden", document.hidden));
    if (document.hidden) this.paused.add("hidden");
  },

  size() {  // real screen pixels (sharp on scaled displays), but a soft background doesn't need every pixel of 4K
    const d = Math.min(devicePixelRatio || 1, 2), w = innerWidth * d, h = innerHeight * d, k = Math.min(1, 2560 / w, 1440 / h);
    return [Math.round(w * k), Math.round(h * k)];
  },

  apply(theme, opts = {}) {
    const fade = !!(this.theme && theme && (this.theme.id !== theme.id || opts.fade));
    this.theme = theme; Object.assign(this.opts, opts); this.fadeNext = fade;
    this.el.style.opacity = Math.min(1, Math.max(0, (theme.fx?.bgOpacity ?? 100) / 100));
    this.el.style.visibility = theme.image && !theme.image.fx ? "hidden" : "";
    this.push();
  },

  push(rebuild) {
    if (!this.worker || !this.theme) return;
    this.worker.postMessage({ type: "theme", theme: this.theme, size: this.size(), weather: this.opts.weather, reduce: this.opts.reduce,
      fps: this.opts.fps, rebuild: !!rebuild, fade: !!this.fadeNext }); this.fadeNext = false;
    this.worker.postMessage({ type: "pause", on: this.paused.size > 0 });
  },

  pause(reason, on) {
    const before = this.paused.size > 0;
    if (on) this.paused.add(reason); else this.paused.delete(reason);
    if (!this.worker) return;
    // back from hidden/minimised: repaint the layers (a GPU canvas can lose them while hidden)
    if (reason === "hidden" && !on) return this.push(true);
    if (before !== this.paused.size > 0) this.worker.postMessage({ type: "pause", on: this.paused.size > 0 });
  },

  comet(x, y) { if (this.worker) this.worker.postMessage({ type: "comet", x: x / innerWidth, y: y / innerHeight }); },
  firework(x, y) { if (this.worker) this.worker.postMessage({ type: "firework", x: x / innerWidth, y: y / innerHeight }); },
  intro() { if (this.worker) this.worker.postMessage({ type: "intro" }); },
  audio(a) { if (this.worker) this.worker.postMessage({ type: "audio", audio: a }); },
  setTint(hex) { if (this.worker) this.worker.postMessage({ type: "tint", hex }); },

  thumb(theme, w, h) {  // a still preview for the theme gallery
    const cv = canvas(w, h), r = new Renderer(cv, { still: true, small: true });
    r.setTheme(theme, w, h);
    if (r.f("comets") > 0 && r.scene !== "image" && r.scene !== "minimal") {
      for (let i = 0; i < 2; i++) { r.spawnComet(); const c = r.comets[i]; c.age = 1; c.x += c.vx * (.6 + i * .5); c.y += c.vy * (.6 + i * .5) + h * .05; }
    }
    r.frame(.016);
    return cv;
  },

  preview(target, theme) {  // a small live preview (theme card hover): returns stop()
    const r = new Renderer(target, { small: true });
    r.setTheme(theme, target.width, target.height);
    let last = performance.now();
    return fpsLoop(25, now => { r.frame(Math.min((now - last) / 1000, .1)); last = now; });
  },
};
