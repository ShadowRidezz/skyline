// Settings › Interface: how Skyline itself looks and moves (separate from the background themes).
import { $, $$, sky, toast, dialog, setSeg, toHsl, fromHsl, lum, mixHex } from "./util.js";
import { Settings } from "./widgets.js";
import { Themes } from "./themes.js";
import { FX } from "./fx.js";

export const UI_DEFAULTS = {
  motion: "full", intro: true, clockRoll: true, tilt: true,
  font: "modern", radius: 20, scale: 100, glass: "frosted", railLabels: false,
  accent: "theme", accentColor: "#8b5cf6",
  layout: "classic", player: "card",
  cursorGlow: true, trail: false, skyClicks: true, sounds: false, soundVol: 40,
};
const FONTS = {
  modern: ['"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif', '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'],
  tech: ['Bahnschrift, "Segoe UI", sans-serif', 'Bahnschrift, "Segoe UI", sans-serif'],
  mono: ['"Cascadia Code", "Cascadia Mono", Consolas, monospace', '"Cascadia Code", Consolas, monospace'],
  elegant: ['"Segoe UI Variable Text", "Segoe UI", sans-serif', '"Sitka Display", Georgia, "Times New Roman", serif'],
  rounded: ['"Segoe UI Variable Small", "Segoe UI", sans-serif', '"Segoe Print", "Segoe UI Variable Display", sans-serif'],
};
export const P = () => { const d = Settings.data; d.ui = { ...UI_DEFAULTS, ...(d.ui || {}) }; return d.ui; };
let albumColors = null;

export function applyAccent() {
  const p = P(), r = document.documentElement.style;
  let a1 = null, a2 = null;
  if (p.accent === "album" && albumColors) [a1, a2] = albumColors;
  if (p.accent === "custom") { a1 = p.accentColor; const [h, s, l] = toHsl(a1); a2 = fromHsl(h + .12, Math.max(s, .5), Math.min(Math.max(l, .45), .65)); }
  if (!a1) return;   // the theme's own accent stays
  const [ah, as, al] = toHsl(a1);
  r.setProperty("--a1", a1); r.setProperty("--a2", a2); r.setProperty("--grad", `linear-gradient(135deg, ${a1}, ${a2})`);
  r.setProperty("--a-soft", fromHsl(ah, Math.min(1, as), Math.max(al, .8)));
  r.setProperty("--on-a", lum(mixHex(a1, a2, .5)) > .42 ? "#0b0b10" : "#ffffff");
}

export function apply() {
  const p = P(), b = document.body.dataset, r = document.documentElement.style;
  b.font = p.font; b.glass = p.glass; b.layout = p.layout; b.player = p.player;
  document.body.classList.toggle("rail-labels", !!p.railLabels);
  const f = FONTS[p.font] || FONTS.modern; r.setProperty("--font", f[0]); r.setProperty("--display", f[1]);
  r.setProperty("--r", p.radius + "px"); r.setProperty("--r-sm", Math.round(p.radius * .5) + "px");
  if (sky && sky.win.zoom) sky.win.zoom(p.scale / 100);
  applyAccent();
  FX.apply();
}

export const Interface = {
  init() {
    apply();
    if (!this.hooked) { this.hooked = true; Themes.on(w => { if (w === "apply") applyAccent(); }); document.addEventListener("sky:album", e => Interface.setAlbum(e.detail)); }
  },
  setAlbum(colors) { albumColors = colors; if (P().accent === "album") { if (colors) applyAccent(); else Themes.apply(Themes.draft); } },
  render() {
    const p = P(), box = $("#uiSet"); if (!box) return;
    if (!box.dataset.built) build(box);
    $$("#uiSet [data-ui]").forEach(el => { const k = el.dataset.ui, v = p[k];
      if (el.classList.contains("seg")) setSeg(el, v); else if (el.type === "checkbox") el.checked = !!v; else el.value = v; });
    $$("#uiSet .rg").forEach(i => i.style.setProperty("--v", ((i.value - i.min) / (i.max - i.min) * 100) + "%"));
    $("#uiAccentColor").closest(".swatch").classList.toggle("hidden", p.accent !== "custom");
    $("#uiScaleV").textContent = p.scale + "%"; $("#uiRadiusV").textContent = p.radius + "px"; $("#uiVolV").textContent = p.soundVol + "%";
  },
};

