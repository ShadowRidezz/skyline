// Themes: the built-in looks, your own themes, the active one, and applying a theme to the page.
// Built-ins never change; edits are a live "draft" until saved as one of your own themes.
import { Scene } from "./scene/scene.js";
import { sky, store, clamp, toHsl, fromHsl, lum, mixHex, rgba, onAccent } from "./util.js";

const FX = (fx) => ({ glow: 0, particles: 0, particleSpeed: 30, comets: 0, cometSpeed: 45, haze: 0, blur: 30, speed: 45, music: 60,
  bgOpacity: 100, stars: 0, rain: 0, snow: 0, lightning: 0, droplets: 0, neon: 0, reflections: 0, sun: 0, moon: 0, beams: 0, traffic: 0,
  bright: 100, grade: 45, sparkle: 55, drift: 50, ...fx });
// Real photos of cities at night that come alive: their own lights twinkle and pulse with your music.
const BLUE = { bg: "#03060e", skyTop: "#071a38", skyMid: "#13407e", skyLow: "#3f86d6", city: "#06101e", window: "#bfe3ff", accent: "#60a5fa", accent2: "#60a5fa" };
const PHOTO = (id, name, src, desc, credit, focus, colors = {}, fx = {}) => ({ id, name, scene: "photo", desc, photo: { src, focus, credit },
  colors: { ...BLUE, ...colors }, fx: FX({ glow: 45, particles: 8, particleSpeed: 25, comets: 18, cometSpeed: 45, blur: 0, speed: 45, music: 65, ...fx }), ui: { panel: 70, glass: 20 } });
export const PHOTOS = [
  PHOTO("p-view", "The View", "sky://app/img/photos/your-view.jpg", "Your picture: a blue city far below, through the window", "Your photo", [.5, .28], {}, { grade: 30, bright: 112, droplets: 0, sparkle: 70 }),
  PHOTO("p-kanda", "Kanda Night", "sky://app/img/photos/kanda.jpg", "Tokyo from high above: a river cutting through a sea of lit towers", "Benlisquare · CC BY-SA 4.0", [.5, .55], {}, { grade: 62, bright: 122, sparkle: 70 }),
  PHOTO("p-akiba", "Akihabara Overhead", "sky://app/img/photos/akiba.jpg", "Looking down on Akihabara at night, rails and rooftops glowing", "Benlisquare · CC BY-SA 4.0", [.5, .55], {}, { grade: 60, bright: 108, sparkle: 65 }),
  PHOTO("p-kiyosu", "Midnight Avenue", "sky://app/img/photos/kiyosu.jpg", "A Tokyo avenue running into the dark between the towers", "Benlisquare · CC BY-SA 4.0", [.5, .5], {}, { grade: 62, bright: 124, sparkle: 65 }),
  PHOTO("p-umeda", "Behind the Glass", "sky://app/img/photos/umeda.jpg", "Osaka's towers through the glass of the Umeda Sky Building", "掬茶 · CC BY-SA 4.0", [.5, .5], {}, { grade: 45, sparkle: 55 }),
  PHOTO("p-osaka", "Osaka Blue Hour", "sky://app/img/photos/osaka.jpg", "Blue hour over Osaka from 170 m up, the river curling away", "掬茶 · CC BY-SA 4.0", [.5, .6], {}, { grade: 40, sparkle: 60 }),
  PHOTO("p-shinjuku", "Shinjuku Deck", "sky://app/img/photos/shinjuku.jpg", "Night from the Tokyo Metropolitan Government tower", "Joe Mabel · CC BY-SA 3.0", [.5, .55], {}, { grade: 58, bright: 110, sparkle: 65 }),
  PHOTO("p-seoul", "Seoul From the Top", "sky://app/img/photos/seoul.jpg", "Seoul at night from Lotte World Tower, 500 m up", "Christophe95 · CC BY-SA 4.0", [.5, .55], {}, { grade: 60, bright: 120, sparkle: 70 }),
  PHOTO("p-tokyoair", "Tokyo Night Flight", "sky://app/img/photos/tokyoair.jpg", "Tokyo from the air at night, lights to the edge of the world", "Raita Futo · CC BY 2.0", [.5, .5], {}, { grade: 55, bright: 122, comets: 30, sparkle: 70 }),
];

export const BUILTIN = [
  { id: "minimal", name: "Minimal", scene: "minimal", desc: "Clean black and grey, almost no motion",
    colors: { bg: "#0a0a0b", skyTop: "#0b0b0c", skyMid: "#0e0e10", skyLow: "#141417", city: "#111113", window: "#e5e7eb", accent: "#e4e4e7", accent2: "#a1a1aa" },
    fx: FX({ music: 0 }), ui: { panel: 96, glass: 0 } },
];
BUILTIN.push(...PHOTOS);
BUILTIN.forEach(t => { t.builtin = true; });
const DEFAULT = "p-kanda";
const DRAWN = new Set(["nyc", "tokyo", "space", "rainy", "sunset", "aurora", "snow", "synth"]);   // the old painted themes, now gone
const SCENES = new Set(["photo", "minimal"]);
export const IMAGE_DEFAULTS = { url: "", blur: 4, brightness: 75, contrast: 100, opacity: 100, overlay: "#0a0614", overlayAmt: 30, fx: true };
const clone = o => JSON.parse(JSON.stringify(o));
const mq = matchMedia("(prefers-reduced-motion: reduce)");

