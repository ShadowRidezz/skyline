// Skyline's scene engine: paints the living background. It runs inside a Web Worker for the live
// background and on the main thread for theme previews. The photo is graded and baked once into
// offscreen layers; each frame only stacks those layers and draws what moves (lights, comets, rain, snow).

export const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) {  // mulberry32: the same theme always looks the same
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function rgb(h) { h = String(h || "#000").replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&");
  const n = parseInt(h.slice(0, 6), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
export function canvas(w, h) { return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))); }

const spriteCache = new Map();
function glow(c, hard) {  // a soft round light, drawn with drawImage (far cheaper than shadowBlur)
  const key = (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + (hard ? "h" : "");
  let s = spriteCache.get(key); if (s) return s;
  s = canvas(64, 64); const g = s.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, css(mix(c, WHITE, .7), 1)); gr.addColorStop(hard ? .18 : .1, css(c, hard ? .9 : .65));
  gr.addColorStop(hard ? .35 : .4, css(c, .16)); gr.addColorStop(1, css(c, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  if (spriteCache.size > 80) spriteCache.clear();
  spriteCache.set(key, s); return s;
}
function blob(g, x, y, rx, ry, c, a) {  // a soft elliptical cloud of light or haze
  if (rx <= 0 || ry <= 0) return;
  g.save(); g.translate(x, y); g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, css(c, a)); gr.addColorStop(.55, css(c, a * .45)); gr.addColorStop(1, css(c, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
}
let dropSprite = null;
function droplet() {  // a raindrop on glass: dark rim, bright refracted core, small highlight
  if (dropSprite) return dropSprite;
  const s = canvas(48, 48), g = s.getContext("2d");
  let gr = g.createRadialGradient(24, 27, 2, 24, 24, 22);
  gr.addColorStop(0, "rgba(255,255,255,.10)"); gr.addColorStop(.62, "rgba(210,225,255,.06)");
  gr.addColorStop(.86, "rgba(0,0,0,.30)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.beginPath(); g.arc(24, 24, 22, 0, TAU); g.fill();
  gr = g.createRadialGradient(17, 15, 0, 17, 15, 7); gr.addColorStop(0, "rgba(255,255,255,.75)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.beginPath(); g.arc(17, 15, 7, 0, TAU); g.fill();
  return (dropSprite = s);
}

// Photos for the photo themes: decoded once per thread and shared by every renderer.
const photoCache = new Map();   // src -> { bmp, wait: Set<fn>, failed }
export function loadPhoto(src, cb) {
  if (!src) return null;
  let p = photoCache.get(src);
  if (p) { if (!p.bmp && !p.failed && cb) p.wait.add(cb); return p; }
  p = { bmp: null, failed: false, wait: new Set(cb ? [cb] : []) };
  photoCache.set(src, p);
  p.ready = fetch(src).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); }).then(b => createImageBitmap(b))
    .then(bmp => { p.bmp = bmp; }, e => { p.failed = true; photoCache.delete(src); console.log("[photo] couldn't load", src, e.message); })
    .finally(() => { for (const f of p.wait) { try { f(); } catch (e) {} } p.wait.clear(); });
  if (photoCache.size > 6) { for (const [k, v] of photoCache) { if (k !== src && v.bmp) { v.bmp.close(); photoCache.delete(k); break; } } }
  return p;
}
export const photoReady = src => { const p = loadPhoto(src); return p ? p.ready.then(() => !!p.bmp) : Promise.resolve(false); };

export class Renderer {
  constructor(cv, opts = {}) {
    this.cv = cv; this.g = cv.getContext("2d");
    this.still = !!opts.still; this.small = !!opts.small;
    this.t = 40; this.real = 0;
    this.audio = { level: 0, bass: 0, mid: 0, high: 0, beat: 0, playing: false, tl: 0, tb: 0, tm: 0, th: 0 };
    this.tintTarget = null; this.tint = null;
    this.mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    this.comets = []; this.sparks = []; this.splashes = []; this.drops = []; this.flakes = []; this.rain = []; this.parts = [];
    this.nextComet = 2.5; this.nextBolt = 12; this.bolt = null;
    this.key = ""; this.rockets = []; this.embers = []; this.intro = 0;
  }

  setTheme(th, w, h, weather) {
    this.th = th;
    const f = { ...(th.fx || {}) }, wx = weather || {};
    for (const k of ["rain", "snow", "lightning"]) if (wx[k]) f[k] = Math.max(f[k] || 0, wx[k]);
    if (wx.haze) f.haze = Math.min(100, (f.haze || 0) + wx.haze);
    this.fxv = f;
    this.f = k => clamp((f[k] ?? 0) / 100, 0, 1);
    const key = JSON.stringify([th.scene, th.colors, th.seed || th.id, f.blur, th.image ? 1 : 0, th.photo && th.photo.src, th.photo && th.photo.focus, th.photo && th.photo.fx, th.photo && th.photo.fy, f.bright, f.grade, this.photoTick || 0, Math.round(w), Math.round(h)]);
    if (key !== this.key) { this.key = key; this.resize(w, h); }
    this.setupMoving();
  }

  resize(w, h) {
    this.W = Math.max(2, Math.round(w)); this.H = Math.max(2, Math.round(h));
    this.cv.width = this.W; this.cv.height = this.H;
    this.k = this.W / 1440;  // everything is designed for a 1440 px wide window
    const th = this.th, C = this.C = {};
    for (const k in th.colors) C[k] = rgb(th.colors[k]);
    C.accent2 = C.accent2 || C.accent;
    this.R = rng(hash(th.seed || th.id || "x"));
    this.L = {}; this.horizon = null;
    const scene = th.image ? "image" : th.scene === "photo" ? "photo" : "minimal";   // (the old drawn scenes are gone: they show as Minimal)
    this.scene = scene;
    if (scene === "photo") this.buildPhoto();
    else if (scene !== "image") this.buildMinimal();
  }

  /* ================= painted once ================= */

  skyGradient(g, stops) {
    const gr = g.createLinearGradient(0, 0, 0, this.H);
    for (const [p, c] of stops) gr.addColorStop(clamp(p, 0, 1), css(c));
    g.fillStyle = gr; g.fillRect(0, 0, this.W, this.H);
  }

  buildMinimal() {
    const { W, H, C } = this, sky = canvas(W, H), g = sky.getContext("2d");
    this.skyGradient(g, [[0, C.skyTop], [.6, C.skyMid], [1, C.skyLow]]);
    blob(g, W * .15, H * .05, W * .6, H * .5, C.accent, .06);
    blob(g, W * .9, H * .95, W * .5, H * .4, C.accent2, .04);
    this.L.sky = sky;
  }

  /* ---------- photo themes: a real photo that lives ---------- */
  // The photo is graded toward the theme's colours, and its own city lights are found (the brightest
  // points) so they can twinkle and pulse with the music; a bloom of its bright areas breathes with the bass.
  buildPhoto() {
    const { W, H, C } = this, th = this.th, ph = th.photo || {}, f = this.f;
    const sky = canvas(W, H); this.skyGradient(sky.getContext("2d"), [[0, C.skyTop], [.55, C.skyMid], [1, C.skyLow]]); this.L.sky = sky;
    this.horizon = H * .42; this.plights = [];
    const P = loadPhoto(ph.src, () => { this.photoTick = (this.photoTick || 0) + 1; this.key = ""; if (this.onReady) this.onReady(); });
    if (!P || !P.bmp) { this.L.photo = null; return; }
    const bmp = P.bmp, up0 = Math.max(W / bmp.width, H / bmp.height), over = up0 > 1.4 ? 1.02 : 1.035, PW = Math.ceil(W * over), PH = Math.ceil(H * over);
    const sc = Math.max(PW / bmp.width, PH / bmp.height), dw = bmp.width * sc, dh = bmp.height * sc;
    const fx = ph.fx != null ? ph.fx / 100 : (ph.focus || [.5, .5])[0], fy = ph.fy != null ? ph.fy / 100 : (ph.focus || [.5, .5])[1];
    const dx = clamp(PW / 2 - fx * dw, PW - dw, 0), dy = clamp(PH / 2 - fy * dh, PH - dh, 0);
    const pc = canvas(PW, PH), pg = pc.getContext("2d");
    const bright = (this.fxv.bright ?? 100), grade = f("grade");
    pg.imageSmoothingEnabled = true; pg.imageSmoothingQuality = "high";
    pg.filter = `brightness(${bright}%) contrast(${104 + grade * 10}%)` + (f("blur") > .02 ? ` blur(${(f("blur") * 6 * this.k).toFixed(1)}px)` : "");
    pg.drawImage(bmp, dx, dy, dw, dh); pg.filter = "none";
    if (sc > 1.25 && f("blur") < .02) {   // a small photo blown up: sharpen it (unsharp mask) and add a fine grain so it reads as a photo
      const bc = canvas(PW, PH), bgc = bc.getContext("2d", { willReadFrequently: true });
      bgc.filter = `blur(${Math.min(3, sc * .7).toFixed(1)}px)`; bgc.drawImage(pc, 0, 0);
      const A = pg.getImageData(0, 0, PW, PH), B = bgc.getImageData(0, 0, PW, PH).data, d = A.data, amt = Math.min(1.1, .45 + (sc - 1) * .3);
      let seed = 1234567;
      for (let i = 0; i < d.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff; const n = ((seed >> 16) & 255) / 255 - .5, grain = n * 9;
        d[i] = d[i] + (d[i] - B[i]) * amt + grain; d[i + 1] = d[i + 1] + (d[i + 1] - B[i + 1]) * amt + grain; d[i + 2] = d[i + 2] + (d[i + 2] - B[i + 2]) * amt + grain;
      }
      pg.putImageData(A, 0, 0);
    }
    if (grade > 0) {   // "blue hour" grade: shadows deep navy, mid-tones blue, highlights icy; bright neon keeps some of its colour
      const img = pg.getImageData(0, 0, PW, PH), d = img.data;
      const stops = [[0, mix(C.bg, BLACK, .5)], [.22, C.skyTop], [.45, C.skyMid], [.7, C.skyLow], [.86, mix(C.window, WHITE, .2)], [1, [246, 250, 255]]];
      const lut = new Uint8Array(256 * 3);
      for (let v = 0; v < 256; v++) {
        const L = v / 255; let k = 0; while (k < stops.length - 2 && L > stops[k + 1][0]) k++;
        const [l0, c0] = stops[k], [l1, c1] = stops[k + 1], t = clamp((L - l0) / (l1 - l0), 0, 1), c = mix(c0, c1, t * t * (3 - 2 * t));
        lut[v * 3] = c[0]; lut[v * 3 + 1] = c[1]; lut[v * 3 + 2] = c[2];
      }
      const amt = clamp(grade * 1.25, 0, 1);
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gch = d[i + 1], b = d[i + 2], L = (.2126 * r + .7152 * gch + .0722 * b) | 0;
        const sat = (Math.max(r, gch, b) - Math.min(r, gch, b)) / 255, keep = L > 150 ? Math.min(.6, sat * 1.4 * (L - 150) / 105) : 0;   // vivid lights stay a bit themselves
        const a = amt * (1 - keep), o = L * 3;
        d[i] = r + (lut[o] - r) * a; d[i + 1] = gch + (lut[o + 1] - gch) * a; d[i + 2] = b + (lut[o + 2] - b) * a;
      }
      pg.putImageData(img, 0, 0);
    }
    // find the lights: bright local maxima on a small copy
    const sw = 720, sh = Math.max(2, Math.round(sw * PH / PW)), small = canvas(sw, sh), sg = small.getContext("2d", { willReadFrequently: true });
    sg.drawImage(pc, 0, 0, sw, sh);
    const d = sg.getImageData(0, 0, sw, sh).data, lumA = new Float32Array(sw * sh), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const l = .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; lumA[j] = l; hist[l | 0]++; }
    let acc = 0, p97 = 255; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > sw * sh * .035) { p97 = v; break; } }
    const thr = Math.max(120, Math.min(225, p97)), sx = PW / sw, sy = PH / sh, R = this.R, pts = [];
    for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
      const j = y * sw + x, l = lumA[j]; if (l < thr) continue;
      if (l < lumA[j - 1] || l < lumA[j + 1] || l < lumA[j - sw] || l < lumA[j + sw] || l < lumA[j - sw - 1] || l < lumA[j + sw + 1]) continue;
      const i = j * 4; pts.push({ x: (x + .5) * sx, y: (y + .5) * sy, c: mix([d[i], d[i + 1], d[i + 2]], WHITE, .25), s: (l - thr) / Math.max(1, 255 - thr) });
    }
    for (let i = pts.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    const area = clamp(W * H / 1.3e6, .4, 1.6);
    this.plights = pts.slice(0, Math.round(520 * area)).map(p => ({ ...p, r: (3 + p.s * 7 + R() * 3) * Math.max(this.k, .45), b: (R() * 3) | 0, k: (R() * 2) | 0, a: .35 + R() * .55 }));
    const half = .5, LW = Math.ceil(PW * half), LH = Math.ceil(PH * half);
    this.L.lights = [0, 1, 2].map(b => [0, 1].map(k => {
      const c = canvas(LW, LH), cg = c.getContext("2d"); cg.globalCompositeOperation = "lighter";
      for (const l of this.plights) if (l.b === b && l.k === k) { cg.globalAlpha = l.a; const r = l.r * half; cg.drawImage(glow(l.c), l.x * half - r, l.y * half - r, r * 2, r * 2); }
      return c;
    }));
    // bloom: only the bright parts, blurred, added on top (the city "breathes")
    const bd = sg.createImageData(sw, sh), o = bd.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const k = clamp((lumA[j] - thr * .7) / (255 - thr * .7), 0, 1); o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = k * k * 255; }
    const bc = canvas(sw, sh); bc.getContext("2d").putImageData(bd, 0, 0);
    const bl = canvas(PW, PH), bg = bl.getContext("2d"); bg.imageSmoothingQuality = "high"; bg.filter = `blur(${Math.max(2, 6 * this.k)}px)`; bg.drawImage(bc, 0, 0, PW, PH);
    // a soft vignette so the panels read well
    const vg = canvas(W, H), vgg = vg.getContext("2d"), rg = vgg.createRadialGradient(W / 2, H * .45, Math.min(W, H) * .3, W / 2, H * .5, Math.hypot(W, H) * .62);
    rg.addColorStop(0, "rgba(0,0,0,0)"); rg.addColorStop(1, css(mix(C.bg, BLACK, .4), .72)); vgg.fillStyle = rg; vgg.fillRect(0, 0, W, H);
    pg.drawImage(vg, (PW - W) / 2, (PH - H) / 2); pg.fillStyle = css(mix(C.bg, BLACK, .4), .72);   // baked in: one less full-screen draw per frame
    pg.fillRect(0, 0, PW, (PH - H) / 2 + 1); pg.fillRect(0, PH - (PH - H) / 2 - 1, PW, (PH - H) / 2 + 1);
    // finished pictures become GPU images: uploaded once, drawn cheaply every frame
    const bake = c => (typeof c.transferToImageBitmap === "function" ? c.transferToImageBitmap() : c);
    this.L.photo = bake(pc); this.L.bright = bake(bl); if (this.L.lights) this.L.lights = this.L.lights.map(row => row.map(bake));
  }
  drawPhoto(dt, sp) {
    const g = this.g, { W, H } = this, L = this.L, f = this.f, a = this.audio, m = this.m;
    if (!L.photo) { g.drawImage(L.sky, 0, 0); return; }
    // the picture stays put: no drifting, no following the mouse (it read as the background swaying)
    const ox = Math.round((L.photo.width - W) / 2), oy = Math.round((L.photo.height - H) / 2);
    g.drawImage(L.photo, -ox, -oy);
    g.globalCompositeOperation = "lighter";
    const ba = clamp(.02 + f("glow") * .16 + Math.sin(this.t * .25) * .02 + m * (a.bass * .45 + a.beat * .25), 0, 1);
    if (ba > .01) { g.globalAlpha = ba; g.drawImage(L.bright, -ox, -oy); }
    const sparkle = f("sparkle"), t = this.t, bands = [a.bass, a.mid, a.high], speeds = [.55, .8, 1.15];
    if (sparkle > 0 && L.lights) {   // six layers, each breathing on its own and with its part of the music
      const flare = m * a.beat, lw = L.photo.width, lh = L.photo.height;
      for (let b = 0; b < 3; b++) for (let k = 0; k < 2; k++) {
        const tw = .5 + .5 * Math.sin(t * speeds[b] + k * Math.PI + b * 2.1), mu = m * bands[b];
        const al = sparkle * (.14 + tw * tw * .55 + mu * .8 + (b === 0 ? flare * .45 : 0));
        if (al < .02) continue;
        g.globalAlpha = clamp(al, 0, 1); g.drawImage(L.lights[b][k], -ox, -oy, lw, lh);
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    this.comets_(dt, sp);
    this.lightning(dt);
  }

  /* ================= things that move ================= */

  setupMoving() {
    const { W, H } = this, f = this.f, area = clamp(W * H / 1.3e6, .35, 1.6);
    const resize = (arr, n, make) => { while (arr.length < n) arr.push(make(true)); arr.length = n; return arr; };
    this.parts = resize(this.parts, Math.round(f("particles") * 90 * area), a => this.newPart(a));
    this.rain = resize(this.rain, Math.round(f("rain") * 320 * area), a => this.newDrop(a));
    this.flakes = resize(this.flakes, Math.round(f("snow") * 260 * area), a => this.newFlake(a));
    this.drops = resize(this.drops, Math.round(f("droplets") * 70 * area), a => this.newGlassDrop(a));
  }
  newPart(anywhere) {
    const R = Math.random, bokeh = R() < .14;
    return { x: R() * this.W, y: anywhere ? R() * this.H : this.H + 10, r: bokeh ? 3 + R() * 5 : .6 + R() * 1.6, a: bokeh ? .06 + R() * .1 : .25 + R() * .55,
      vx: (R() - .5) * 6, vy: -(2 + R() * 9), p: R() * TAU, c: R() < .55 ? 0 : R() < .7 ? 1 : 2, d: .3 + R() * .7 };
  }
  newDrop(anywhere) {
    const R = Math.random;
    return { x: R() * this.W * 1.2, y: anywhere ? R() * this.H : -30 - R() * 100, l: (10 + R() * 16) * Math.max(this.k, .4), v: (650 + R() * 350) * (this.H / 900), near: R() < .12,
      land: this.H * (.62 + R() * .38) };
  }
  newFlake(anywhere) {
    const R = Math.random, near = R() < .15;
    return { x: R() * this.W, y: anywhere ? R() * this.H : -10, r: (near ? 2.2 + R() * 2.2 : .8 + R() * 1.4) * Math.max(this.k, .5), v: (near ? 50 : 22 + R() * 30) * (this.H / 900),
      p: R() * TAU, sw: .5 + R() * 1.2, a: near ? .45 : .5 + R() * .4 };
  }
  newGlassDrop(anywhere) {
    const R = Math.random;
    return { x: R() * this.W, y: anywhere ? R() * this.H : -10, r: (2 + Math.pow(R(), 2) * 9) * Math.max(this.k, .5), slide: 0, life: 20 + R() * 60, age: anywhere ? R() * 40 : 0 };
  }
  spawnComet() {
    const { W, H } = this, R = Math.random, f = this.f, s = H / 900, dir = R() < .5 ? -1 : 1;
    const ang = Math.PI / 2 + dir * (.25 + R() * .55);   // mostly falling, a little sideways
    const sp = lerp(70, 380, f("cometSpeed")) * (.7 + R() * .6) * s;
    this.comets.push({ x: W * (.08 + R() * .84), y: H * (-.03 + R() * .22), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      len: (60 + R() * 200) * s, size: (.8 + R() * 1.5) * Math.max(this.k, .5), b: .45 + R() * .55, age: 0,
      end: (this.horizon || H * .7) * (.7 + R() * .28) });
  }

  // A shooting star from where you clicked, heading down across the sky.
  spawnCometAt(x, y) {
    const R = Math.random, s = this.H / 900, dir = x < this.W / 2 ? 1 : -1, ang = Math.PI / 2 - dir * (.35 + R() * .35), sp = (260 + R() * 160) * s;
    this.comets.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, len: (140 + R() * 120) * s, size: (1.6 + R()) * Math.max(this.k, .6), b: 1, age: 0,
      end: Math.min(this.H * .95, y + this.H * (.35 + R() * .3)) });
  }
  // Fireworks: a rocket climbs to where you double-clicked, then bursts in the theme's colours.
  launch(x, y) {
    if (this.rockets.length > 6) return;
    this.rockets.push({ x: x + (Math.random() - .5) * 40, y: this.H + 10, tx: x, ty: y, t: 0, dur: .55 + Math.random() * .25 });
  }
  burst(x, y) {
    const C = this.C, R = Math.random, cols = [C.accent, C.accent2, mix(C.window, WHITE, .3), this.tint || C.accent, [255, 255, 255]];
    const main = cols[(R() * 4) | 0], second = cols[(R() * 5) | 0], n = 110, k = Math.max(this.k, .55), ring = R() < .35;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R() * .1, sp = (ring ? 260 : 80 + R() * 230) * k * (this.H / 900);
      this.embers.push({ x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.1 + R() * 1.1, age: 0, c: R() < .7 ? main : second, s: (1.2 + R() * 1.4) * k, tw: R() < .3 });
    }
    this.flash = { x, y, a: 1, c: main };
    if (this.embers.length > 900) this.embers.splice(0, this.embers.length - 900);
  }
  fireworks(dt) {
    if (!this.rockets.length && !this.embers.length && !this.flash) return;
    const g = this.g, k = Math.max(this.k, .55);
    g.globalCompositeOperation = "lighter";
    this.rockets = this.rockets.filter(r => {
      r.t += dt; const p = Math.min(1, r.t / r.dur), e = 1 - Math.pow(1 - p, 2), x = lerp(r.x, r.tx, e), y = lerp(r.y, r.ty, e);
      g.globalAlpha = .9; g.drawImage(glow([255, 230, 190], true), x - 5 * k, y - 5 * k, 10 * k, 10 * k);
      if (Math.random() < .8) this.embers.push({ x, y, px: x, py: y, vx: (Math.random() - .5) * 20, vy: 30 + Math.random() * 30, life: .4 + Math.random() * .3, age: 0, c: [255, 200, 140], s: 1 * k });
      if (p >= 1) { this.burst(r.tx, r.ty); return false; } return true;
    });
    if (this.flash) {
      const f = this.flash; g.globalAlpha = f.a * .55; g.drawImage(glow(f.c), f.x - 140 * k, f.y - 140 * k, 280 * k, 280 * k);
      f.a -= dt * 3; if (f.a <= 0) this.flash = null;
    }
    g.lineCap = "round";
    this.embers = this.embers.filter(m => {
      m.age += dt; if (m.age > m.life) return false;
      m.px = m.x; m.py = m.y; m.vx *= Math.pow(.18, dt); m.vy = m.vy * Math.pow(.18, dt) + 120 * dt * (this.H / 900); m.x += m.vx * dt; m.y += m.vy * dt;
      const f = 1 - m.age / m.life, a = f * (m.tw ? (.5 + .5 * Math.sin(m.age * 40)) : 1);
      g.globalAlpha = a; g.strokeStyle = css(m.c, 1); g.lineWidth = m.s; g.beginPath(); g.moveTo(m.px, m.py); g.lineTo(m.x, m.y); g.stroke();
      g.globalAlpha = a * .5; g.drawImage(glow(m.c, true), m.x - m.s * 3, m.y - m.s * 3, m.s * 6, m.s * 6);
      return true;
    });
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  }

  setAudio(a) {
    const s = this.audio;
    s.tl = a.level || 0; s.tb = a.bass ?? a.level ?? 0; s.tm = a.mid ?? a.level ?? 0; s.th = a.high ?? a.level ?? 0;
    s.playing = !!a.playing;
    if (a.beat) s.beat = 1;
  }
  setMouse(x, y) { this.mouse.tx = x; this.mouse.ty = y; }

  frame(dt) {
    const a = this.audio, f = this.f, on = a.playing ? 1 : 0;
    a.level = lerp(a.level, a.tl * on, .3); a.bass = lerp(a.bass, a.tb * on, .35); a.mid = lerp(a.mid, a.tm * on, .3); a.high = lerp(a.high, a.th * on, .3);
    a.beat *= Math.pow(.02, dt);
    this.m = on ? f("music") : 0;
    if (this.tintTarget) this.tint = this.tint ? mix(this.tint, this.tintTarget, Math.min(1, dt * .8)) : this.tintTarget.slice();
    else this.tint = null;
    const sp = .25 + f("speed") * 1.5;
    this.t += dt * sp; this.real += dt;
    const ms = this.mouse; ms.x = lerp(ms.x, ms.tx, .04); ms.y = lerp(ms.y, ms.ty, .04);
    this.sway = Math.sin(this.t * .05) * .6 + ms.x;
    this.draw(dt, sp);
  }

  draw(dt, sp) {
    const g = this.g, { W, H } = this, s = this.scene;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    if (s === "image") { g.clearRect(0, 0, W, H); this.fx(dt, sp); this.fireworks(dt); this.dark(dt); return; }
    if (this.L.sky) g.drawImage(this.L.sky, 0, 0);
    if (s === "minimal") return;
    this.drawPhoto(dt, sp); this.fx(dt, sp); this.fireworks(dt); this.dark(dt);
  }
  dark(dt) {   // the start of the night: the city switches its lights on
    if (!(this.intro > 0)) return;
    const g = this.g; g.globalAlpha = Math.pow(this.intro, 1.4) * .92; g.fillStyle = "#020106"; g.fillRect(0, 0, this.W, this.H); g.globalAlpha = 1;
    this.intro = Math.max(0, this.intro - dt / 2.6);
  }

  lightning(dt) {
    const f = this.f; if (!(f("lightning") > 0) || this.still) return;
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      const R = Math.random, x = this.W * (.15 + R() * .7), y = this.H * (.08 + R() * .18), pts = [[x, y]];
      let px = x, py = y; const end = (this.horizon || this.H * .6) - this.H * .02;
      while (py < end) { px += (R() - .5) * 26 * this.k; py += (12 + R() * 22) * this.k; pts.push([px, Math.min(py, end)]); }
      this.bolt = { x, y, pts, age: 0 };
      this.nextBolt = lerp(26, 5, f("lightning")) * (.5 + R());
    }
    const b = this.bolt; if (!b) return;
    b.age += dt;
    const k = b.age < .08 ? 1 : b.age < .14 ? .25 : b.age < .24 ? .8 : Math.max(0, 1 - (b.age - .24) / .5);
    if (k <= 0) { this.bolt = null; return; }
    const g = this.g; g.globalCompositeOperation = "lighter";
    g.globalAlpha = k * .5; g.drawImage(glow(mix(this.C.skyLow, WHITE, .6)), b.x - this.W * .22, b.y - this.H * .14, this.W * .44, this.H * .28);
    if (b.age < .3) { g.globalAlpha = k * .7; g.strokeStyle = "rgba(230,235,255,.9)"; g.lineWidth = 1.2 * Math.max(this.k, .5);
      g.beginPath(); b.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  }

  comets_(dt, sp) {
    const f = this.f, freq = f("comets");
    if (freq > 0 && !this.still) {
      this.nextComet -= dt * (1 + this.m * (.5 + this.audio.level * .8)) * (sp > .3 ? 1 : .6);
      if (this.nextComet <= 0) { this.spawnComet(); const mean = lerp(38, 3.2, Math.pow(freq, .8)); this.nextComet = mean * (.35 + Math.random() * 1.3); }
    }
    const g = this.g, tint = this.tint || this.C.accent, head = mix(WHITE, tint, .25);
    if (this.comets.length) {
      g.globalCompositeOperation = "lighter"; g.lineCap = "round";
      this.comets = this.comets.filter(c => {
        c.age += dt; c.x += c.vx * dt; c.y += c.vy * dt;
        const fadeIn = Math.min(1, c.age / .35), fadeOut = clamp((c.end - c.y) / (c.end * .18), 0, 1), a = c.b * fadeIn * fadeOut;
        if (a <= .005 && c.age > .5) return false;
        const n = Math.hypot(c.vx, c.vy), tx = c.x - c.vx / n * c.len * fadeIn, ty = c.y - c.vy / n * c.len * fadeIn;
        const gr = g.createLinearGradient(c.x, c.y, tx, ty);
        gr.addColorStop(0, css(head, a)); gr.addColorStop(.25, css(mix(head, tint, .5), a * .5)); gr.addColorStop(1, css(tint, 0));
        g.strokeStyle = gr; g.globalAlpha = .18; g.lineWidth = c.size * 4.5; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(tx, ty); g.stroke();
        g.globalAlpha = 1; g.lineWidth = c.size; g.stroke();
        const hs = c.size * 9; g.globalAlpha = a; g.drawImage(glow(head), c.x - hs / 2, c.y - hs / 2, hs, hs);
        if (!this.still && Math.random() < .5 && this.sparks.length < 120) this.sparks.push({ x: c.x, y: c.y, vx: c.vx * .05 + (Math.random() - .5) * 14, vy: c.vy * .05 + (Math.random() - .2) * 14, age: 0, life: .5 + Math.random() * .8, a });
        return true;
      });
    }
    if (this.sparks.length) {   // little sparkles the comets shed
      const sc = glow(head, true);
      this.sparks = this.sparks.filter(p => { p.age += dt; if (p.age > p.life) return false; p.x += p.vx * dt; p.y += p.vy * dt;
        g.globalAlpha = p.a * (1 - p.age / p.life) * .8; g.drawImage(sc, p.x - 1.5, p.y - 1.5, 3, 3); return true; });
    }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  }

  fx(dt, sp) {  // foreground: particles, snow, rain and drops on the glass, over every scene
    const g = this.g, { W, H } = this, f = this.f, a = this.audio, lv = this.m * (a.mid * .6 + a.level * .3), k = Math.max(this.k, .35);
    if (this.parts.length) {
      const C = this.C, cols = [mix(C.window, WHITE, .3), C.accent, this.tint || C.accent2].map(c => glow(c));
      const ps = (.2 + f("particleSpeed") * 2.2) * (1 + lv * .6), t = this.t;
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < this.parts.length; i++) {
        const p = this.parts[i];
        if (!this.still) { p.x += (p.vx + Math.sin(t * .3 + p.p) * 3) * ps * dt; p.y += p.vy * ps * dt; }
        if (p.y < -20 || p.x < -20 || p.x > W + 20) { this.parts[i] = this.newPart(false); continue; }
        const r = p.r * (1 + lv * .35) * 6 * k, al = p.a * (.6 + .4 * Math.sin(t * .8 + p.p)) * (1 + lv * .8);
        g.globalAlpha = clamp(al, 0, 1); g.drawImage(cols[p.c], p.x + this.sway * 24 * p.d - r / 2, p.y - r / 2, r, r);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    }
    if (this.flakes.length) {
      const sprite = glow([240, 245, 255]), t = this.real;
      g.globalCompositeOperation = "lighter";
      for (const s of this.flakes) {
        if (!this.still) { s.y += s.v * dt; s.x += Math.sin(t * s.sw + s.p) * 14 * dt + this.sway * .4; }
        if (s.y > H + 10) Object.assign(s, this.newFlake(false));
        if (s.x < -10) s.x += W + 20; else if (s.x > W + 10) s.x -= W + 20;
        const r = s.r * 4; g.globalAlpha = s.a; g.drawImage(sprite, s.x - r / 2, s.y - r / 2, r, r);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    }
    if (this.rain.length) {
      const slant = .16, C = this.C, rc = mix(C.window, [190, 215, 255], .7);
      g.lineWidth = Math.max(.6, k); g.strokeStyle = css(rc, .22); g.beginPath();
      const near = [];
      for (const d of this.rain) {
        if (!this.still) { d.y += d.v * dt; d.x -= d.v * slant * dt; }
        if (d.y > d.land) {
          if (!this.still && this.splashes.length < 70 && d.land < H && Math.random() < .5) this.splashes.push({ x: d.x, y: d.land, age: 0 });
          Object.assign(d, this.newDrop(false)); continue;
        }
        if (d.near) { near.push(d); continue; }
        g.moveTo(d.x, d.y); g.lineTo(d.x + d.l * slant, d.y - d.l);
      }
      g.stroke();
      g.strokeStyle = css(rc, .35); g.lineWidth = Math.max(1, 1.6 * k); g.beginPath();
      for (const d of near) { g.moveTo(d.x, d.y); g.lineTo(d.x + d.l * 2.2 * slant, d.y - d.l * 2.2); }
      g.stroke();
      if (this.splashes.length) {
        g.strokeStyle = css(rc, .5); g.lineWidth = .8;
        this.splashes = this.splashes.filter(s => { s.age += dt; if (s.age > .32) return false; const r = (1 + s.age * 22) * k;
          g.globalAlpha = 1 - s.age / .32; g.beginPath(); g.ellipse(s.x, s.y, r, r * .35, 0, 0, TAU); g.stroke(); return true; });
        g.globalAlpha = 1;
      }
    }
    if (this.drops.length) {   // rain on the window you're looking through
      const sprite = droplet();
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        if (!this.still) {
          d.age += dt;
          if (!d.slide && d.r > 5 * k && Math.random() < dt * .02) d.slide = 30 + Math.random() * 60;
          if (d.slide) { d.y += d.slide * dt * (H / 900); d.x += Math.sin(d.y * .05) * .3;
            if (Math.random() < dt * 6 && this.drops.length < 260) this.drops.push({ x: d.x + (Math.random() - .5) * 2, y: d.y - d.r, r: d.r * (.15 + Math.random() * .2), slide: 0, life: 4 + Math.random() * 8, age: 0 }); }
          if (d.y > H + 20 || d.age > d.life) { if (i >= Math.round(this.f("droplets") * 70 * clamp(W * H / 1.3e6, .35, 1.6))) { this.drops.splice(i--, 1); continue; } this.drops[i] = this.newGlassDrop(false); continue; }
        }
        const fade = Math.min(1, d.age / 1.5, (d.life - d.age) / 2);
        g.globalAlpha = clamp(fade, 0, 1) * .9; const r = d.r * 2; g.drawImage(sprite, d.x - r / 2, d.y - r / 2, r, r * 1.08);
      }
      g.globalAlpha = 1;
    }
  }
}
