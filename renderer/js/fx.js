// Skyline's motion system: page transitions, the gliding rail indicator, cascading entrances, light
// that follows the cursor, 3D tilt, ripples, magnetic buttons, counters, confetti, cursor effects,
// interface sounds and the startup "lights on" intro. Everything scales with Settings › Interface ›
// Motion and switches off when animations are reduced.
import { $, $$, clamp } from "./util.js";

let prefs = () => ({});
let reduced = () => false;
export const level = () => (reduced() ? "off" : prefs().motion || "full");
const on = () => level() !== "off";
const full = () => level() === "full";

/* ---------- page transitions ---------- */
export function transition(update, dir = 0) {
  update();
  if (!on()) return;
  const v = document.querySelector(".view:not(.hidden)"); if (!v) return;
  v.classList.remove("enter", "down"); void v.offsetWidth; v.classList.add("enter"); if (dir > 0) v.classList.add("down");
  sound("page");
}

/* ---------- the rail's gliding indicator ---------- */
export function railIndicator() {
  const rail = $(".rail"); if (!rail) return;
  let ind = rail.querySelector(".rail-ind");
  if (!ind) { ind = document.createElement("i"); ind.className = "rail-ind"; rail.prepend(ind); }
  const act = rail.querySelector(".rbtn.on");
  if (!act) { ind.style.opacity = 0; return; }
  ind.style.opacity = 1;
  ind.style.transform = `translateY(${act.offsetTop}px)`;
  ind.style.height = act.offsetHeight + "px";
  if (full()) { act.classList.remove("pop"); void act.offsetWidth; act.classList.add("pop"); }
}

/* ---------- cascading entrances ---------- */
export function cascade(root, sel = ".glass, .gcard, .th-card, .widget, .sbox") {
  if (!root || !on()) return;
  let i = 0;
  for (const el of root.querySelectorAll(sel)) {
    if (!el.offsetParent) continue;
    el.style.setProperty("--i", Math.min(i++, 14));
    el.classList.remove("cascade"); void el.offsetWidth; el.classList.add("cascade");
  }
}

/* ---------- light that follows the cursor + 3D tilt + magnetic buttons ---------- */
let lastSpot = null, lastTilt = null, lastMag = null, raf = 0, pend = null;
function pointer(e) {
  pend = e; if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0; const ev = pend; if (!ev || !on()) return;
    const t = ev.target instanceof Element ? ev.target : null;
    const spot = t && t.closest(".glass, .gcard, .th-card, .lk, .subnav");
    if (lastSpot && lastSpot !== spot) lastSpot.classList.remove("lit");
    if (spot) { const r = spot.getBoundingClientRect(); spot.style.setProperty("--mx", ev.clientX - r.left + "px"); spot.style.setProperty("--my", ev.clientY - r.top + "px"); spot.classList.add("lit"); }
    lastSpot = spot;
    const tilt = full() && prefs().tilt !== false && t && t.closest(".gcard, .th-card, .tt, .pl-art, .mu-art");
    if (lastTilt && lastTilt !== tilt) { lastTilt.style.removeProperty("--rx"); lastTilt.style.removeProperty("--ry"); lastTilt.classList.remove("tilting"); }
    if (tilt) { const r = tilt.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width - .5, y = (ev.clientY - r.top) / r.height - .5;
      tilt.style.setProperty("--rx", (-y * 9).toFixed(2) + "deg"); tilt.style.setProperty("--ry", (x * 11).toFixed(2) + "deg"); tilt.classList.add("tilting"); }
    lastTilt = tilt;
    const mag = full() && t && t.closest(".btn.lg, .pl-btn.big, .btn.primary");
    if (lastMag && lastMag !== mag) { lastMag.style.removeProperty("--tx"); lastMag.style.removeProperty("--ty"); }
    if (mag) { const r = mag.getBoundingClientRect(); mag.style.setProperty("--tx", ((ev.clientX - r.left - r.width / 2) * .18).toFixed(1) + "px"); mag.style.setProperty("--ty", ((ev.clientY - r.top - r.height / 2) * .28).toFixed(1) + "px"); }
    lastMag = mag;
    cursorMove(ev);
  });
}

/* ---------- ripples ---------- */
function ripple(e) {
  if (!on() || e.button !== 0) return;
  const b = e.target.closest(".btn, .rbtn, .pl-btn, .gchip, .seg button, .subnav button, .tb-btn, .ibtn, .gex, .lk"); if (!b) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2, i = document.createElement("i");
  i.className = "ripple"; i.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.appendChild(i); setTimeout(() => i.remove(), 650);
  sound("click");
}

