// Skyline on a phone: Home (your city photo, the time, messages and what's due), Social (the same code as the PC
// app) one screen at a time, School (the summary your PC's Skyline keeps on your account), Settings, and Admin
// (only for Skyline's owner). Installable from the browser: "Add to Home Screen".
import { $, $$, esc, toast } from "./util.js";
import { Social } from "./social/social.js";
import { S, on, avatar, statusOf, subline } from "./social/state.js";
import { api } from "./social/api.js";
import { Music } from "./music.js";
import { Weather, wicon, wmo } from "./weather.js";
import { Direct } from "./classroom.js";
import { icon } from "./social/icons.js";

const store = { get(k, d) { try { const v = localStorage.getItem("sky-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sky-" + k, JSON.stringify(v)); } catch (e) {} } };
const day = 864e5;
let current = "home";

/* ---------- backgrounds: Skyline's city photos ---------- */
const PHOTOS = [["your-view", "The View"], ["kanda", "Kanda Night"], ["akiba", "Akihabara Overhead"], ["kiyosu", "Midnight Avenue"], ["umeda", "Behind the Glass"],
  ["osaka", "Osaka Blue Hour"], ["shinjuku", "Shinjuku Deck"], ["seoul", "Seoul From the Top"], ["tokyoair", "Tokyo Night Flight"]];
const bg = () => { const b = store.get("bg", "osaka"); return b === "none" || PHOTOS.some(p => p[0] === b) ? b : "osaka"; };
// the PC app's own "blue hour" grade (scene/engine.js), with each photo's own strength and brightness, so the
// phone's photos look exactly like the PC's: shadows deep navy, mid-tones blue, highlights icy, neon keeps some colour
const GRADE = { "your-view": [30, 112], kanda: [62, 122], akiba: [60, 108], kiyosu: [62, 124], umeda: [45, 100], osaka: [40, 100], shinjuku: [58, 110], seoul: [60, 120], tokyoair: [55, 122] };
const BLUE = { bg: [3, 6, 14], skyTop: [7, 26, 56], skyMid: [19, 64, 126], skyLow: [63, 134, 214], window: [191, 227, 255] };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const LUT = (() => {
  const stops = [[0, mixc(BLUE.bg, [0, 0, 0], .5)], [.22, BLUE.skyTop], [.45, BLUE.skyMid], [.7, BLUE.skyLow], [.86, mixc(BLUE.window, [255, 255, 255], .2)], [1, [246, 250, 255]]], lut = new Uint8Array(768);
  for (let v = 0; v < 256; v++) { const L = v / 255; let k = 0; while (k < stops.length - 2 && L > stops[k + 1][0]) k++;
    const [l0, c0] = stops[k], [l1, c1] = stops[k + 1], t = Math.min(1, Math.max(0, (L - l0) / (l1 - l0))), c = mixc(c0, c1, t * t * (3 - 2 * t)); lut[v * 3] = c[0]; lut[v * 3 + 1] = c[1]; lut[v * 3 + 2] = c[2]; }
  return lut;
})();
const graded = new Map();   // file -> a blob: URL of the graded picture (made once per open)
function grade(file, key) {
  if (graded.has(file)) return graded.get(file);
  const p = new Promise(ok => {
    const img = new Image(); img.onerror = () => ok(file);
    img.onload = () => {
      try {
        const [g0, br] = GRADE[key] || [50, 110], g = g0 / 100, cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0);
        const im = cx.getImageData(0, 0, cv.width, cv.height), d = im.data, bm = br / 100, ct = (104 + g * 10) / 100, amt = Math.min(1, g * 1.25);
        for (let i = 0; i < d.length; i += 4) {
          // brightness, then contrast (what the PC does with a canvas filter, which iPhones don't have), then the grade
          let r = ((d[i] * bm / 255 - .5) * ct + .5) * 255, gc = ((d[i + 1] * bm / 255 - .5) * ct + .5) * 255, b = ((d[i + 2] * bm / 255 - .5) * ct + .5) * 255;
          r = r < 0 ? 0 : r > 255 ? 255 : r; gc = gc < 0 ? 0 : gc > 255 ? 255 : gc; b = b < 0 ? 0 : b > 255 ? 255 : b;
          const L = (.2126 * r + .7152 * gc + .0722 * b) | 0, sat = (Math.max(r, gc, b) - Math.min(r, gc, b)) / 255, keep = L > 150 ? Math.min(.6, sat * 1.4 * (L - 150) / 105) : 0, a = amt * (1 - keep), o = L * 3;
          d[i] = r + (LUT[o] - r) * a; d[i + 1] = gc + (LUT[o + 1] - gc) * a; d[i + 2] = b + (LUT[o + 2] - b) * a;
        }
        cx.putImageData(im, 0, 0);
        cv.toBlob(bl => ok(bl ? URL.createObjectURL(bl) : file), "image/jpeg", .9);
      } catch (e) { ok(file); }
    };
    img.src = file;
  });
  graded.set(file, p); return p;
}
async function applyBg() { const b = bg(); $("#mSky").style.backgroundImage = b === "none" ? "" : `url("${await grade(`img/bg/${b}.jpg`, b)}")`; document.body.classList.toggle("m-photo", b !== "none"); }

