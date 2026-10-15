// The mini player: a small always-on-top window with the song, its cover and the controls.
import { $, $$, sky, clamp, palette, fpsLoop } from "./util.js";

const PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`;
const PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`;
let meta = { on: false }, got = 0, level = 0, raf = 0;

function setMeta(m) {
  const prevArt = meta.art; meta = m; got = Date.now();
  document.body.classList.toggle("on", !!m.on);
  $("[data-np-title]").textContent = m.on ? m.title : "Nothing playing";
  $("[data-np-artist]").textContent = m.on ? (m.artist || m.album || "") : "Play some music to see it here";
  $("[data-np-app]").textContent = m.on ? (m.playing ? "Now playing" : "Paused") : "Skyline";
  $("[data-np-play]").innerHTML = m.playing ? PAUSE : PLAY;
  if ((m.art || "") !== (prevArt || "")) {
    const img = $("img[data-np-art]");
    if (m.art) { img.onload = () => { img.classList.add("on"); const p = palette(img); const r = document.documentElement.style;
      if (p) { r.setProperty("--np-color", p[0]); r.setProperty("--np-color2", p[1]); } }; img.src = m.art; }
    else { img.classList.remove("on"); img.removeAttribute("src"); }
    $("[data-np-backdrop]").style.backgroundImage = m.art ? `url("${m.art}")` : "";
  }
  sky.media.want("meter", !!m.playing);
  loop();
}
function progress() {
  if (!meta.on || !(meta.dur > 1)) { $("#fill").style.transform = "scaleX(0)"; return; }
  const since = meta.playing ? (Date.now() - (meta.at > 0 ? Math.min(meta.at, Date.now()) : got)) / 1000 : 0;
  $("#fill").style.transform = `scaleX(${clamp((meta.pos + since) / meta.dur, 0, 1)})`;
}
function loop() {
  if (raf) raf(); raf = 0;
  const cv = $("#viz"), dpr = devicePixelRatio || 1, w = 46, h = 18; cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let lv = 0;
  const frame = now => {
    if (!(meta.playing && !document.hidden)) { if (raf) raf(); raf = 0; }
    lv += (level - lv) * .35;
    g.clearRect(0, 0, w, h); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--np-color") || "#8b5cf6";
    for (let i = 0; i < 6; i++) { const v = meta.playing ? clamp(lv * (.35 + .65 * Math.abs(Math.sin(now / 1000 * (1.8 + i * .6) + i))), .12, 1) : .12;
      g.beginPath(); g.roundRect(i * 8, h - v * h, 4, v * h, 2); g.fill(); }
  };
  raf = fpsLoop(30, frame);
}

document.addEventListener("click", e => { const b = e.target.closest("[data-np]"); if (b) sky.media.cmd(b.dataset.np); });
const close = () => { sky.mini.toggle(false).catch(() => window.close()); setTimeout(() => window.close(), 400); };   // and close the window itself, in case the message is lost
$("#close").onclick = close;
document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
$("#open").onclick = () => sky.win.show();
sky.media.onMeta(setMeta);
sky.media.onLevel(d => level = d.level);
document.addEventListener("visibilitychange", loop);
setInterval(progress, 500);
sky.media.state().then(s => setMeta(s.meta || { on: false }));
