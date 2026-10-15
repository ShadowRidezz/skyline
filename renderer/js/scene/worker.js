// Draws the live background off the main thread, so scrolling and typing never stutter it.
import { Renderer, rgb } from "./engine.js";

let r = null, theme = null, weather = null, size = [2, 2], reduce = false, paused = false, fps = 30, raf = 0, last = 0;
let prev = null, fade = 0, timer = 0;   // the previous theme, fading out over the new one

function animated() {
  if (!r) return false;
  return r.scene !== "minimal" && !(r.scene === "image" && !(theme.image && theme.image.fx));
}

function kick(redraw) {
  cancelAnimationFrame(raf); clearTimeout(timer); raf = 0;
  if (!r) return;
  if (redraw) r.frame(0);
  if (reduce || paused || !animated()) return;
  last = performance.now();
  const loop = now => {   // wake only `fps` times a second (a timer, then one frame), not at the monitor's rate
    const el = now - last, target = 1000 / fps;
    timer = setTimeout(() => { raf = requestAnimationFrame(loop); }, Math.max(0, target - 6));
    last = now;
    const dt = Math.min(el / 1000, .1);
    r.frame(dt);
    if (fade > 0 && prev) { r.g.globalAlpha = Math.pow(fade, 1.3); r.g.drawImage(prev, 0, 0, r.W, r.H); r.g.globalAlpha = 1; fade -= dt / 1.1; if (fade <= 0) prev = null; }
  };
  raf = requestAnimationFrame(loop);
}

onmessage = ({ data: m }) => {
  switch (m.type) {
    case "init":
      r = new Renderer(m.canvas);
      r.onReady = () => { if (theme) { r.setTheme(theme, size[0], size[1], weather); kick(true); } };   // a photo finished loading
      break;
    case "theme":
      theme = m.theme; weather = m.weather || null; size = m.size || size; reduce = !!m.reduce; fps = m.fps || fps;
      r.still = reduce;
      if (m.rebuild) r.key = "";
      if (m.fade && r.W && !reduce && !paused) {   // keep a picture of the old theme to crossfade from
        prev = new OffscreenCanvas(r.W, r.H); prev.getContext("2d").drawImage(r.cv, 0, 0); fade = 1;
      }
      r.setTheme(theme, size[0], size[1], weather);
      kick(true);
      break;
    case "audio":
      if (r) r.setAudio(m.audio);
      break;
    case "tint":
      if (r) r.tintTarget = m.hex ? rgb(m.hex) : null;
      break;
    case "mouse":
      if (r) r.setMouse(m.x, m.y);
      break;
    case "comet":
      if (r && !reduce) { r.spawnCometAt(m.x * r.W, m.y * r.H); if (!raf) kick(false); }
      break;
    case "firework":
      if (r && !reduce) { r.launch(m.x * r.W, m.y * r.H); if (!raf) kick(false); }
      break;
    case "intro":
      if (r && !reduce) r.intro = 1;
      break;
    case "pause":
      if (paused !== !!m.on) { paused = !!m.on; kick(!paused); }
      break;
  }
};