/* ---------- Social: the list, or one conversation ---------- */
// on a phone only one thing fits: the list (servers, channels, chats), or what you opened from it
let backTo = null;   // (opened from Settings or Home: Back returns there)
on((what, v) => { if (what === "view") { document.body.classList.add("m-main"); document.body.classList.toggle("m-set", !!(v && v.kind === "settings" && backTo === "settings")); } });
function back() {
  document.body.classList.remove("m-main", "m-set");
  if (backTo) { const t = backTo; backTo = null; show(t); }
}
function backButton() {
  const main = $("#sxMain"); if (!main || main.querySelector(".m-back")) return;
  const b = document.createElement("button"); b.className = "m-back"; b.setAttribute("aria-label", "Back");
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>`;
  b.onclick = back; main.appendChild(b);
}
new MutationObserver(backButton).observe(document.body, { childList: true, subtree: true });
// the phone's own back gesture / button closes the conversation instead of leaving Skyline
history.replaceState({ m: "list" }, "");
on(what => { if (what === "view" && history.state && history.state.m !== "main") history.pushState({ m: "main" }, ""); });
addEventListener("popstate", () => { if (document.body.classList.contains("m-main")) back(); });
// open something in Social from another tab (a chat from Home, a settings page from Settings)
function openSocial(view, from) { show("social"); backTo = from; Social.open(view); }

// press and hold a message for its menu (phones have no right-click)
let holdT = 0, holdXY = null;
document.addEventListener("touchstart", e => {
  const row = e.target.closest(".sx-msg, [data-cid], [data-srv], [data-fid]"); if (!row || e.touches.length !== 1) return;
  const t = e.touches[0]; holdXY = [t.clientX, t.clientY];
  holdT = setTimeout(() => { holdT = 0; row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: holdXY[0], clientY: holdXY[1] })); if (navigator.vibrate) navigator.vibrate(12); }, 480);
}, { passive: true });
const cancelHold = e => { if (!holdT) return; if (e.type === "touchmove") { const t = e.touches[0]; if (Math.hypot(t.clientX - holdXY[0], t.clientY - holdXY[1]) < 10) return; } clearTimeout(holdT); holdT = 0; };
["touchend", "touchmove", "touchcancel"].forEach(k => document.addEventListener(k, cancelHold, { passive: true }));
// screen sharing only where the browser can do it (phones mostly can't)
if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent)) document.body.classList.add("can-share");

/* ---------- tabs ---------- */
function show(view) {
  if (view === "admin" && !(S.me && S.isAdmin)) view = "home";
  current = view;
  document.body.classList.remove("m-main", "m-set");
  document.body.dataset.tab = view;
  $$(".m-tabs .rbtn").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".m-app > .view").forEach(s => s.classList.toggle("hidden", s.id !== "view-" + view));
  Social.show(view === "social");
  if (view === "home") Home.render();
  if (view === "home") Music.start(); else Music.stop();   // (only asks Spotify while Home is on screen)
  if (view === "school") School.render();
  if (view === "settings") Settings.render();
  if (view === "admin") Social.showAdmin();
}
$$(".m-tabs .rbtn").forEach(b => b.onclick = () => { backTo = null; show(b.dataset.view); });
document.addEventListener("sky:goto", () => show("social"));

/* ---------- School data (from your PC's Skyline), shared by Home and School ---------- */
const School = {
  data: null, at: 0, who: null, tab: "due", link: null, linkErr: "", asked: 0, poll: 0, direct: null, dErr: "", dBusy: false,
  async load(force) {
    if (!S.me) return null;
    if (this.who !== S.me.id) { this.data = null; this.who = S.me.id; }   // (another account signed in: never show the last one's)
    if (force || !this.data || Date.now() - this.at > 60000) { const r = await api.rpc("get_school"); this.data = r || {}; this.at = Date.now(); }
    return this.data;
  },
  // "Connect Classroom on your PC": what your PC's Skyline last said, and whether it's running
  async loadLink() { try { this.link = await api.rpc("school_link_status"); this.linkErr = ""; } catch (e) { this.linkErr = e.message; } return this.link; },
  linkState() {
    const L = this.link; if (!L) return { k: "unknown" };
    const now = L.now ? Date.parse(L.now) : Date.now(), seen = L.pc_seen ? Date.parse(L.pc_seen) : 0, on = seen && now - seen < 150e3;
    const pending = L.request_id > L.handled_id && L.request_at && now - Date.parse(L.request_at) < 10 * 60e3;
    if (pending) return on ? { k: "waiting", t: "Waiting for your PC…", s: "Skyline on your PC is opening Google's sign-in." }
      : { k: "off", t: "Your PC's Skyline is off", s: "Turn on your PC and open Skyline. It picks this up if you do it in the next 10 minutes." };
    if (!on) return { k: "off", t: "Your PC's Skyline is off", s: seen ? `Last seen ${when(seen).toLowerCase()} at ${new Date(seen).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "Open Skyline on your PC, signed in with this account." };
    if (L.pc_state === "signing_in") return { k: "signin", t: "Sign in on your PC", s: "Google's sign-in window is open on your PC. Type your school password there." };
    if (L.pc_state === "connected") return { k: "ok", t: "Connected on your PC", s: "Your PC reads Classroom every few minutes and sends it here." };
    if (L.pc_state === "expired") return { k: "need", t: "Sign-in needed", s: "Your school sign-in ran out on your PC. Tap below and sign in again there." };
    if (L.pc_state === "error") return { k: "need", t: "Classroom had a problem on your PC", s: L.pc_note || "Try again." };
    return { k: "none", t: "Classroom isn't connected", s: "Tap below and sign in to Google on your PC." };
  },
  linkCard() {
    const st = this.linkState(), dir = this.direct, cid = Direct.client;
    if (dir) return `<section class="m-card m-cr"><header><span class="m-cr-i ok">${icon("check")}</span><h2>Connected on this phone</h2></header>
      <p class="m-muted">Read from Google Classroom ${esc(when(dir.at).toLowerCase())} at ${esc(new Date(dir.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}. Google lets this phone read for an hour at a time.</p>
      ${this.dErr ? `<p class="m-cr-err">${esc(this.dErr)}</p>` : ""}
      <div class="m-cr-row"><button class="btn sm primary" data-cr="direct" ${this.dBusy ? "disabled" : ""}>${icon("refresh")}${this.dBusy ? "Reading…" : "Refresh"}</button><button class="btn sm ghost" data-cr="forget">Disconnect</button></div></section>`;
    if (st.k === "ok" && !this.dErr) return `<section class="m-card m-cr slim"><span class="m-cr-i ok">${icon("check")}</span><span class="t"><b>${st.t}</b><small>${st.s}</small></span><button class="btn sm" data-cr="ask">Update</button></section>`;
    const busy = st.k === "waiting" || st.k === "signin";
    return `<section class="m-card m-cr"><header><span class="m-cr-i ${st.k === "off" || st.k === "need" ? "warn" : busy ? "busy" : ""}">${busy ? `<span class="sx-spin"></span>` : icon(st.k === "off" ? "screen" : st.k === "need" ? "alert" : "link")}</span><h2>${esc(st.t || "Google Classroom")}</h2></header>
      <p class="m-muted">${esc(st.s || "")}</p>${this.linkErr ? `<p class="m-cr-err">${esc(this.linkErr)}</p>` : ""}
      <div class="m-cr-row"><button class="btn sm primary" data-cr="ask" ${busy ? "disabled" : ""}>${icon("screen")}${st.k === "need" ? "Sign in again on your PC" : "Connect on your PC"}</button>
      ${cid ? `<button class="btn sm" data-cr="direct" ${this.dBusy ? "disabled" : ""}>${this.dBusy ? "Connecting…" : "Connect on this phone"}</button>` : ""}</div>
      ${this.dErr ? `<p class="m-cr-err">${esc(this.dErr)}</p>` : ""}
      <p class="m-cr-note">Connect on your PC works only while Skyline is running on your PC. You type your password in Google's own window there.</p></section>`;
  },
  // check often while something is happening, otherwise now and then
  watch() {
    clearTimeout(this.poll); if (current !== "school" || !S.me) return;
    const k = this.linkState().k, quick = k === "waiting" || k === "signin" || Date.now() - this.asked < 120e3;
    this.poll = setTimeout(async () => {
      const was = JSON.stringify(this.linkState()); await this.loadLink();
      if (Date.now() - this.asked < 180e3) await this.load(true).catch(() => {});   // (the PC sends a fresh summary a few seconds after it connects)
      if (current === "school" && (JSON.stringify(this.linkState()) !== was || Date.now() - this.asked < 180e3)) this.render(); else this.watch();
    }, quick ? 3000 : 20000);
  },
  async act(a) {
    if (a === "ask") { try { this.link = await api.rpc("school_connect_request"); this.asked = Date.now(); this.linkErr = ""; } catch (e) { this.linkErr = e.message; } return this.render(); }
    if (a === "forget") { Direct.forget(); this.direct = null; this.dErr = ""; return this.render(); }
    if (a === "direct") {
      this.dBusy = true; this.dErr = ""; this.render();
      try { const snap = await Direct.read(S.me.id); this.direct = { at: snap.at, snap }; }
      catch (e) { this.dErr = e.message; if (e.blocked) { Direct.forget(); this.direct = null; } }
      this.dBusy = false; return this.render();
    }
  },
  async render() {
    const el = $("#mSchool");
    if (!S.me) { el.innerHTML = signInFirst("Your grades and homework come from your PC's Skyline, through your Skyline account."); return; }
    if (!this.data) el.innerHTML = `<div class="m-s-empty"><span class="sx-spin"></span></div>`;
    try { await Promise.all([this.load(), this.link ? null : this.loadLink(), Direct.clientId()]); } catch (e) { if (!this.data) { el.innerHTML = `<div class="m-s-empty"><b>Couldn't load your school</b><p>${esc(e.message)}</p></div>`; return; } }
    if (current !== "school") return;
    const saved = Direct.saved(S.me.id); this.direct = saved ? { at: saved.at, snap: saved.snap } : null;
    const card = this.linkCard();
    el.onclick = e => { const b = e.target.closest("[data-cr]"); if (b) this.act(b.dataset.cr); };
    this.watch();
    const fromPhone = this.direct && (!this.data.updated_at || this.direct.at > Date.parse(this.data.updated_at));
    const d = fromPhone ? this.direct.snap : (this.data && this.data.data) || null;
    if (!d) { el.innerHTML = `<header class="m-s-head"><h1>School</h1></header>${card}<div class="m-s-empty sm"><b>Nothing here yet</b><p>Once Classroom is connected, your classes, grades and homework show up here.</p></div>`; return; }
    const upd = fromPhone ? this.direct.at : Date.parse(this.data.updated_at);
    const due = d.due || [], grades = d.grades || [], classes = (d.classes || []).filter(c => c.avg != null);
    const late = due.filter(x => x.late).length, soon = due.filter(x => !x.late && x.when - Date.now() < 2 * day).length;
    el.innerHTML = `<header class="m-s-head"><h1>School</h1><small>Updated ${esc(when(upd))} at ${esc(new Date(upd).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} ${fromPhone ? "from Google Classroom" : "from your PC"}</small></header>${card}
      <div class="m-s-stats"><div><b style="color:${d.overall != null ? color(d.overall) : "inherit"}">${d.overall != null ? d.overall.toFixed(1) + "%" : "–"}</b><span>Overall</span></div><div><b>${d.gpa != null ? d.gpa.toFixed(2) : "–"}</b><span>GPA</span></div><div><b class="${late ? "bad" : ""}">${late}</b><span>Overdue</span></div><div><b>${soon}</b><span>Due soon</span></div></div>
      <div class="seg m-s-seg"><button class="${this.tab === "due" ? "on" : ""}" data-st="due">Due</button><button class="${this.tab === "grades" ? "on" : ""}" data-st="grades">Grades</button><button class="${this.tab === "classes" ? "on" : ""}" data-st="classes">Classes</button></div>
      <div class="m-s-list">${this.tab === "due" ? (due.length ? due.map(dueRow).join("") : `<p class="sx-none">Nothing due in the next three weeks.</p>`)
        : this.tab === "grades" ? (grades.length ? grades.map(g => `<div class="m-s-row" style="--c:${esc(g.color || "#94a3b8")}"><b class="m-s-pct" style="color:${color(g.pct)}">${Math.round(g.pct)}%</b><span class="t"><b>${esc(g.name)}</b><small><i class="dot"></i>${esc(g.cls || "")} · ${g.score}/${g.outOf}${g.late ? " · late" : ""}</small></span></div>`).join("") : `<p class="sx-none">No grades yet.</p>`)
        : (classes.length ? classes.map(c => `<div class="m-s-row" style="--c:${esc(c.color || "#94a3b8")}"><span class="m-s-ring" style="--p:${Math.min(100, c.avg)};--rc:${color(c.avg)}"><b>${Math.round(c.avg)}</b></span><span class="t"><b>${esc(c.name)}</b><small>${esc(c.letter)} · ${c.n} grade${c.n === 1 ? "" : "s"}</small></span></div>`).join("") : `<p class="sx-none">No class averages yet.</p>`)}</div>`;
    el.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { this.tab = b.dataset.st; this.render(); });
  },
};
const when = t => { const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0); const n = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / day);
  return n < 0 ? (n === -1 ? "Yesterday" : `${-n} days ago`) : n === 0 ? "Today" : n === 1 ? "Tomorrow" : n < 7 ? d.toLocaleDateString([], { weekday: "long" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
const color = p => p >= 90 ? "#3ecf8e" : p >= 80 ? "#a3e635" : p >= 70 ? "#fbbf24" : "#f87171";
const dueRow = x => `<div class="m-s-row${x.late ? " late" : ""}" style="--c:${esc(x.color || "#94a3b8")}"><span class="t"><b>${esc(x.title)}</b><small><i class="dot"></i>${esc(x.cls || "Homework")}${x.kind === "test" ? " · Test" : ""}</small></span><em>${x.late ? "Overdue" : esc(when(x.when))}${x.timed ? "<br>" + esc(new Date(x.when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : ""}</em></div>`;
const signInFirst = why => `<div class="m-s-empty"><b>Sign in first</b><p>${why}</p><button class="btn primary" data-m="signin">Sign in</button></div>`;
document.addEventListener("click", e => { if (e.target.closest('[data-m="signin"]')) show("social"); });

