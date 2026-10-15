// The home screen's widgets: clock, weather, system, calendar, focus timer, tasks, notes and links.
import { $, $$, esc, sky, toast, clamp, bytes, store, debounce } from "./util.js";
import { Themes } from "./themes.js";
import { FX } from "./fx.js";

export const Settings = { data: {}, save() { store.write("settings", this.data); } };
const S = () => Settings.data;

/* ---------- clock ---------- */
function greeting(h) { return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : h >= 17 && h < 22 ? "Good evening" : "Late night"; }
export function paintClock() {
  const d = new Date(), h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0"), sec = String(d.getSeconds()).padStart(2, "0"), s = S();
  const hh = s.clock24 ? String(h).padStart(2, "0") : String(h % 12 || 12);
  const shape = `${!!s.seconds}${!!s.clock24}`;
  $$("[data-clock]").forEach(e => {
    if (e.dataset.shape !== shape) {
      e.dataset.shape = shape;
      e.innerHTML = `<span class="hm"><span class="ch"></span><span class="colon">:</span><span class="cm"></span></span>${s.seconds ? `<span class="sec"></span>` : ""}${s.clock24 ? "" : `<span class="ampm"></span>`}`;
    }
    FX.roll(e.querySelector(".ch"), hh); FX.roll(e.querySelector(".cm"), m);
    if (s.seconds) FX.roll(e.querySelector(".sec"), sec);
    const ap = e.querySelector(".ampm"); if (ap) ap.textContent = h < 12 ? "AM" : "PM";
  });
  const greet = greeting(h) + (s.name ? ", " + s.name : "");
  $$("[data-greet]").forEach(e => e.textContent = greet);
  const date = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $$("[data-date]").forEach(e => e.textContent = date);
  document.body.dataset.clockstyle = s.clockStyle || "thin";
}
function clockLoop() { paintClock(); setTimeout(clockLoop, 1000 - new Date().getMilliseconds() + 5); }