function normTheme(t) {
  const base = BUILTIN.find(b => b.id === t.base) || BUILTIN.find(b => b.scene === t.scene) || BUILTIN.find(b => b.id === DEFAULT);
  const o = { ...clone(base), ...clone(t) };
  o.colors = { ...base.colors, ...(t.colors || {}) }; o.fx = { ...base.fx, ...(t.fx || {}) }; o.ui = { ...base.ui, ...(t.ui || {}) };
  o.image = t.image && t.image.url ? { ...IMAGE_DEFAULTS, ...t.image } : null;
  o.builtin = BUILTIN.some(b => b.id === o.id);
  delete o.landmarks; delete o.city;
  return o;
}
function normDoc(d) {
  d = d && typeof d === "object" ? d : {};
  const fix = id => !id || DRAWN.has(id) ? DEFAULT : id;   // someone on an old painted theme moves to a real photo
  return { active: fix(d.active), reduce: typeof d.reduce === "boolean" ? d.reduce : null, albumTint: d.albumTint !== false,
    liveWeather: d.liveWeather !== false, fps: [24, 30, 60].includes(d.fps) ? d.fps : 30,
    cityTour: !!d.cityTour, rainy: !!d.rainy, holidays: d.holidays !== false,
    schedule: Object.fromEntries(Object.entries({ on: false, morning: "p-osaka", afternoon: "p-umeda", evening: "p-shinjuku", night: DEFAULT, ...(d.schedule || {}) }).map(([k, v]) => [k, k === "on" ? v : fix(v)])),
    // your own themes stay, unless they were built on a painted scene (those don't exist any more); a picture you added stays either way
    custom: (Array.isArray(d.custom) ? d.custom : []).filter(t => t && t.id && t.name && (SCENES.has(t.scene) || (t.image && t.image.url))).map(normTheme) };
}

/* ---------- turning a theme into the page's colours ---------- */
export function cssVars(t) {
  const [h, s0, l0] = toHsl(t.colors.bg), s = Math.min(s0, .42), l = Math.min(l0, .1);
  const P = clamp(t.ui.panel, 85, 100) / 100, tone = dl => fromHsl(h, s, clamp(l + dl, 0, .3));   // (cards stay readable over any photo)
  const a1 = t.colors.accent, a2 = t.colors.accent2 || a1, [ah, as, al] = toHsl(a1);
  return {
    "--bg": fromHsl(h, s, l), "--bg2": rgba(tone(.02), Math.min(1, P + .08)),
    "--panel": rgba(tone(.045), P), "--panel2": rgba(tone(.075), Math.min(1, P + .1)), "--panel3": rgba(tone(.11), Math.min(1, P + .14)),
    "--side": rgba(tone(.02), Math.min(1, P + .04)), "--sheet": rgba(tone(.028), .97),
    "--a1": a1, "--a2": a2, "--grad": a1,
    "--a-soft": fromHsl(ah, Math.min(1, as), Math.max(al, .8)),
    "--on-a": onAccent(a1),
    "--glass": `${clamp(t.ui.glass, 0, 40)}px`, "--win": t.colors.window,
  };
}