/* ---------- the clock and Home, your way (saved on this phone) ---------- */
const CLOCK_STYLES = [["thin", "Thin"], ["bold", "Bold"], ["mono", "Digital"], ["serif", "Elegant"]];
const clockSet = () => ({ style: "thin", h24: false, seconds: false, date: true, greeting: true, messages: true, due: true, ...store.get("clock", {}) });
const setClock = (k, v) => store.set("clock", { ...clockSet(), [k]: v });

/* ---------- Home: your city, the time, and what needs you ---------- */
const Home = {
  timer: 0,
  render() {
    const el = $("#mHome"), now = new Date(), h = now.getHours();
    const hi = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
    const name = S.me ? S.me.display_name || S.me.username : "";
    const c = clockSet(), hh = c.h24 ? String(h).padStart(2, "0") : String(h % 12 || 12), mm = String(now.getMinutes()).padStart(2, "0");
    const time = `${hh}:${mm}${c.seconds ? `<i class="sec">:${String(now.getSeconds()).padStart(2, "0")}</i>` : ""}`, ampm = c.h24 ? "" : h < 12 ? "AM" : "PM";
    let cards = "";
    if (!S.me) cards = `<section class="m-card"><h2>Welcome to Skyline</h2><p class="m-muted">Sign in with your Skyline account to see your messages, friends and school here.</p><button class="btn primary" data-m="signin">Sign in</button></section>`;
    else {
      // only messages you really haven't read (the same count as Social); nothing when you're all caught up
      const unreadChats = S.friends.filter(f => f.unread > 0).sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)).slice(0, 4);
      if (c.messages && unreadChats.length) cards += `<section class="m-card"><header><h2>New messages</h2></header>
        ${unreadChats.map(f => `<button class="m-row unread" data-chat="${esc(f.id)}">${avatar(f, 38, statusOf(f))}<span class="t"><b>${esc(f.display_name)}</b><small>${f.unread === 1 ? "1 new message" : f.unread + " new messages"}</small></span><b class="sx-pill">${f.unread}</b></button>`).join("")}</section>`;
      // Up next: your next homework; the X hides what's there now (new homework brings it back)
      const d = School.data && School.data.data, hidden = new Set(store.get("dueHide", [])), next = d ? (d.due || []).filter(x => !hidden.has(dueKey(x))).slice(0, 3) : [];
      if (c.due && next.length) cards += `<section class="m-card"><header><h2>Up next</h2><button class="link" data-m="school">See all</button><button class="m-x" data-m="hidedue" aria-label="Hide">${X}</button></header><div class="m-s-list">${next.map(dueRow).join("")}</div></section>`;
    }
    cards = playerCard() + cards;
    el.innerHTML = `<div class="m-hero" data-style="${esc(c.style)}"><div class="m-hero-top">${c.date ? `<small>${esc(now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</small>` : "<span></span>"}${wxWindow()}</div>
      <div class="m-clock">${time}${ampm ? `<span>${ampm}</span>` : ""}</div>${c.greeting ? `<p>${esc(hi)}${name ? ", " + esc(name) : ""}</p>` : ""}</div><div class="m-cards">${cards}</div>`;
    Weather.load();
    if (S.me && (!School.data || Date.now() - School.at > 60000)) School.load().then(() => { if (current === "home") this.paint(); }).catch(() => {});
    clearTimeout(this.timer); this.timer = setTimeout(() => { if (current === "home") this.paint(); }, c.seconds ? 1000 - now.getMilliseconds() + 20 : (60 - now.getSeconds()) * 1000 + 50);
  },
  paint() { if (current === "home") this.render(); },
};
const X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const dueKey = x => `${x.title}|${x.when}`;