/* ---------- weather (Open-Meteo: free, no account) ---------- */
const WICON = {
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>`,
  moon: `<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`,
  partday: `<circle cx="8.5" cy="8.5" r="3.2"/><path d="M8.5 2.5v1.4M3.2 8.5h1.4M4.7 4.7l1 1M12.3 4.7l-1 1"/><path d="M9 19h9a3.5 3.5 0 0 0 .5-6.97A4.8 4.8 0 0 0 9.3 11.4 3.8 3.8 0 0 0 9 19z"/>`,
  partnight: `<path d="M12.5 8.2A4.5 4.5 0 1 1 7 3a3.6 3.6 0 0 0 5.5 5.2z"/><path d="M9 19h9a3.5 3.5 0 0 0 .5-6.97A4.8 4.8 0 0 0 9.3 11.4 3.8 3.8 0 0 0 9 19z"/>`,
  cloud: `<path d="M7 18.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 9.6 4.5 4.5 0 0 0 7 18.5z"/>`,
  rain: `<path d="M7 15.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 6.6 4.5 4.5 0 0 0 7 15.5z"/><path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>`,
  snow: `<path d="M7 15h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 6.1 4.5 4.5 0 0 0 7 15z"/><path d="M8 19h.01M12 20.5h.01M16 19h.01M10 22h.01M14 22h.01" stroke-width="2.6"/>`,
  storm: `<path d="M7 15h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 6.1 4.5 4.5 0 0 0 7 15z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>`,
  fog: `<path d="M4 9h16M6 13h12M4 17h16"/>`,
};
export const wicon = (k, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${WICON[k] || WICON.cloud}</svg>`;
function wmo(code, day) {
  if (code === 0) return ["Clear", day ? "sun" : "moon"];
  if (code <= 2) return [code === 1 ? "Mostly clear" : "Partly cloudy", day ? "partday" : "partnight"];
  if (code === 3) return ["Cloudy", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "rain"];
  if (code >= 61 && code <= 67) return ["Rain", "rain"];
  if (code >= 71 && code <= 77) return ["Snow", "snow"];
  if (code >= 80 && code <= 82) return ["Showers", "rain"];
  if (code === 85 || code === 86) return ["Snow showers", "snow"];
  if (code >= 95) return ["Thunderstorm", "storm"];
  return ["—", "cloud"];
}
let wxAt = 0, wxKey = "", wxData = null;
export async function weather(force) {
  const box = $("#weather"), s = S(); if (!box) return;
  if (!s.city) {
    box.innerHTML = `<div class="w-empty">${wicon("moon")}<div><b>Add your city</b><small>Weather here and in the sky outside. Free, no account.</small></div><button class="btn sm" data-goto="settings:weather">Set city</button></div>`;
    Themes.setWeather(null); return;
  }
  const key = JSON.stringify([s.city, s.units]);
  if (!force && key === wxKey && Date.now() - wxAt < 15 * 60e3) return;
  wxKey = key; wxAt = Date.now();
  const c = s.units === "c";
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${s.city.lat}&longitude=${s.city.lon}`
      + `&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m,precipitation`
      + `&hourly=temperature_2m,weather_code,is_day,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max`
      + `&timezone=auto&forecast_days=6&temperature_unit=${c ? "celsius" : "fahrenheit"}&wind_speed_unit=${c ? "kmh" : "mph"}`;
    const r = await fetch(u); if (!r.ok) throw new Error();
    wxData = await r.json();
    renderWeather();
  } catch (e) {
    wxAt = Date.now() - 13 * 60e3;   // try again in a couple of minutes
    box.innerHTML = `<div class="w-empty">${wicon("cloud")}<div><b>${esc(s.city.name)}</b><small>Weather is unavailable right now. Trying again soon.</small></div></div>`;
  }
}
function renderWeather() {
  const j = wxData, box = $("#weather"), s = S(), c = s.units === "c"; if (!j || !box) return;
  const cur = j.current, [label, ic] = wmo(cur.weather_code, cur.is_day);
  const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric" }), tm = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const nowIdx = Math.max(0, j.hourly.time.findIndex(t => new Date(t) > new Date()) - 1);
  const hours = j.hourly.time.slice(nowIdx, nowIdx + 7).map((t, i) => { const k = nowIdx + i, [, hi] = wmo(j.hourly.weather_code[k], j.hourly.is_day[k]);
    return `<div class="wh"><small>${i ? hourFmt.format(new Date(t)) : "Now"}</small>${wicon(hi)}<b>${Math.round(j.hourly.temperature_2m[k])}°</b>${j.hourly.precipitation_probability[k] >= 30 ? `<i>${j.hourly.precipitation_probability[k]}%</i>` : "<i></i>"}</div>`; }).join("");
  const days = j.daily.time.slice(1, 6).map((t, i) => { const k = i + 1, [, di] = wmo(j.daily.weather_code[k], 1);
    return `<div class="wd"><span>${new Date(t + "T12:00").toLocaleDateString(undefined, { weekday: "short" })}</span>${wicon(di)}<span class="wd-r"><b>${Math.round(j.daily.temperature_2m_max[k])}°</b> ${Math.round(j.daily.temperature_2m_min[k])}°</span></div>`; }).join("");
  box.innerHTML = `<div class="w-top"><span class="w-ic">${wicon(ic)}</span><div class="w-t">${Math.round(cur.temperature_2m)}<sup>°${c ? "C" : "F"}</sup></div>
      <div class="w-l"><b>${esc(label)}</b><small>${esc(s.city.name)}</small></div></div>
    <div class="w-row"><span>H ${Math.round(j.daily.temperature_2m_max[0])}° · L ${Math.round(j.daily.temperature_2m_min[0])}°</span><span>Feels ${Math.round(cur.apparent_temperature)}°</span>
      <span>${Math.round(cur.wind_speed_10m)} ${c ? "km/h" : "mph"}</span><span>${cur.relative_humidity_2m}%</span></div>
    <div class="w-hours">${hours}</div>
    <div class="w-days">${days}</div>
    <div class="w-sun"><span>↑ ${tm(j.daily.sunrise[0])}</span><span>↓ ${tm(j.daily.sunset[0])}</span></div>`;
  const code = cur.weather_code;
  Themes.setWeather({ rain: (code >= 51 && code <= 67) || (code >= 80 && code <= 82), snow: (code >= 71 && code <= 77) || code === 85 || code === 86, storm: code >= 95, fog: code === 45 || code === 48 });
}