function build(box) {
  box.dataset.built = "1";
  const seg = (k, opts) => `<div class="seg" data-ui="${k}">${opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join("")}</div>`;
  const tog = (k, title, sub) => `<label class="toggle"><input type="checkbox" data-ui="${k}"><span class="sw"></span><span class="t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span></label>`;
  box.innerHTML = `
    <div class="glass sbox"><h3>✨ Motion</h3>
      <div class="field">Animations${seg("motion", [["off", "Off"], ["subtle", "Subtle"], ["full", "Full"]])}</div>
      ${tog("intro", "Startup animation", "The city switches its lights on when Skyline opens")}
      ${tog("clockRoll", "Rolling clock digits", "Numbers slide into place as time passes")}
      ${tog("tilt", "3D tilt", "Cards and covers lean toward your cursor")}
    </div>
    <div class="glass sbox"><h3>🎨 Look</h3>
      <div class="field">Font${seg("font", [["modern", "Modern"], ["tech", "Tech"], ["mono", "Mono"], ["elegant", "Elegant"], ["rounded", "Playful"]])}</div>
      <label class="sl"><span>Roundness</span><input type="range" class="rg" min="0" max="32" data-ui="radius"><output id="uiRadiusV"></output></label>
      <label class="sl"><span>Interface size</span><input type="range" class="rg" min="80" max="130" step="5" data-ui="scale"><output id="uiScaleV"></output></label>
      <div class="field">Glass${seg("glass", [["clear", "Clear"], ["frosted", "Frosted"], ["solid", "Solid"]])}</div>
      ${tog("railLabels", "Labels in the side bar", "Show names next to the icons")}
    </div>
    <div class="glass sbox"><h3>🌈 Accent colour</h3>
      <div class="field">Where the accent comes from${seg("accent", [["theme", "Theme"], ["album", "Album art"], ["custom", "Custom"]])}</div>
      <label class="swatch inline"><input type="color" id="uiAccentColor" data-ui="accentColor"><span>Your colour</span></label>
      <p class="muted">“Album art” recolours buttons, sliders and glows to match whatever you're listening to.</p>
    </div>
    <div class="glass sbox"><h3>🏙️ Home</h3>
      <div class="field">Layout${seg("layout", [["classic", "Classic"], ["centered", "Centered"], ["focus", "Focus"]])}</div>
      <div class="field">Music player${seg("player", [["card", "Card"], ["vinyl", "Vinyl"], ["compact", "Compact"]])}</div>
      <p class="muted">Focus keeps just the time and your music. Vinyl spins a record behind the cover while music plays.</p>
    </div>
    <div class="glass sbox"><h3>🌠 Effects</h3>
      ${tog("cursorGlow", "Cursor glow", "A soft light follows your mouse")}
      ${tog("trail", "Sparkle trail", "Stardust behind your cursor")}
      ${tog("skyClicks", "Interactive sky", "Click the background for a shooting star, double-click for fireworks")}
    </div>
    <div class="glass sbox"><h3>🔊 Sounds</h3>
      ${tog("sounds", "Interface sounds", "Soft clicks and chimes, made on the spot")}
      <label class="sl"><span>Volume</span><input type="range" class="rg" min="0" max="100" data-ui="soundVol"><output id="uiVolV"></output></label>
      <div class="row"><button class="btn sm" id="uiTest">Try them</button><button class="btn sm ghost danger" id="uiReset">Reset interface</button></div>
    </div>`;
  const set = (k, v) => { P()[k] = v; Settings.save(); apply(); Interface.render(); };
  box.addEventListener("click", e => { const b = e.target.closest(".seg[data-ui] button"); if (!b) return; set(b.parentElement.dataset.ui, b.dataset.v); FX.sound("toggle"); });
  box.addEventListener("input", e => { const k = e.target.dataset.ui; if (!k || e.target.closest(".seg")) return;
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.type === "range" ? +e.target.value : e.target.value;
    if (k === "scale") { P().scale = v; $("#uiScaleV").textContent = v + "%"; e.target.style.setProperty("--v", ((v - 80) / 50 * 100) + "%"); return; }
    set(k, v); });
  box.addEventListener("change", e => { if (e.target.dataset.ui === "scale") set("scale", +e.target.value); });
  $("#uiTest").onclick = () => { const was = P().sounds; P().sounds = true; ["click", "page", "success"].forEach((k, i) => setTimeout(() => FX.sound(k), i * 450)); setTimeout(() => P().sounds = was, 1500); };
  $("#uiReset").onclick = async () => { if (await dialog({ title: "Reset the interface?", text: "Motion, look, accent, layout and effects go back to how Skyline started. Your themes stay.", ok: "Reset" })) {
    Settings.data.ui = { ...UI_DEFAULTS }; Settings.save(); apply(); Themes.apply(Themes.draft); Interface.render(); toast("Interface reset"); } };
}