/* the weather window (top right of Home) and its forecast sheet, like the PC's weather widget */
function wxWindow() {
  const s = Weather.settings(); if (!s.show) return "";
  if (!s.city) return `<button class="m-wx empty" data-m="wx">${wicon("pin")}<span><b>Weather</b><small>Add your city</small></span></button>`;
  const j = Weather.data;
  if (!j) return `<button class="m-wx" data-m="wx"><span class="m-wx-now">${wicon("cloud")}<b>${Weather.failed ? "–" : "…"}</b></span><small class="m-wx-city">${esc(s.city.name)}</small></button>`;
  const cur = j.current, [label, ic] = wmo(cur.weather_code, cur.is_day);
  return `<button class="m-wx" data-m="wx" aria-label="Weather in ${esc(s.city.name)}: ${esc(label)}, ${Math.round(cur.temperature_2m)} degrees">
    <span class="m-wx-now">${wicon(ic)}<b>${Math.round(cur.temperature_2m)}°</b></span><small>${esc(label)}</small>
    <small class="m-wx-hl">H ${Math.round(j.daily.temperature_2m_max[0])}° L ${Math.round(j.daily.temperature_2m_min[0])}°</small><small class="m-wx-city">${esc(s.city.name)}</small></button>`;
}
const WxSheet = {
  open: false, searching: false, results: [], qT: 0,
  show(search) { this.open = true; this.searching = !!search || !Weather.settings().city; this.render(); Weather.load(); },
  close() { this.open = false; const el = document.getElementById("mWx"); if (el) el.remove(); },
  render() {
    if (!this.open) return;
    let el = document.getElementById("mWx");
    if (!el) { el = document.createElement("div"); el.id = "mWx"; el.className = "m-sheet"; document.body.appendChild(el); el.addEventListener("click", e => this.click(e)); el.addEventListener("input", e => this.input(e)); }
    const s = Weather.settings(), j = Weather.data;
    if (this.searching && el.querySelector("#wxQ")) return;   // (don't wipe what you're typing)
    let body;
    if (this.searching) body = `<header class="m-sh-head"><h2>Your city</h2>${s.city ? `<button class="link" data-wx="cancel">Cancel</button>` : ""}</header>
      <input id="wxQ" type="search" placeholder="Search for a city" autocomplete="off" enterkeyhint="search">
      <button class="m-wx-here" data-wx="here">${wicon("pin")}<span>Use my location</span></button><div class="m-wx-res" id="wxRes"></div>`;
    else if (!j) body = `<header class="m-sh-head"><h2>${esc(s.city.name)}</h2><button class="link" data-wx="city">Change</button></header>
      <div class="m-s-empty">${Weather.failed ? `<b>Weather is unavailable right now</b><p>Trying again soon.</p>` : `<span class="sx-spin"></span>`}</div>`;
    else {
      const cur = j.current, [label, ic] = wmo(cur.weather_code, cur.is_day), c = s.units === "c";
      const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric" }), tm = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const nowIdx = Math.max(0, j.hourly.time.findIndex(t => new Date(t) > new Date()) - 1);
      const hours = j.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => { const k = nowIdx + i, [, hi] = wmo(j.hourly.weather_code[k], j.hourly.is_day[k]);
        return `<div class="wh"><small>${i ? hourFmt.format(new Date(t)) : "Now"}</small>${wicon(hi)}<b>${Math.round(j.hourly.temperature_2m[k])}°</b><i>${j.hourly.precipitation_probability[k] >= 30 ? j.hourly.precipitation_probability[k] + "%" : ""}</i></div>`; }).join("");
      const days = j.daily.time.slice(1, 6).map((t, i) => { const k = i + 1, [, di] = wmo(j.daily.weather_code[k], 1), rain = j.daily.precipitation_probability_max[k];
        return `<div class="wd"><span>${new Date(t + "T12:00").toLocaleDateString(undefined, { weekday: "short" })}</span>${wicon(di)}<i>${rain >= 30 ? rain + "%" : ""}</i><span class="wd-r"><b>${Math.round(j.daily.temperature_2m_max[k])}°</b> ${Math.round(j.daily.temperature_2m_min[k])}°</span></div>`; }).join("");
      body = `<header class="m-sh-head"><h2>${s.city.here ? wicon("pin", "m-wx-pin") : ""}${esc(s.city.name)}</h2><button class="link" data-wx="city">Change</button></header>
        <div class="w-top"><span class="w-ic">${wicon(ic)}</span><div class="w-t">${Math.round(cur.temperature_2m)}<sup>°${c ? "C" : "F"}</sup></div><div class="w-l"><b>${esc(label)}</b><small>${esc(s.city.region || "")}</small></div></div>
        <div class="w-row"><span>H ${Math.round(j.daily.temperature_2m_max[0])}° · L ${Math.round(j.daily.temperature_2m_min[0])}°</span><span>Feels ${Math.round(cur.apparent_temperature)}°</span>
          <span>${Math.round(cur.wind_speed_10m)} ${c ? "km/h" : "mph"}</span><span>${cur.relative_humidity_2m}%</span></div>
        <div class="w-hours">${hours}</div><div class="w-days">${days}</div>
        <div class="w-sun"><span>↑ ${tm(j.daily.sunrise[0])}</span><span>↓ ${tm(j.daily.sunset[0])}</span>
          <div class="seg"><button class="${c ? "" : "on"}" data-wx="u:f">°F</button><button class="${c ? "on" : ""}" data-wx="u:c">°C</button></div></div>`;
    }
    el.innerHTML = `<div class="m-sh-box" role="dialog" aria-label="Weather"><i class="m-sh-grab"></i>${body}</div>`;
    if (this.searching) setTimeout(() => el.querySelector("#wxQ")?.focus(), 50);
  },
  input(e) {
    if (e.target.id !== "wxQ") return;
    clearTimeout(this.qT); const q = e.target.value.trim(), out = document.getElementById("wxRes");
    if (q.length < 2) { out.innerHTML = ""; return; }
    this.qT = setTimeout(async () => {
      try { this.results = await Weather.search(q);
        out.innerHTML = this.results.map((c, i) => `<button class="m-row" data-wxc="${i}"><span class="t"><b>${esc(c.name)}</b><small>${esc(c.region)}</small></span></button>`).join("") || `<p class="sx-none">No place called that. Try the nearest city.</p>`;
      } catch (er) { out.innerHTML = `<p class="sx-none">Couldn't search right now. Check your internet connection.</p>`; }
    }, 300);
  },
  pick(city) { this.searching = false; Weather.set("city", city); toast(`Weather set to ${city.name}`); this.render(); Home.paint(); if (current === "settings") Settings.render(); },
  async click(e) {
    if (e.target === e.currentTarget) return this.close();
    const r = e.target.closest("[data-wxc]"); if (r) return this.pick(this.results[+r.dataset.wxc]);
    const b = e.target.closest("[data-wx]"), a = b && b.dataset.wx; if (!a) return;
    if (a === "city") { this.searching = true; this.render(); }
    if (a === "cancel") { this.searching = false; this.render(); }
    if (a === "here") { b.disabled = true; b.querySelector("span").textContent = "Finding you…";
      try { this.pick(await Weather.locate()); } catch (er) { toast(er.message, true); b.disabled = false; b.querySelector("span").textContent = "Use my location"; } }
    if (a.startsWith("u:")) Weather.set("units", a.slice(2));
  },
};
Weather.onChange = () => { if (current === "home") Home.paint(); WxSheet.render(); };
document.addEventListener("visibilitychange", () => { if (!document.hidden && current === "home") Weather.load(); });

