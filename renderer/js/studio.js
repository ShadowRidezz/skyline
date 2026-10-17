// Theme Studio (Settings > Appearance): pick, preview, customise, save, rename, duplicate, delete,
// import and export themes. Every change shows live behind the page.
import { Themes, PHOTOS } from "./themes.js";
import { Scene } from "./scene/scene.js";
import { photoReady } from "./scene/engine.js";
import { $, $$, esc, sky, toast, dialog, setSeg, fromHsl } from "./util.js";
import { FX } from "./fx.js";

const ANIM = "image photo";
const COLOR_LABELS = {
  minimal: { bg: "Background", skyTop: "Top shade", skyMid: "Middle shade", skyLow: "Bottom shade", accent: "Accent", accent2: "Accent 2" },
  image: { bg: "Background", window: "Particles", accent: "Accent", accent2: "Accent 2" },
  photo: { bg: "Background", skyTop: "Grade: highlights", skyMid: "Grade: midtones", skyLow: "Grade: shadows", window: "Particles", accent: "Accent", accent2: "Accent 2" },
};
const SLIDERS = [
  ["weather", "fx.rain", "Rain", 0, 100, "%", ANIM],
  ["weather", "fx.droplets", "Rain on the glass", 0, 100, "%", ANIM],
  ["weather", "fx.snow", "Snow", 0, 100, "%", ANIM],
  ["weather", "fx.lightning", "Distant lightning", 0, 100, "%", "photo"],
  ["photo", "fx.bright", "Brightness", 40, 170, "%", "photo"],
  ["photo", "fx.grade", "Colour grade", 0, 100, "%", "photo"],
  ["photo", "fx.sparkle", "Twinkling city lights", 0, 100, "%", "photo"],
  ["photo", "fx.glow", "City glow", 0, 100, "%", "photo"],
  ["photo", "fx.blur", "Soft focus", 0, 100, "%", "photo"],
  ["photo", "photo.fx", "Framing: left ↔ right", 0, 100, "%", "photo"],
  ["photo", "photo.fy", "Framing: up ↕ down", 0, 100, "%", "photo"],
  ["motion", "fx.speed", "Animation speed", 0, 100, "%", ANIM],
  ["motion", "fx.particles", "Particle amount", 0, 100, "%", ANIM],
  ["motion", "fx.particleSpeed", "Particle speed", 0, 100, "%", ANIM],
  ["motion", "fx.comets", "Comet frequency", 0, 100, "%", ANIM],
  ["motion", "fx.cometSpeed", "Comet speed", 0, 100, "%", ANIM],
  ["read", "fx.music", "Music reactivity", 0, 100, "%", ANIM],
  ["read", "fx.bgOpacity", "Background opacity", 10, 100, "%", "minimal image"],
  ["read", "ui.panel", "Panel opacity", 55, 100, "%", "minimal image"],
  ["read", "ui.glass", "Glass blur", 0, 30, "px", "minimal image"],
  ["img", "image.blur", "Blur", 0, 30, "px", "image"],
  ["img", "image.brightness", "Brightness", 20, 120, "%", "image"],
  ["img", "image.contrast", "Contrast", 60, 150, "%", "image"],
  ["img", "image.opacity", "Opacity", 20, 100, "%", "image"],
  ["img", "image.overlayAmt", "Overlay strength", 0, 85, "%", "image"],
];
const STRUCTURAL = /^(colors\.|scene|photo\.|fx\.(blur|bright|grade))/;
const getK = (o, k) => k.split(".").reduce((a, p) => a == null ? a : a[p], o);
const setK = (o, k, v) => { const ps = k.split("."); let a = o; for (const p of ps.slice(0, -1)) a = a[p] = a[p] || {}; a[ps[ps.length - 1]] = v; };
const ask = () => dialog({ title: "Discard your changes?", text: `Your unsaved changes to “${Themes.draft.name}” will be lost.`, ok: "Discard", danger: true });

let built = false, visible = false, undo = [], redo = [], undoT = 0;

function sliderHTML([, k, label, min, max, unit, scenes]) {
  const name = typeof label === "string" ? label : Object.values(label)[0];
  return `<label class="sl" data-scenes="${scenes}" data-labels='${typeof label === "string" ? "" : JSON.stringify(label)}'>
    <span class="sl-l">${name}</span><input type="range" class="rg" min="${min}" max="${max}" step="1" data-k="${k}"><output data-u="${unit}"></output></label>`;
}