/* ---------- counters ---------- */
export function count(el, value, format, ms = 600) {
  if (!el) return;
  const from = el._v ?? value; el._v = value;
  if (!on() || from === value || !isFinite(from)) { el.textContent = format(value); return; }
  const t0 = performance.now(); cancelAnimationFrame(el._r);
  const step = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = format(from + (value - from) * e); if (k < 1) el._r = requestAnimationFrame(step); };
  el._r = requestAnimationFrame(step);
}

/* ---------- rolling digits (the clock) ---------- */
export function roll(el, text) {
  if (!el) return;
  if (!on() || prefs().clockRoll === false) { if (el.dataset.t !== text) { el.textContent = text; el.dataset.t = text; } return; }
  const prev = el.dataset.t || ""; if (prev === text) return;
  el.dataset.t = text;
  if (el.children.length !== text.length) { el.innerHTML = [...text].map(c => `<span class="dg"><i>${c}</i></span>`).join(""); return; }
  [...text].forEach((c, i) => {
    const slot = el.children[i], cur = slot.querySelector("i:not(.out)");
    if (cur && cur.textContent === c) return;
    if (cur) { cur.classList.add("out"); setTimeout(() => cur.remove(), 500); }
    const n = document.createElement("i"); n.textContent = c; n.className = "in"; slot.appendChild(n);
    setTimeout(() => n.classList.remove("in"), 760);   // settles back into the flow so the slot keeps its width
  });
}

/* ---------- confetti ---------- */
export function confetti(x = innerWidth / 2, y = innerHeight / 3, colors) {
  if (!on()) return;
  const cv = document.createElement("canvas"); cv.className = "confetti"; cv.width = innerWidth; cv.height = innerHeight; document.body.appendChild(cv);
  const g = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
  const pal = colors || [css.getPropertyValue("--a1").trim(), css.getPropertyValue("--a2").trim(), "#ffffff", "#ffd166", css.getPropertyValue("--a-soft").trim()];
  const ps = [...Array(full() ? 170 : 80)].map(() => { const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 11;
    return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .4, w: 5 + Math.random() * 7, h: 3 + Math.random() * 5, c: pal[(Math.random() * pal.length) | 0], life: 1 }; });
  let last = performance.now();
  const step = now => {
    const dt = Math.min(.05, (now - last) / 1000) * 60; last = now; g.clearRect(0, 0, cv.width, cv.height); let alive = 0;
    for (const p of ps) { if (p.life <= 0) continue; alive++; p.vy += .32 * dt; p.vx *= .99; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life -= .006 * dt;
      g.save(); g.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5)); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); g.restore(); }
    if (alive && now - t0 < 4000) requestAnimationFrame(step); else cv.remove();
  };
  const t0 = performance.now(); requestAnimationFrame(step);
  sound("success");
}

/* ---------- cursor glow + sparkle trail ---------- */
let glowEl = null, trail = null;
function cursorMove(e) {
  const p = prefs();
  if (glowEl) { glowEl.style.transform = `translate(${e.clientX - 160}px, ${e.clientY - 160}px)`; }
  if (trail && p.trail && full()) {
    const last = trail.last || { x: e.clientX, y: e.clientY }, d = Math.hypot(e.clientX - last.x, e.clientY - last.y);
    for (let k = 0; k < Math.min(4, d / 9); k++) trail.ps.push({ x: e.clientX + (Math.random() - .5) * 8, y: e.clientY + (Math.random() - .5) * 8, vx: (Math.random() - .5) * .8, vy: Math.random() * .6 + .2, life: 1, s: 1 + Math.random() * 2.2 });
    trail.last = { x: e.clientX, y: e.clientY };
    if (!trail.raf) trail.raf = requestAnimationFrame(trailStep);
  }
}
function trailStep() {
  const t = trail; t.raf = 0; const g = t.g;
  if (t.cv.width !== innerWidth || t.cv.height !== innerHeight) { t.cv.width = innerWidth; t.cv.height = innerHeight; }
  g.clearRect(0, 0, t.cv.width, t.cv.height);
  const col = getComputedStyle(document.documentElement).getPropertyValue("--a-soft").trim() || "#cdbcff";
  g.globalCompositeOperation = "lighter";
  t.ps = t.ps.filter(p => { p.life -= .035; if (p.life <= 0) return false; p.x += p.vx; p.y += p.vy;
    g.globalAlpha = p.life; g.fillStyle = col; g.beginPath(); g.arc(p.x, p.y, p.s * p.life, 0, Math.PI * 2); g.fill();
    g.globalAlpha = p.life * .3; g.beginPath(); g.arc(p.x, p.y, p.s * 3 * p.life, 0, Math.PI * 2); g.fill(); return true; });
  if (t.ps.length) t.raf = requestAnimationFrame(trailStep);
}
export function cursorFx() {
  const p = prefs();
  if (p.cursorGlow !== false && on()) { if (!glowEl) { glowEl = document.createElement("div"); glowEl.className = "cursor-glow"; document.body.appendChild(glowEl); } }
  else if (glowEl) { glowEl.remove(); glowEl = null; }
  if (p.trail && full()) { if (!trail) { const cv = document.createElement("canvas"); cv.className = "trail"; document.body.appendChild(cv); trail = { cv, g: cv.getContext("2d"), ps: [] }; } }
  else if (trail) { trail.cv.remove(); trail = null; }
}