/* the music player: what's on Spotify right now (on any device) */
const ICON = { prev: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg>`, next: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`, pause: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>` };
const mmss = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function playerCard() {
  if (!Music.available()) return "";
  if (!Music.connected()) return "";   // (no Spotify sign-in on the phone: you said so)
  const n = Music.now; if (!n) return "";
  const pct = n.dur ? Math.min(100, Music.position() / n.dur * 100) : 0;
  return `<section class="m-card m-player${n.playing ? " on" : ""}">
    <div class="m-pl-top">${n.art ? `<img class="m-pl-art" src="${esc(n.art)}" alt="">` : `<span class="m-pl-art"></span>`}<span class="t"><b>${esc(n.title)}</b><small>${esc(n.artist)}</small>${n.device ? `<em>On ${esc(n.device)}</em>` : ""}</span></div>
    <div class="m-pl-bar"><i style="width:${pct.toFixed(2)}%"></i></div><div class="m-pl-time"><span id="mPlPos">${mmss(Music.position())}</span><span>${mmss(n.dur)}</span></div>
    <div class="m-pl-ctl"><button data-pl="prev" aria-label="Previous">${ICON.prev}</button><button class="big" data-pl="toggle" aria-label="${n.playing ? "Pause" : "Play"}">${n.playing ? ICON.pause : ICON.play}</button><button data-pl="next" aria-label="Next">${ICON.next}</button></div></section>`;
}
let lastSong = "";
Music.onChange = n => {   // redraw only when the song, play/pause or device changed (the bar moves by itself)
  const k = n ? [n.title, n.artist, n.playing, n.device, n.art, Math.round(n.pos / 5000)].join("|") : "";
  if (k !== lastSong || !n || Math.abs(Music.position() - n.pos) > 3000) { lastSong = k; Home.paint(); }
};
setInterval(() => {   // the progress bar moves between Spotify checks
  if (current !== "home" || !Music.now || !Music.now.playing) return;
  const bar = document.querySelector(".m-pl-bar i"), pos = document.getElementById("mPlPos"); if (!bar) return;
  bar.style.width = (Music.now.dur ? Math.min(100, Music.position() / Music.now.dur * 100) : 0).toFixed(2) + "%"; pos.textContent = mmss(Music.position());
}, 1000);

$("#mHome").addEventListener("click", e => {
  const c = e.target.closest("[data-chat]"); if (c) return openSocial({ kind: "chat", id: c.dataset.chat }, "home");
  const pl = e.target.closest("[data-pl]"); if (pl) return Music.control(pl.dataset.pl);
  const m = (e.target.closest("[data-m]") || {}).dataset?.m;
  if (m === "school") show("school");
  if (m === "wx") WxSheet.show();
  if (m === "hidedue") { const d = School.data && School.data.data; store.set("dueHide", [...new Set([...store.get("dueHide", []), ...((d && d.due) || []).map(dueKey)])].slice(-200)); Home.paint(); }
  if (m === "hidesp") { store.set("spHide", true); Home.paint(); }
  if (m === "spconnect") Music.connect();
});
let homeT = 0;
on(what => { if (["friends", "requests", "notes", "me"].includes(what) || what === "msg") { clearTimeout(homeT); homeT = setTimeout(() => Home.paint(), 150); } });

/* ---------- Settings ---------- */
const SOCIAL_SECTIONS = [["profile", "Profile", "Your name, picture, bio and banner"], ["badges", "Badges", "Which badges show next to your name"], ["appearance", "Appearance", "Your colours"],
  ["chat", "Chat", "How messages look"], ["privacy", "Privacy & safety", "Who can message and add you"], ["notifications", "Notifications", "What you get told about"],
  ["devices", "Voice & video", "Microphone and camera"], ["blocked", "Blocked", "People you've blocked"]];
const chev = `<svg class="m-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>`;
const Settings = {
  render() {
    const el = $("#mSettings"), b = bg(), me = S.me, ck = clockSet(), notif = "Notification" in window ? Notification.permission : "unsupported";
    el.innerHTML = `<header class="m-s-head"><h1>Settings</h1></header>
      ${me ? `<button class="m-card m-me" data-set="profile">${avatar(me, 54)}<span class="t"><b>${esc(me.display_name)}</b><small>@${esc(me.username)}</small></span>${chev}</button>`
        : `<section class="m-card"><p class="m-muted">Sign in to change your profile and Social settings.</p><button class="btn primary" data-m="signin">Sign in</button></section>`}
      <h3 class="m-h3">Clock</h3>
      <div class="m-list">
        <div class="m-li m-styles">${CLOCK_STYLES.map(([k, l]) => `<button class="m-cs${ck.style === k ? " on" : ""}" data-clock="style:${k}" data-style="${k}"><b>9:41</b><span>${l}</span></button>`).join("")}</div>
        <div class="m-li"><span class="t"><b>Time format</b></span><div class="seg"><button class="${ck.h24 ? "" : "on"}" data-clock="h24:0">12-hour</button><button class="${ck.h24 ? "on" : ""}" data-clock="h24:1">24-hour</button></div></div>
        ${[["seconds", "Show seconds"], ["date", "Show the date"], ["greeting", "Show the greeting"]].map(([k, l]) => `<label class="m-li"><span class="t"><b>${l}</b></span><span class="toggle"><input type="checkbox" data-clockt="${k}" ${ck[k] ? "checked" : ""}><span class="sw"></span></span></label>`).join("")}
      </div>
      <h3 class="m-h3">On Home</h3>
      <div class="m-list">${[["messages", "New messages", "Chats with messages you haven't read"], ["due", "Up next", "Your next homework, from School"]].map(([k, l, s]) => `<label class="m-li"><span class="t"><b>${l}</b><small>${s}</small></span><span class="toggle"><input type="checkbox" data-clockt="${k}" ${ck[k] ? "checked" : ""}><span class="sw"></span></span></label>`).join("")}</div>
      <h3 class="m-h3">Weather</h3>
      <div class="m-list">${(() => { const w = Weather.settings(); return `<button data-m="wxcity"><span class="t"><b>Your city</b><small>${w.city ? esc(w.city.name + (w.city.region ? ", " + w.city.region : "")) : "Not set: search for it, or use this phone's location"}</small></span>${chev}</button>
        <div class="m-li"><span class="t"><b>Temperature</b></span><div class="seg"><button class="${w.units === "c" ? "" : "on"}" data-m="wxu:f">°F</button><button class="${w.units === "c" ? "on" : ""}" data-m="wxu:c">°C</button></div></div>
        <label class="m-li"><span class="t"><b>Show on Home</b><small>The weather window at the top right</small></span><span class="toggle"><input type="checkbox" data-wxshow ${w.show ? "checked" : ""}><span class="sw"></span></span></label>`; })()}</div>
      ${Music.available() && Music.connected() ? `<h3 class="m-h3">Music</h3><div class="m-list"><div class="m-li"><span class="t"><b>Spotify</b><small>Connected: what you play shows on Home</small></span><button class="btn sm" data-m="spoff">Disconnect</button></div></div>` : ""}
      <h3 class="m-h3">Background</h3>
      <div class="m-bgs">${PHOTOS.map(([k, n]) => `<button class="m-bg${b === k ? " on" : ""}" data-bg="${k}" aria-label="${esc(n)}"><img src="img/bg/${k}-s.jpg" alt=""><span>${esc(n)}</span></button>`).join("")}
        <button class="m-bg plain${b === "none" ? " on" : ""}" data-bg="none" aria-label="Plain"><i></i><span>Plain</span></button></div>
      ${me ? `<h3 class="m-h3">Social</h3><div class="m-list">${SOCIAL_SECTIONS.map(([k, l, s]) => `<button data-set="${k}"><span class="t"><b>${l}</b><small>${s}</small></span>${chev}</button>`).join("")}</div>` : ""}
      <h3 class="m-h3">This phone</h3><div class="m-list">
        <div class="m-li"><span class="t"><b>Notifications</b><small>${notif === "granted" ? "On: you're told about new messages and calls" : notif === "denied" ? "Blocked. Turn them on in your phone's Settings › Notifications." : notif === "unsupported" ? "On iPhone: add Skyline to your Home Screen first" : "Get told about new messages and calls"}</small></span>${notif === "default" ? `<button class="btn sm primary" data-m="notify">Turn on</button>` : ""}</div>
        <button data-m="refresh"><span class="t"><b>Get the newest version</b><small>Skyline ${esc((window.SKY_CONFIG && SKY_CONFIG.version) || "")}. Updates come in by themselves; this checks right now.</small></span>${chev}</button>
        ${me ? `<button data-m="signout" class="danger"><span class="t"><b>Sign out</b><small>Signed in as @${esc(me.username)}</small></span></button>` : ""}</div>`;
    $$("#mSettings .m-bg[data-bg] img").forEach(async im => { const k = im.closest("[data-bg]").dataset.bg; im.src = await grade(`img/bg/${k}-s.jpg`, k); });   // (the thumbnails graded like the backgrounds)
  },
};
$("#mSettings").addEventListener("click", async e => {
  const cb = e.target.closest("[data-clock]"); if (cb) { const [k, v] = cb.dataset.clock.split(":"); setClock(k, k === "h24" ? v === "1" : v); return Settings.render(); }
  const t = e.target.closest("[data-bg], [data-set], [data-m]"); if (!t) return;
  if (t.dataset.bg) { store.set("bg", t.dataset.bg); applyBg(); return Settings.render(); }
  if (t.dataset.set) return openSocial({ kind: "settings", section: t.dataset.set }, "settings");
  const m = t.dataset.m;
  if (m === "spconnect") return Music.connect();
  if (m === "wxcity") return WxSheet.show(true);
  if (m && m.startsWith("wxu:")) { Weather.set("units", m.slice(4)); return Settings.render(); }
  if (m === "spoff") { Music.disconnect(); return Settings.render(); }
  if (m === "notify") { await Notification.requestPermission().catch(() => {}); Settings.render(); }
  if (m === "refresh") { try { const r = await navigator.serviceWorker?.getRegistration(); if (r) await r.update(); } catch (e) {} location.reload(); }
  if (m === "signout") { await sky.social.signOut(); location.reload(); }
});

$("#mSettings").addEventListener("change", e => { if (e.target.matches("[data-wxshow]")) Weather.set("show", e.target.checked); const k = e.target.dataset && e.target.dataset.clockt; if (k) setClock(k, e.target.checked); });

/* ---------- start ---------- */
applyBg();
Music.finishSignIn().then(r => { if (!r) return; if (r === "ok") { toast("Spotify connected"); store.set("spHide", false); Music.start(); } else if (r !== "cancelled") toast("Couldn't connect Spotify: " + r, true); });
show("home");
Social.init().then(() => { if (current === "home" || current === "settings") show(current); });
on(what => { if (what === "me" && current === "settings") Settings.render(); });
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // check for a new version on every open and whenever Skyline comes back to the front; switch to it right away
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => { r.update(); document.addEventListener("visibilitychange", () => { if (!document.hidden) r.update().catch(() => {}); }); }).catch(() => {});
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !document.body.classList.contains("m-main")) location.reload(); had = true; });
}