function build() {
  const el = $("#studio"), group = g => SLIDERS.filter(s => s[0] === g).map(sliderHTML).join("");
  el.innerHTML = `
    <div class="studio-head">
      <div><h3>Theme Studio</h3><p>Pick a world for your dashboard, then make it yours. Hover a theme to see it move.</p></div>
      <span class="sp"></span>
      <button class="btn sm ghost" data-th="import" title="Add themes from .skytheme files">Import</button>
      <button class="btn sm ghost" data-th="export" title="Save this theme as a file you can share">Export</button>
    </div>
    <div class="th-gallery" id="thGallery"></div>
    <div class="th-bar">
      <div class="th-ttl"><b id="thName"></b><span class="badge" id="thKind"></span><span class="badge warn hidden" id="thDirty">Unsaved changes</span></div>
      <button class="btn sm primary" data-th="save">Save Theme</button>
      <button class="btn sm" data-th="saveas">Save As New Theme</button>
      <button class="btn sm" data-th="rename">Rename</button>
      <button class="btn sm" data-th="duplicate">Duplicate</button>
      <button class="btn sm" data-th="reset">Reset</button>
      <button class="btn sm danger" data-th="delete">Delete Theme</button>
    </div>
    <div class="th-edit" id="thEdit">
      <div class="th-col">
        <div class="th-group"><h4>Scene <span class="sp"></span><button class="btn xs ghost" data-th="surprise" title="A random colour palette">Surprise me</button></h4>
          <div class="seg" id="thScene"><button data-v="photo">Photo</button><button data-v="minimal">Minimal</button></div>
        </div>
        <div class="th-group"><h4>Colours</h4>
          <div class="skyprev" id="thSky" title="Sky gradient"></div>
          <div class="swatches">${Object.keys(COLOR_LABELS.minimal).concat("window").map(k =>
            `<label class="swatch" data-c="${k}"><input type="color" data-k="colors.${k}"><span></span></label>`).join("")}</div>
        </div>
        <div class="th-group" data-scenes="photo"><h4>Live photo</h4>
          <p class="th-note">A real photo whose own city lights twinkle and pulse with your music.</p>
          <div class="ph-pick" id="thPhotos"></div>
          <div class="row"><button class="btn sm" data-th="ownphoto">Use my own photo…</button><span class="th-credit" id="thCredit"></span></div>
          ${group("photo")}
        </div>
        <div class="th-group" data-scenes="minimal image"><h4>Custom background</h4>
          <p class="th-note">Put your own picture behind the dashboard. It stays dimmed and the panels stay solid enough to read.</p>
          <div class="row"><button class="btn sm" data-th="upload">Choose picture…</button><button class="btn sm danger" data-th="noimg" id="thNoImg">Remove picture</button></div>
          <div class="th-imgctl" id="thImgCtl">${group("img")}
            <div class="row"><label class="swatch inline"><input type="color" data-k="image.overlay"><span>Overlay colour</span></label>
              <label class="toggle"><input type="checkbox" data-k="image.fx"><span class="sw"></span><span class="t"><b>Effects on top</b><small>Particles, comets, rain</small></span></label></div>
          </div>
        </div>
        <div class="th-group" data-scenes="${ANIM}"><h4>Weather</h4>${group("weather")}</div>
      </div>
      <div class="th-col">
        <div class="th-group" data-scenes="${ANIM}"><h4>Motion</h4>${group("motion")}</div>
        <div class="th-group"><h4>Music &amp; readability</h4>${group("read")}</div>
      </div>
    </div>`;

  el.addEventListener("input", e => {
    const k = e.target.dataset.k; if (!k) return;
    snapshot();
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.type === "range" ? +e.target.value : e.target.value;
    setK(Themes.draft, k, v); Themes.edit(); paint();
    Themes.applySoon(Themes.draft, STRUCTURAL.test(k));
    thumbSoon();
  });
  el.addEventListener("click", e => {
    const seg = e.target.closest("#thScene button");
    if (seg) { const key = "scene"; if (Themes.draft[key] === seg.dataset.v) return;
      snapshot(true); Themes.draft[key] = seg.dataset.v;
      if (seg.dataset.v === "photo" && !(Themes.draft.photo && Themes.draft.photo.src)) { Themes.draft.photo = Themes.clone(PHOTOS[0].photo); Themes.draft.image = null; }
      Themes.edit(); sync(); Themes.apply(Themes.draft); thumbSoon(); return; }
    const card = e.target.closest("[data-pick]");
    if (card) { pick(card.dataset.pick); return; }
    const b = e.target.closest("[data-th]"); if (b) act(b.dataset.th);
  });
  el.addEventListener("keydown", e => {
    const card = e.target.closest("[data-pick],[role=button]");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); card.click(); }
  });
  el.addEventListener("mouseover", e => { const c = e.target.closest("[data-pick]"); if (c) hoverPreview(c); });
  el.addEventListener("mouseout", e => { const c = e.target.closest("[data-pick]"); if (c && !c.contains(e.relatedTarget)) stopPreview(c); });
  document.addEventListener("keydown", e => {
    if (!visible || !(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== "range") return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); stepHistory(undo, redo); }
    else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); stepHistory(redo, undo); }
  });
  built = true;
  sync(); gallery();
}

