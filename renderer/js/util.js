// Small helpers shared by every part of Skyline's interface.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sky = window.sky || null;   // the app bridge (absent only when opened in a plain browser)

export function toast(msg, bad) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.style.setProperty("--tdur", (bad ? 5 : 2.6) + "s"); t.className = "toast"; void t.offsetWidth; t.className = "toast on" + (bad ? " bad" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = "toast", bad ? 5000 : 2600);
}

// An in-app dialog. Resolves true/false, or the typed text (null when cancelled) when `input` is given.
export function dialog({ title, text = "", input = null, ok = "OK", cancel = "Cancel", danger = false, html = "", secret = false }) {
  return new Promise(resolve => {
    const m = $("#dlg"), asks = input != null;
    m.innerHTML = `<div class="dlg-box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}${html}
      ${asks ? `<input class="dlg-in" ${secret ? 'type="password" maxlength="72" autocomplete="new-password"' : 'maxlength="40"'} value="${esc(input)}" spellcheck="false">` : ""}
      <div class="dlg-acts">${cancel ? `<button class="btn ghost" data-r="0">${esc(cancel)}</button>` : ""}<button class="btn ${danger ? "danger-solid" : "primary"}" data-r="1">${esc(ok)}</button></div></div>`;
    m.classList.remove("hidden");
    const inp = m.querySelector(".dlg-in");
    (inp || m.querySelector('[data-r="1"]')).focus(); if (inp) inp.select();
    const done = yes => { m.classList.add("hidden"); m.onclick = null; document.removeEventListener("keydown", key, true);
      resolve(asks ? (yes ? inp.value.trim() : null) : yes); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done(false); } else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); done(true); } };
    document.addEventListener("keydown", key, true);
    m.onclick = e => { const b = e.target.closest("[data-r]"); if (b) done(b.dataset.r === "1"); else if (e.target === m) done(false); };
  });
}

// Runs fn(now) about `fps` times a second (a timer, then one animation frame), never at the monitor's full rate.
export function fpsLoop(fps, fn) {
  let t = 0, r = 0, stopped = false;
  const tick = now => { if (stopped) return; fn(now); if (!stopped) t = setTimeout(() => { r = requestAnimationFrame(tick); }, Math.max(0, 1000 / fps - 6)); };
  r = requestAnimationFrame(tick);
  return () => { stopped = true; clearTimeout(t); cancelAnimationFrame(r); };
}

export function setSeg(root, value) { if (root) root.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(value))); }
export function debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const mmss = t => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
export const bytes = (b, d = 1) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return b.toFixed(i ? d : 0) + " " + u[i]; };

/* ---------- colour ---------- */
export const rgb = h => { h = String(h || "#000").replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); const n = parseInt(h.slice(0, 6), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const hex = c => "#" + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
export function toHsl(h) {
  const [r, g, b] = (Array.isArray(h) ? h : rgb(h)).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let hh = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    hh = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6; }
  return [hh, s, l];
}
export function fromHsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
export const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
// text on an accent-coloured button: white or near-black, whichever reads better
export const onAccent = hex => { const L = lum(hex); return 1.05 / (L + .05) >= (L + .05) / .054 ? "#ffffff" : "#0b0c10"; };
export const mixHex = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
export const rgba = (h, a) => `rgba(${rgb(h).join(",")},${+a.toFixed(3)})`;

// The most vivid colours of a picture (album covers): [main, second], brightened enough to glow.
export function palette(img) {
  try {
    const c = document.createElement("canvas"); c.width = c.height = 28;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 28, 28);
    const d = g.getImageData(0, 0, 28, 28).data, buckets = {};
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = toHsl([d[i], d[i + 1], d[i + 2]]);
      if (l < .1 || l > .93 || s < .18) continue;
      const k = Math.round(h * 12) % 12, w = s * (1 - Math.abs(l - .55)), b = buckets[k] = buckets[k] || { k, w: 0, r: 0, g: 0, b: 0 };
      b.w += w; b.r += d[i] * w; b.g += d[i + 1] * w; b.b += d[i + 2] * w;
    }
    const best = Object.values(buckets).sort((a, b) => b.w - a.w);
    if (!best.length || best[0].w < 2) return null;
    const pick = b => { const [h, s, l] = toHsl([b.r / b.w, b.g / b.w, b.b / b.w]); return fromHsl(h, Math.max(s, .55), clamp(l, .55, .7)); };
    const second = best.find(b => Math.min(Math.abs(b.k - best[0].k), 12 - Math.abs(b.k - best[0].k)) >= 2 && b.w > best[0].w * .2);
    const main = pick(best[0]);
    return [main, second ? pick(second) : fromHsl(toHsl(main)[0] + .12, .6, .62)];
  } catch (e) { return null; }
}

/* ---------- saved data (in the app's data folder; this window keeps a copy for an instant start) ---------- */
export const store = {
  cached(name) { try { return JSON.parse(localStorage.getItem("sky-" + name)); } catch (e) { return null; } },
  async read(name) {
    if (!sky) return this.cached(name);
    try { const v = await sky.store.read(name); if (v != null) localStorage.setItem("sky-" + name, JSON.stringify(v)); return v; } catch (e) { return this.cached(name); }
  },
  write(name, data) {
    try { localStorage.setItem("sky-" + name, JSON.stringify(data)); } catch (e) {}
    clearTimeout(this["t" + name]);
    this["t" + name] = setTimeout(() => { if (sky) sky.store.write(name, data).catch(e => toast("Couldn't save: " + e.message, true)); }, 350);
  },
  local(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem("sky-ui-" + k)); localStorage.setItem("sky-ui-" + k, JSON.stringify(v)); } catch (e) { return null; } },
};