/* ---------- system ---------- */
const spark = { cpu: [], rx: [], tx: [] };
let sysT = 0, netPrev = null, netNow = { rx: 0, tx: 0 }, disk = null;
async function pollSystem() {
  clearTimeout(sysT);
  if (!sky || document.hidden || document.body.classList.contains("ambient") || !$("#view-home:not(.hidden)") || !isOn("system")) { if (sky) sky.media.want("sys", false); return; }
  sky.media.want("sys", true);
  try {
    const s = await sky.sys.stats();
    if (s.cpu != null) { push(spark.cpu, s.cpu); setMeter("cpu", s.cpu / 100); FX.count($("#cpuVal"), Math.round(s.cpu), n => Math.round(n) + "%"); }
    const used = s.mem.total - s.mem.free; setMeter("ram", used / s.mem.total, `${bytes(used)} / ${bytes(s.mem.total, 0)}`);
    $("#uptime").textContent = "Up " + upt(s.uptime);
    if (disk) setMeter("disk", 1 - disk.free / disk.total, `${bytes(disk.total - disk.free, 0)} / ${bytes(disk.total, 0)}`);
    if (s.gpu) { $("#gpuRow").classList.remove("hidden"); setMeter("gpu", s.gpu.load / 100, `${s.gpu.load}% · ${s.gpu.temp}°C`); $("#gpuRow").title = `${s.gpu.name}: ${s.gpu.temp}°C, ${s.gpu.load}% busy, ${(s.gpu.memUsed / 1024).toFixed(1)} of ${(s.gpu.memTotal / 1024).toFixed(1)} GB memory`;
      $("#gpuVal").classList.toggle("hot", s.gpu.temp >= 80); }
    $("#netVal").textContent = `↓ ${bytes(netNow.rx)}/s  ↑ ${bytes(netNow.tx)}/s`;
    drawSpark($("#cpuSpark"), spark.cpu, 100); drawSpark($("#netSpark"), spark.rx, null, spark.tx);
    if (navigator.getBattery) { const b = await navigator.getBattery(); const row = $("#batRow");
      if (b && (b.chargingTime !== 0 || b.level < 1 || !b.charging)) { row.classList.remove("hidden"); setMeter("bat", b.level, Math.round(b.level * 100) + "%" + (b.charging ? " ⚡" : "")); } }
  } catch (e) {}
  sysT = setTimeout(pollSystem, 2000);
}
function push(arr, v) { arr.push(v); if (arr.length > 60) arr.shift(); }
function setMeter(id, frac, text) {
  const b = $(`#${id}Bar`), v = $(`#${id}Val`), f = Math.round(clamp(frac, 0, 1) * 200) / 200;   // half a percent is the smallest step you could see
  if (b && b._f !== f) { b._f = f; b.style.transform = `scaleX(${f})`; }
  if (v && text != null && v.textContent !== text) v.textContent = text;
}
function upt(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; }
function drawSpark(cv, data, max, data2) {
  if (!cv || !cv.offsetParent) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement), a1 = css.getPropertyValue("--a1").trim(), a2 = css.getPropertyValue("--a2").trim();
  const m = max || Math.max(1024, ...data, ...(data2 || []));
  const line = (arr, col, fill) => {
    if (arr.length < 2) return;
    g.beginPath(); arr.forEach((v, i) => { const x = w - (arr.length - 1 - i) * (w / 59), y = h - 2 - (v / m) * (h - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
    if (fill) { g.lineTo(w, h); g.lineTo(w - (arr.length - 1) * (w / 59), h); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, col + "55"); gr.addColorStop(1, col + "00"); g.fillStyle = gr; g.fill(); }
  };
  line(data, a1, true); if (data2) line(data2, a2, false);
}

/* ---------- calendar ---------- */
let calMonth = null;
function renderCalendar() {
  const box = $("#calendar"); if (!box) return;
  const now = new Date(); calMonth = calMonth || new Date(now.getFullYear(), now.getMonth(), 1);
  const y = calMonth.getFullYear(), mo = calMonth.getMonth(), first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
  const startDow = (first.getDay() + 6) % 7, names = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
  let cells = names.map(n => `<span class="cal-h">${n}</span>`).join("");
  for (let i = 0; i < startDow; i++) cells += `<span></span>`;
  for (let d = 1; d <= days; d++) { const today = d === now.getDate() && mo === now.getMonth() && y === now.getFullYear(); cells += `<span class="${today ? "today" : ""}">${d}</span>`; }
  box.innerHTML = `<div class="cal-top"><b>${calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b><span class="sp"></span>
    <button class="ibtn" data-cal="-1" title="Previous month">‹</button><button class="ibtn" data-cal="0" title="This month">•</button><button class="ibtn" data-cal="1" title="Next month">›</button></div>
    <div class="cal-grid">${cells}</div>`;
}

/* ---------- focus timer ---------- */
const Focus = {
  mode: "focus", left: 25 * 60, running: false, t: 0, done: 0,
  len() { const s = S(); if (this.mode === "focus" && this.custom) return this.custom; return (this.mode === "focus" ? (s.focusMin || 25) : (s.breakMin || 5)) * 60; },
  // the widget is rebuilt only when something besides the time changes; the countdown itself just updates its numbers
  // (rebuilding twice a second replayed the buttons' animations and could swallow clicks)
  render() {
    const box = $("#focus"); if (!box) return;
    const total = this.len(), p = clamp(1 - this.left / total, 0, 1), m = Math.floor(this.left / 60), s = String(Math.floor(this.left % 60)).padStart(2, "0");
    const R = 42, C = 2 * Math.PI * R;
    const sig = [this.mode, this.running, this.left < total, this.done, S().focusMin, S().breakMin, this.custom].join("|");
    if (sig === this.sig && box.firstChild) return this.paint();
    this.sig = sig;
    box.innerHTML = `<div class="fo-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" class="fo-bg"/><circle cx="50" cy="50" r="${R}" class="fo-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p)}"/></svg>
      <div class="fo-t"><b>${m}:${s}</b><small>${this.mode === "focus" ? "Focus" : "Break"}</small></div></div>
      <div class="fo-side"><div class="seg sm" id="foMode"><button data-v="focus" class="${this.mode === "focus" ? "on" : ""}">Focus</button><button data-v="break" class="${this.mode === "break" ? "on" : ""}">Break</button></div>
      <div class="row"><button class="btn sm primary" data-fo="go">${this.running ? "Pause" : this.left < total ? "Resume" : "Start"}</button><button class="btn sm ghost" data-fo="reset">Reset</button></div>
      <small class="muted">${this.done ? `${this.done} session${this.done > 1 ? "s" : ""} done today` : `${S().focusMin || 25} min focus · ${S().breakMin || 5} min break`}</small></div>`;
    this.paint();
  },
  paint() {
    const box = $("#focus"); if (!box) return;
    const total = this.len(), p = clamp(1 - this.left / total, 0, 1), m = Math.floor(this.left / 60), s = String(Math.floor(this.left % 60)).padStart(2, "0"), C = 2 * Math.PI * 42;
    const t = box.querySelector(".fo-t b"), fg = box.querySelector(".fo-fg"), text = `${m}:${s}`;
    if (t && t.textContent !== text) t.textContent = text;
    if (fg) fg.style.strokeDashoffset = C * (1 - p);
  },
  tick() {
    if (!this.running) return;
    this.left = Math.max(0, this.endAt - Date.now()) / 1000;
    if (this.left <= 0) {
      this.running = false; chime();
      if (this.mode === "focus") { this.done++; this.custom = 0; this.mode = "break"; if (sky) sky.app.notify({ title: "Focus session done", body: "Time for a short break." }); }
      else { this.mode = "focus"; if (sky) sky.app.notify({ title: "Break's over", body: "Ready for another focus session?" }); }
      this.left = this.len();
    }
    this.render();
  },
  go() { if (this.running) { this.running = false; } else { this.running = true; this.endAt = Date.now() + this.left * 1000; } this.render(); },
};
function chime() {  // a soft two-note bell, made on the spot
  try {
    const ctx = new AudioContext(), now = ctx.currentTime;
    for (const [f, t] of [[880, 0], [1318.5, .18]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + t); g.gain.linearRampToValueAtTime(.18, now + t + .02); g.gain.exponentialRampToValueAtTime(.0001, now + t + 1.6);
      o.connect(g).connect(ctx.destination); o.start(now + t); o.stop(now + t + 1.7);
    }
    setTimeout(() => ctx.close(), 2200);
  } catch (e) {}
}

/* ---------- tasks + notes ---------- */
let tasks = [];
function renderTasks() {
  const box = $("#taskList"); if (!box) return;
  box.innerHTML = tasks.length ? tasks.map((t, i) => `<label class="task ${t.done ? "done" : ""}"><input type="checkbox" data-task="${i}" ${t.done ? "checked" : ""}><span class="tk"></span>
    <span class="tx">${esc(t.text)}</span><button class="ibtn" data-tdel="${i}" title="Remove">✕</button></label>`).join("") : `<div class="muted" style="padding:4px 2px">Nothing to do. Enjoy the view.</div>`;
  const left = tasks.filter(t => !t.done).length; $("#taskCount").textContent = tasks.length ? `${left} left` : "";
}
const saveTasks = () => store.write("tasks", tasks);

/* ---------- quick links ---------- */
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
export function renderLinks() {
  const box = $("#links"); if (!box) return;
  const links = (S().links || []).filter(l => l.url);
  box.innerHTML = links.map((l, i) => `<button class="lk" data-link="${i}" title="${esc(l.url)}"><span class="lk-i" data-host="${esc(host(l.url))}">${esc((l.name || host(l.url) || "?").trim()[0] || "?")}</span><span>${esc(l.name || host(l.url))}</span></button>`).join("")
    || `<div class="muted">Add your favourite sites in Settings.</div>`;
  // links that open an installed app get a small badge
  if (sky && sky.links) sky.links.apps(links).then(apps => apps.forEach((a, i) => { const b = $(`#links [data-link="${i}"]`); if (b && a) { b.classList.add("app"); b.title = `Opens the ${a} app`; } })).catch(() => {});
  if (sky) $$("#links [data-host]").forEach(async e => {
    const h = e.dataset.host; if (!h) return;
    const url = await sky.favicon(h).catch(() => null);
    if (url) { const img = new Image(); img.onload = () => { e.textContent = ""; e.appendChild(img); e.classList.add("img"); }; img.src = url; }
  });
}

/* ---------- countdown: birthdays, game releases, the last day of school ---------- */
function nextDate(c) {   // the next time this date comes round (yearly ones roll over)
  const [y, m, d] = String(c.date || "").split("-").map(Number); if (!y) return 0;
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let t = new Date(y, m - 1, d).getTime();
  if (c.yearly) { t = new Date(now.getFullYear(), m - 1, d).getTime(); if (t < today) t = new Date(now.getFullYear() + 1, m - 1, d).getTime(); }
  return t;
}
export function renderCountdown() {
  const box = $("#countdown"); if (!box) return;
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const list = (S().countdowns || []).map((c, i) => ({ ...c, i, t: nextDate(c) })).filter(c => c.t && c.t >= today).sort((a, b) => a.t - b.t);
  const form = `<form class="cd-form ${S().cdForm ? "" : "hidden"}" id="cdForm"><input name="name" placeholder="What's coming? e.g. My birthday" maxlength="40" autocomplete="off">
    <div class="row"><input name="date" type="date" required><label class="cd-y"><input type="checkbox" name="yearly"> Every year</label><button class="btn xs primary">Add</button></div></form>`;
  if (!list.length) { box.innerHTML = form + `<div class="muted">Count down to a birthday, a game release or the last day of school. Press ＋.</div>`; return; }
  const days = t => Math.round((t - today) / 864e5);
  const [first, ...rest] = list, d0 = days(first.t);
  box.innerHTML = form + `<div class="cd-main"><b>${d0 === 0 ? "🎉" : d0}</b><span>${d0 === 0 ? "It's today!" : d0 === 1 ? "day to go" : "days to go"}</span></div>
    <div class="cd-name">${esc(first.name || "Countdown")} <small>${new Date(first.t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</small><button class="ibtn xs" data-cddel="${first.i}" title="Remove">✕</button></div>`
    + rest.slice(0, 3).map(c => `<div class="cd-row"><span>${esc(c.name || "Countdown")}</span><b>${days(c.t) === 0 ? "today" : days(c.t) + " d"}</b><button class="ibtn xs" data-cddel="${c.i}" title="Remove">✕</button></div>`).join("");
}
function countdownEvents() {
  $("#cdAddBtn").onclick = () => { S().cdForm = !S().cdForm; renderCountdown(); if (S().cdForm) $("#cdForm input[name=name]").focus(); };
  $("#countdown").addEventListener("submit", e => {
    e.preventDefault(); const f = e.target, date = f.date.value; if (!date) return;
    S().countdowns = (S().countdowns || []).concat({ name: f.name.value.trim().slice(0, 40), date, yearly: f.yearly.checked }).slice(-20); S().cdForm = false;
    Settings.save(); renderCountdown();
  });
  $("#countdown").addEventListener("click", e => { const b = e.target.closest("[data-cddel]"); if (!b) return; S().countdowns.splice(+b.dataset.cddel, 1); Settings.save(); renderCountdown(); });
  setInterval(renderCountdown, 30 * 60e3);   // the day ticks over
}

/* ---------- which widgets show, and in what order ---------- */
export const WIDGETS = [["weather", "Weather"], ["system", "System"], ["links", "Quick links"], ["countdown", "Countdown"], ["calendar", "Calendar"], ["focus", "Focus timer"], ["tasks", "Tasks"], ["notes", "Notes"]];
export function isOn(id) { const w = S().widgets; return !w || w[id] !== false; }
export function layoutWidgets() {
  const col = $("#widgets"); if (!col) return;
  const order = S().widgetOrder || WIDGETS.map(w => w[0]);
  for (const id of [...order, ...WIDGETS.map(w => w[0]).filter(x => !order.includes(x))]) { const el = col.querySelector(`[data-widget="${id}"]`); if (el) col.appendChild(el); }
  $$("#widgets [data-widget]").forEach(el => el.classList.toggle("hidden", !isOn(el.dataset.widget)));
}
function dragReorder() {   // drag a widget by its title to move it
  const col = $("#widgets"); let dragged = null;
  col.addEventListener("dragstart", e => { const w = e.target.closest("[data-widget]"); if (!w) return; dragged = w; w.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
  col.addEventListener("dragend", () => { if (!dragged) return; dragged.classList.remove("dragging"); dragged = null;
    S().widgetOrder = $$("#widgets [data-widget]").map(w => w.dataset.widget); Settings.save(); });
  col.addEventListener("dragover", e => { if (!dragged) return; e.preventDefault();
    const after = $$("#widgets [data-widget]:not(.dragging):not(.hidden)").find(w => { const r = w.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) col.insertBefore(dragged, after); else col.appendChild(dragged); });
}

export const Widgets = {
  async init() {
    clockLoop();
    tasks = (await store.read("tasks")) || [];
    renderTasks(); renderLinks(); renderCalendar(); renderCountdown(); countdownEvents(); Focus.render(); layoutWidgets(); dragReorder();
    $("#notes").value = S().notes || "";
    $("#notes").addEventListener("input", debounce(e => { S().notes = e.target.value; Settings.save(); }, 400));
    $("#taskForm").addEventListener("submit", e => { e.preventDefault(); const i = $("#taskIn"), v = i.value.trim(); if (!v) return;
      tasks.unshift({ text: v.slice(0, 140), done: false, at: Date.now() }); i.value = ""; saveTasks(); renderTasks(); });
    $("#taskList").addEventListener("change", e => { const i = e.target.dataset.task; if (i == null) return; tasks[+i].done = e.target.checked; saveTasks(); renderTasks(); });
    $("#taskList").addEventListener("click", e => { const b = e.target.closest("[data-tdel]"); if (!b) return; e.preventDefault(); tasks.splice(+b.dataset.tdel, 1); saveTasks(); renderTasks(); });
    $("#taskClear").onclick = () => { tasks = tasks.filter(t => !t.done); saveTasks(); renderTasks(); };
    $("#calendar").addEventListener("click", e => { const b = e.target.closest("[data-cal]"); if (!b) return; const d = +b.dataset.cal;
      calMonth = d ? new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1) : null; renderCalendar(); });
    $("#focus").addEventListener("click", e => {
      const b = e.target.closest("[data-fo]"), m = e.target.closest("#foMode button");
      if (m && !Focus.running) { Focus.mode = m.dataset.v; Focus.left = Focus.len(); Focus.render(); }
      if (b && b.dataset.fo === "go") Focus.go();
      if (b && b.dataset.fo === "reset") { Focus.running = false; Focus.custom = 0; Focus.left = Focus.len(); Focus.render(); }
    });
    $("#links").addEventListener("click", e => { const b = e.target.closest("[data-link]"); if (!b) return; const l = (S().links || []).filter(x => x.url)[+b.dataset.link];
      if (l && sky) sky.links.open(l.url, l.name).catch(() => sky.openUrl(l.url)); else if (l) window.open(l.url); });
    if (sky) sky.sys.onNet(n => {
      if (netPrev) { const dt = Math.max(.5, (n.t - netPrev.t) / 1000); netNow = { rx: Math.max(0, (n.rx - netPrev.rx) / dt), tx: Math.max(0, (n.tx - netPrev.tx) / dt) }; push(spark.rx, netNow.rx); push(spark.tx, netNow.tx); }
      netPrev = n; disk = { total: n.diskTotal, free: n.diskFree };
    });
    setInterval(() => Focus.tick(), 500);
    setInterval(() => weather(), 5 * 60e3);
    setInterval(() => { const n = new Date(); if (n.getHours() === 0 && n.getMinutes() === 0) renderCalendar(); }, 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { weather(); pollSystem(); } });
    weather(); pollSystem();
  },
  onView(v) { if (v === "home") { pollSystem(); renderCalendar(); } else pollSystem(); },
  refresh() { paintClock(); weather(true); renderLinks(); layoutWidgets(); Focus.render(); pollSystem(); },
  weatherNow: () => weather(true),
  pollSystem,
  // for the assistant
  weatherText() {
    const j = wxData, s = S(); if (!j || !s.city) return "";
    const cur = j.current, [label] = wmo(cur.weather_code, cur.is_day), u = s.units === "c" ? "°C" : "°F";
    const rain = Math.max(...j.hourly.precipitation_probability.slice(0, 12));
    return `${label.toLowerCase()} and ${Math.round(cur.temperature_2m)}${u} in ${s.city.name} (feels like ${Math.round(cur.apparent_temperature)}), today ${Math.round(j.daily.temperature_2m_max[0])} high, ${Math.round(j.daily.temperature_2m_min[0])} low${rain >= 40 ? `, ${rain}% chance of rain later` : ""}.`;
  },
  addTask(text) { tasks.unshift({ text: String(text).slice(0, 140), done: false, at: Date.now() }); saveTasks(); renderTasks(); },
  timer(minutes, stop) {
    if (stop) { Focus.running = false; Focus.left = Focus.len(); Focus.render(); return; }
    Focus.mode = "focus"; Focus.running = false; Focus.custom = minutes > 0 ? minutes * 60 : 0; Focus.left = Focus.len(); Focus.go();
  },
};