async function pick(id) {
  if (id === Themes.draft.id && !Themes.dirty) return;
  if (await Themes.select(id, { ask })) { undo = []; redo = []; Themes.persist(); }
}

/* ---------- undo / redo ---------- */
function snapshot(now) {   // one undo step per burst of changes
  if (!now && Date.now() - undoT < 700) { undoT = Date.now(); return; }
  undoT = Date.now(); undo.push(JSON.stringify(Themes.draft)); if (undo.length > 60) undo.shift(); redo = [];
}
function stepHistory(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(Themes.draft));
  Themes.draft = JSON.parse(from.pop()); Themes.edit(); Themes.apply(Themes.draft); sync(); thumbSoon();
}

/* ---------- keeping the controls in step with the draft ---------- */
function paint() {
  $$("#studio .sl").forEach(l => { const i = l.querySelector("input"), o = l.querySelector("output");
    o.textContent = i.value + o.dataset.u; i.style.setProperty("--v", ((i.value - i.min) / (i.max - i.min) * 100) + "%"); });
  const c = Themes.draft.colors;
  $("#thSky").style.background = `linear-gradient(90deg, ${c.skyTop}, ${c.skyMid} 55%, ${c.skyLow})`;
}
function sync() {
  if (!built) return;
  const d = Themes.draft, root = $("#studio"), sc = Themes.sceneOf(d);
  root.querySelectorAll("[data-k]").forEach(i => { const v = getK(d, i.dataset.k); if (i.type === "checkbox") i.checked = !!v; else if (v != null) i.value = v; });
  root.querySelectorAll("[data-scenes]").forEach(n => {
    n.classList.toggle("hidden", !n.dataset.scenes.split(" ").includes(sc));
    const lab = n.dataset.labels; if (lab) { const m = JSON.parse(lab); n.querySelector(".sl-l").textContent = m[sc] || Object.values(m)[0]; } });
  const labels = COLOR_LABELS[sc] || COLOR_LABELS.minimal;
  root.querySelectorAll(".swatch[data-c]").forEach(s => { const l = labels[s.dataset.c]; s.classList.toggle("hidden", !l); s.querySelector("span").textContent = l || ""; });
  setSeg($("#thScene"), d.scene);
  $("#thSky").classList.toggle("hidden", sc === "image" || sc === "photo");
  const pp = $("#thPhotos"), cur = d.photo && d.photo.src;
  if (pp) { if (!pp.dataset.built) { pp.dataset.built = "1"; pp.innerHTML = PHOTOS.map(p => `<button class="ph-opt" data-th="photo:${p.id}" title="${esc(p.name)} · ${esc(p.photo.credit)}"><span>${esc(p.name)}</span></button>`).join(""); paintPhotoChips(); }
    pp.querySelectorAll(".ph-opt").forEach(b => b.classList.toggle("on", PHOTOS.find(p => "photo:" + p.id === b.dataset.th)?.photo.src === cur)); }
  const cr = $("#thCredit"); if (cr) cr.textContent = d.photo && d.photo.credit ? "Photo: " + d.photo.credit : "";
  $("#thImgCtl").classList.toggle("hidden", !d.image); $("#thNoImg").classList.toggle("hidden", !d.image);
  $("#thName").textContent = d.name;
  const kind = $("#thKind"); kind.textContent = d.builtin ? "Built-in" : "Your theme"; kind.className = "badge" + (d.builtin ? "" : " ok");
  $("#thDirty").classList.toggle("hidden", !Themes.dirty);
  root.querySelector('[data-th="rename"]').disabled = d.builtin;
  root.querySelector('[data-th="delete"]').disabled = d.builtin;
  root.querySelector('[data-th="reset"]').disabled = !Themes.dirty;
  paint();
}