/* ---------- interface sounds (made on the spot, very quiet) ---------- */
let actx = null, lastHover = 0;
export function sound(kind) {
  const p = prefs(); if (!p.sounds) return;
  try {
    actx = actx || new AudioContext();
    const vol = clamp((p.soundVol ?? 40) / 100, 0, 1) * .5, now = actx.currentTime, out = actx.createGain(); out.gain.value = vol; out.connect(actx.destination);
    const tone = (f, t, d, type = "sine", g = .2, f2) => { const o = actx.createOscillator(), a = actx.createGain(); o.type = type; o.frequency.setValueAtTime(f, now + t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + t + d); a.gain.setValueAtTime(0, now + t); a.gain.linearRampToValueAtTime(g, now + t + .006);
      a.gain.exponentialRampToValueAtTime(.0001, now + t + d); o.connect(a).connect(out); o.start(now + t); o.stop(now + t + d + .02); };
    if (kind === "hover") { if (performance.now() - lastHover < 70) return; lastHover = performance.now(); tone(2600, 0, .025, "sine", .05); }
    else if (kind === "click") tone(520, 0, .06, "triangle", .16, 820);
    else if (kind === "page") { tone(300, 0, .16, "sine", .08, 620); tone(900, .05, .14, "sine", .04, 1300); }
    else if (kind === "success") { tone(660, 0, .5, "sine", .14); tone(990, .09, .6, "sine", .1); tone(1320, .18, .7, "sine", .07); }
    else if (kind === "toggle") tone(780, 0, .05, "square", .04, 1100);
  } catch (e) {}
}

/* ---------- the startup intro: the city switches its lights on ---------- */
export function intro() {
  const p = prefs();
  if (!on() || p.intro === false) return Promise.resolve();
  const el = document.createElement("div"); el.className = "intro";
  el.innerHTML = `<div class="intro-mark"><svg viewBox="0 0 120 120"><defs><linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--a1)"/><stop offset="1" stop-color="var(--a2)"/></linearGradient></defs>
    <g transform="translate(-4 0)"><path class="ln" d="M14 104V72h12v-10h10v42M40 104V52l10-8 10 8v52M64 104V64h14v40M82 104V36h8V24h4v12h8v68M106 104V70h8v34"/><circle class="moon" cx="92" cy="18" r="0"/></g></svg>
    <div class="intro-name">SKYLINE</div></div>`;
  document.body.appendChild(el);
  return new Promise(res => {
    const done = () => { if (el.classList.contains("out")) return; el.classList.add("out"); setTimeout(() => { el.remove(); res(); }, 700); };
    el.addEventListener("click", done);
    setTimeout(done, full() ? 1900 : 900);
  });
}

export const FX = {
  init(getPrefs, isReduced) {
    prefs = getPrefs; reduced = isReduced;
    document.addEventListener("pointermove", pointer, { passive: true });
    document.addEventListener("pointerdown", ripple, { passive: true });
    document.addEventListener("pointerover", e => { if (e.target.closest && e.target.closest(".btn, .rbtn, .gcard, .th-card, .lk, .pl-btn")) sound("hover"); }, { passive: true });
    document.addEventListener("pointerleave", () => { if (lastTilt) { lastTilt.style.removeProperty("--rx"); lastTilt.style.removeProperty("--ry"); } }, { passive: true });
    addEventListener("resize", () => railIndicator());
    cursorFx();
  },
  apply() { document.body.dataset.motion = level(); cursorFx(); railIndicator(); },
  transition, railIndicator, cascade, count, roll, confetti, sound, intro, level,
};