export const Themes = {
  doc: normDoc(store.cached("themes")), draft: null, dirty: false, weather: null, subs: new Set(),
  BUILTIN, IMAGE_DEFAULTS, clone, normTheme,
  all() { return [...BUILTIN, ...this.doc.custom]; },
  find(id) { return this.all().find(t => t.id === id); },
  reduceOn() { return this.doc.reduce == null ? mq.matches : this.doc.reduce; },
  sceneOf(t) { return t.image ? "image" : t.scene; },
  credit(t) { return t && t.scene === "photo" && t.photo ? t.photo.credit || "" : ""; },
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  emit(what) { for (const f of this.subs) f(what); },

  apply(t) {
    const vars = cssVars(t), root = document.documentElement.style;
    for (const k in vars) root.setProperty(k, vars[k]);
    const b = document.body.dataset, sc = this.sceneOf(t);
    b.scene = sc; b.rain = Math.max(t.fx.rain, this.weatherFx().rain || 0) > 15 ? "1" : "0"; b.snow = Math.max(t.fx.snow || 0, this.weatherFx().snow || 0) > 15 ? "1" : "0";
    b.comets = t.fx.comets > 0 && sc !== "minimal" ? "1" : "0";
    document.body.classList.toggle("glassy", t.ui.glass > 0 && t.ui.panel < 100);
    document.body.classList.toggle("still", this.reduceOn());
    const img = document.getElementById("sceneImg"), ov = document.getElementById("sceneOv");
    if (t.image) {
      const i = t.image;
      img.style.backgroundImage = `url("${i.url}")`;
      img.style.filter = `blur(${i.blur}px) brightness(${i.brightness}%) contrast(${i.contrast}%)`;
      img.style.opacity = i.opacity / 100;
      ov.style.background = i.overlay; ov.style.opacity = i.overlayAmt / 100;
    } else img.style.backgroundImage = "";
    Scene.apply(t, { reduce: this.reduceOn(), weather: this.weatherFx(), fps: this.doc.fps });
    store.local("vars", vars);
    this.emit("apply");
  },
  applySoon(t, structural) {   // sliders fire constantly: rebuilding the skyline waits for a short pause
    this.q = t; clearTimeout(this.qt);
    this.qt = setTimeout(() => this.apply(this.q), structural ? 90 : 16);
  },

  weatherFx() {  // real weather outside can come into the scene, plus rainy nights and December snow
    const w = this.doc.liveWeather && this.weather || {}, d = new Date();
    const fx = { rain: w.rain ? 60 : 0, snow: w.snow ? 65 : 0, lightning: w.storm ? 55 : 0, haze: w.fog ? 30 : 0 };
    if (this.doc.rainy) fx.rain = Math.max(fx.rain, 58);   // "Tokyo rain": rain on every city
    if (this.doc.holidays && d.getMonth() === 11) fx.snow = Math.max(fx.snow, 42);   // December: snow
    return fx;
  },
  // New Year's Eve (from 8 pm) and New Year's Day: fireworks over the city
  newYear() { const d = new Date(); return this.doc.holidays && ((d.getMonth() === 11 && d.getDate() === 31 && d.getHours() >= 20) || (d.getMonth() === 0 && d.getDate() === 1)); },
  fireworksTick() {
    if (!this.newYear() || document.hidden || document.body.classList.contains("staging") || this.reduceOn()) return;
    Scene.firework(innerWidth * (.15 + Math.random() * .7), innerHeight * (.12 + Math.random() * .3));
  },
  setWeather(w) {
    const before = JSON.stringify(this.weatherFx());
    this.weather = w;
    if (JSON.stringify(this.weatherFx()) !== before && this.draft) this.apply(this.draft);
  },

  async select(id, { quiet = false, ask = null } = {}) {
    const t = this.find(id) || this.find(DEFAULT);
    if (this.dirty && !quiet && ask && !(await ask())) return false;
    this.draft = clone(t); this.dirty = false; this.doc.active = t.id;
    this.apply(this.draft);
    this.emit("select");
    return true;
  },
  edit() { this.dirty = true; this.emit("dirty"); },

  persist() {
    const out = { active: this.doc.active, reduce: this.doc.reduce, albumTint: this.doc.albumTint, liveWeather: this.doc.liveWeather, fps: this.doc.fps, cityTour: this.doc.cityTour, rainy: this.doc.rainy, holidays: this.doc.holidays,
      schedule: this.doc.schedule, custom: this.doc.custom.map(t => { const c = clone(t); delete c.builtin; return c; }) };
    store.write("themes", out);
    this.trayList();
  },
  trayList() {
    if (sky) sky.tray.themes(this.all().map(t => ({ id: t.id, name: t.name, active: t.id === this.doc.active }))).catch(() => {});
  },

  scheduleTick() {  // automatic themes by time of day
    const fx = JSON.stringify(this.weatherFx()); if (this.lastFx && fx !== this.lastFx && this.draft && !this.dirty) this.apply(this.draft); this.lastFx = fx;   // December starts, etc.
    if (this.doc.cityTour && !this.dirty) {   // city tour: a different city every hour, the same one at the same hour each day
      const id = PHOTOS[new Date().getHours() % PHOTOS.length].id;
      if (id !== this.doc.active && this.find(id)) { this.select(id, { quiet: true }); this.persist(); }
      return;
    }
    const s = this.doc.schedule; if (!s.on || this.dirty) return;
    const h = new Date().getHours(), part = h >= 6 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 21 ? "evening" : "night";
    const id = s[part];
    if (id && this.find(id) && id !== this.doc.active) { this.select(id, { quiet: true }); this.persist(); }
  },

  async start() {
    await this.select(this.find(this.doc.active) ? this.doc.active : DEFAULT, { quiet: true });
    const server = await store.read("themes");
    if (server) {
      const before = JSON.stringify([this.doc.active, this.doc.custom, this.doc.reduce]);
      this.doc = normDoc(server);
      if (JSON.stringify([this.doc.active, this.doc.custom, this.doc.reduce]) !== before) await this.select(this.find(this.doc.active) ? this.doc.active : DEFAULT, { quiet: true });
    }
    this.trayList();
    this.scheduleTick(); setInterval(() => this.scheduleTick(), 60e3);
    setInterval(() => this.fireworksTick(), 2600);
    mq.addEventListener("change", () => { if (this.doc.reduce == null) this.apply(this.draft); });
  },
};