function uniqueName(n) { let name = n, i = 2; while (Themes.all().some(t => t.name.toLowerCase() === name.toLowerCase())) name = `${n} ${i++}`; return name; }
function addCustom(src, name) {
  const t = { ...Themes.clone(src), id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, builtin: false,
    base: src.builtin ? src.id : src.base, seed: src.seed || src.id };
  Themes.doc.custom.push(t); Themes.doc.active = t.id; Themes.draft = Themes.clone(t); Themes.dirty = false;
  Themes.apply(Themes.draft); Themes.persist(); undo = []; redo = []; sync(); gallery();
  return t;
}

async function act(a) {
  const d = Themes.draft;
  if (a === "upload") {
    if (!sky) return toast("Pictures can be added in the Skyline app", true);
    try { const r = await sky.pickBackground(); if (!r) return; snapshot(true); d.image = { ...Themes.IMAGE_DEFAULTS, ...(d.image || {}), url: r.url };
      Themes.edit(); sync(); Themes.apply(d); thumbSoon(); toast("Picture added. Press Save Theme to keep it"); } catch (e) { toast(e.message, true); }
    return;
  }
  if (a === "ownphoto") {
    if (!sky) return;
    try { const r = await sky.pickBackground(); if (!r) return; snapshot(true); d.image = null; d.scene = "photo"; d.photo = { src: r.url, focus: [.5, .5], credit: "Your photo" };
      Themes.edit(); sync(); Themes.apply(d); thumbSoon(); toast("Your photo is alive. Press Save Theme to keep it"); } catch (e) { toast(e.message, true); }
    return;
  }
  if (a.startsWith("photo:")) {
    const p = PHOTOS.find(x => x.id === a.slice(6)); if (!p) return;
    snapshot(true); d.image = null; d.photo = Themes.clone(p.photo); d.scene = "photo"; Themes.edit(); sync(); Themes.apply(d); thumbSoon(); return;
  }
  if (a === "noimg") { snapshot(true); d.image = null; Themes.edit(); sync(); Themes.apply(d); thumbSoon(); return; }
  if (a === "surprise") { snapshot(true); surprise(d); Themes.edit(); sync(); Themes.apply(d); thumbSoon(); return; }
  if (a === "reset") { if (!Themes.dirty) return; Themes.draft = Themes.clone(Themes.find(d.id) || Themes.BUILTIN[0]); Themes.dirty = false;
    Themes.apply(Themes.draft); undo = []; redo = []; sync(); gallery(); return toast("Changes undone"); }
  if (a === "save" && !d.builtin) {
    const i = Themes.doc.custom.findIndex(t => t.id === d.id);
    if (i >= 0) { Themes.doc.custom[i] = Themes.clone(d); Themes.dirty = false; Themes.persist(); sync(); gallery(); return toast(`Saved “${d.name}”`); }
  }
  if (a === "save" || a === "saveas") {
    const suggestion = uniqueName(d.builtin ? `My ${d.name}` : d.name + " copy");
    const name = await dialog({ title: a === "save" ? "Save as your own theme" : "Name your new theme",
      text: a === "save" ? "Built-in themes stay as they are, so your changes become a new theme." : "", input: suggestion, ok: "Save" });
    if (name == null) return;
    const t = addCustom(d, name.slice(0, 40) || suggestion);
    FX.confetti(innerWidth / 2, innerHeight * .3);
    return toast(`Saved “${t.name}”`);
  }
  if (a === "duplicate") {
    if (Themes.dirty && !(await dialog({ title: "Duplicate this theme?", text: "The copy is made from the saved version. Your unsaved changes will be discarded.", ok: "Duplicate" }))) return;
    const t = addCustom(Themes.find(d.id) || d, uniqueName(d.name + " copy"));
    return toast(`Made a copy: “${t.name}”`);
  }
  if (a === "rename" && !d.builtin) {
    const name = await dialog({ title: "Rename theme", input: d.name, ok: "Rename" }); if (!name) return;
    d.name = name.slice(0, 40); const saved = Themes.doc.custom.find(t => t.id === d.id); if (saved) saved.name = d.name;
    Themes.persist(); sync(); gallery(); return;
  }
  if (a === "delete" && !d.builtin) {
    if (!(await dialog({ title: `Delete “${d.name}”?`, text: "This can't be undone.", ok: "Delete", danger: true }))) return;
    Themes.doc.custom = Themes.doc.custom.filter(t => t.id !== d.id); Themes.dirty = false;
    await Themes.select("p-kanda", { quiet: true }); Themes.persist(); gallery(); return toast("Theme deleted");
  }
  if (a === "export") {
    if (!sky) return;
    const out = Themes.clone(d); delete out.builtin;
    if (await sky.exportTheme(out)) toast(`Exported “${d.name}”`);
    return;
  }
  if (a === "import") {
    if (!sky) return;
    const list = await sky.importThemes(); if (!list || !list.length) return;
    let last = null;
    for (const raw of list) {
      const t = Themes.normTheme({ ...raw, id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
      t.builtin = false; t.name = uniqueName(String(raw.name || "Imported theme").slice(0, 40));
      Themes.doc.custom.push(t); last = t;
    }
    await Themes.select(last.id, { quiet: true }); Themes.persist(); gallery();
    return toast(list.length > 1 ? `Imported ${list.length} themes` : `Imported “${last.name}”`);
  }
}

function surprise(d) {  // a random palette that still feels like night
  const h = Math.random(), r = Math.random;
  d.colors = {
    bg: fromHsl(h, .4, .035), skyTop: fromHsl(h, .5, .03), skyMid: fromHsl(h + .03, .5, .13 + r() * .05), skyLow: fromHsl(h + .06 + r() * .06, .55, .3 + r() * .1),
    city: fromHsl(h, .4, .06), window: fromHsl(h + .45 + r() * .15, .85, .76), accent: fromHsl(h + .02, .8, .62), accent2: fromHsl(h + .15 + r() * .2, .8, .6),
  };
  for (const [k, lo, hi] of [["glow", 40, 80], ["comets", 15, 60], ["particles", 15, 55]]) d.fx[k] = Math.round(lo + r() * (hi - lo));
}

/* ---------- gallery: still thumbnails, and a live preview while you hover ---------- */
const thumbs = new Map();  // card id -> rendered still
const keyOf = t => JSON.stringify([t.scene, t.colors, t.fx, t.image, t.photo, t.seed || t.id]);
let queue = [], busy = false, tT = 0;
function gallery() {
  const g = $("#thGallery"); if (!g) return;
  const d = Themes.draft;
  const card = t => `<div class="th-card ${t.id === Themes.doc.active ? "on" : ""}" data-pick="${t.id}" role="button" tabindex="0" title="${esc(t.desc || t.name)}">
      <canvas width="384" height="216"></canvas><span class="nm"><span>${esc(t.id === d.id ? d.name : t.name)}</span>${t.builtin ? "" : "<small>Yours</small>"}</span></div>`;
  const all = Themes.all(), photos = all.filter(t => t.builtin && t.scene === "photo"), rest = all.filter(t => !(t.builtin && t.scene === "photo"));
  g.innerHTML = `<div class="th-sec"><b>Live photos</b><span>Real cities at night. Their lights twinkle and pulse with your music.</span></div>` + photos.map(card).join("")
    + `<div class="th-sec"><b>Yours &amp; Minimal</b><span>Your saved themes, and a clean plain look.</span></div>` + rest.map(card).join("")
    + `<div class="th-card th-new" data-th="saveas" role="button" tabindex="0"><span>＋</span>New theme from this one</div>`;
  queue = $$("#thGallery [data-pick]"); pump();
}
function thumbSoon() { clearTimeout(tT); tT = setTimeout(() => { const c = document.querySelector(`#thGallery [data-pick="${Themes.draft.id}"]`); if (c) { queue.push(c); pump(); } }, 350); }
function themeFor(card) { return card.dataset.pick === Themes.draft.id ? Themes.draft : Themes.find(card.dataset.pick); }
function pump() {
  if (busy || !queue.length || !visible) return;
  busy = true;
  const card = queue.shift(), t = themeFor(card), cv = card.querySelector("canvas");
  const done = () => { busy = false; (window.requestIdleCallback || setTimeout)(pump); };
  if (!t || !cv || card._stop) return done();
  const key = keyOf(t);
  if (cv.dataset.k === key) return done();
  drawThumb(cv, t).then(() => { cv.dataset.k = key; done(); }, done);
}
async function drawThumb(cv, t) {
  const g = cv.getContext("2d"), key = keyOf(t);
  let still = thumbs.get(key);
  if (!still) {
    still = new OffscreenCanvas(cv.width, cv.height); const sg = still.getContext("2d");
    if (t.scene === "photo" && !t.image) {
      await photoReady(t.photo && t.photo.src);
      sg.fillStyle = t.colors.bg; sg.fillRect(0, 0, cv.width, cv.height); sg.drawImage(Scene.thumb(t, cv.width, cv.height), 0, 0);
    } else if (t.image) {
      const img = new Image(); img.src = t.image.url; await img.decode().catch(() => {});
      const i = t.image, k = cv.width / innerWidth;
      if (img.naturalWidth) { sg.save(); sg.filter = `blur(${i.blur * k}px) brightness(${i.brightness}%) contrast(${i.contrast}%)`; sg.globalAlpha = i.opacity / 100;
        const r = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
        sg.drawImage(img, (cv.width - img.naturalWidth * r) / 2, (cv.height - img.naturalHeight * r) / 2, img.naturalWidth * r, img.naturalHeight * r); sg.restore(); }
      sg.globalAlpha = i.overlayAmt / 100; sg.fillStyle = i.overlay; sg.fillRect(0, 0, cv.width, cv.height); sg.globalAlpha = 1;
      if (i.fx) sg.drawImage(Scene.thumb(t, cv.width, cv.height), 0, 0);
    } else {
      sg.fillStyle = t.colors.bg; sg.fillRect(0, 0, cv.width, cv.height);
      sg.globalAlpha = (t.fx.bgOpacity ?? 100) / 100; sg.drawImage(Scene.thumb(t, cv.width, cv.height), 0, 0); sg.globalAlpha = 1;
    }
    thumbs.set(key, still); if (thumbs.size > 40) thumbs.delete(thumbs.keys().next().value);
  }
  g.clearRect(0, 0, cv.width, cv.height); g.drawImage(still, 0, 0);
}
function hoverPreview(card) {
  if (card._stop || Themes.reduceOn()) return;
  const t = themeFor(card); if (!t || t.image || t.scene === "minimal") return;
  if (t.scene === "photo") photoReady(t.photo && t.photo.src);
  const cv = card.querySelector("canvas"); if (!cv) return;
  card._timer = setTimeout(() => {
    const live = document.createElement("canvas"); live.width = cv.width; live.height = cv.height; live.className = "live";
    card.insertBefore(live, cv.nextSibling);
    const stop = Scene.preview(live, t);
    card._stop = () => { stop(); live.remove(); card._stop = null; };
  }, 180);
}
async function paintPhotoChips() {   // little previews of each photo in the picker
  for (const b of $$("#thPhotos .ph-opt")) {
    const p = PHOTOS.find(x => "photo:" + x.id === b.dataset.th); if (!p) continue;
    if (!(await photoReady(p.photo.src))) continue;
    const cv = Scene.thumb(p, 160, 90), c = document.createElement("canvas"); c.width = 160; c.height = 90; c.getContext("2d").drawImage(cv, 0, 0); b.prepend(c);
  }
}
function stopPreview(card) { clearTimeout(card._timer); if (card._stop) card._stop(); }

export const Studio = {
  show(on) {
    visible = on;
    if (on) { if (!built) build(); else { sync(); gallery(); } }
    else $$("#thGallery [data-pick]").forEach(stopPreview);
  },
  refresh() { if (built) { sync(); gallery(); } },
};
Themes.on(what => {
  if (!built || !visible) return;
  if (what === "select") { sync(); gallery(); }
  else if (what === "dirty") { $("#thDirty").classList.toggle("hidden", !Themes.dirty); $("#studio [data-th=reset]").disabled = !Themes.dirty; }
});
