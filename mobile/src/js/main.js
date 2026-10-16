// Skyline on a phone: Home (your city photo, the time, messages and what's due), Social (the same code as the PC
// app) one screen at a time, School (the summary your PC's Skyline keeps on your account), Settings, and Admin
// (only for Skyline's owner). Installable from the browser: "Add to Home Screen".
import { $, $$, esc, toast } from "./util.js";
import { Social } from "./social/social.js";
import { S, on, avatar, statusOf, subline } from "./social/state.js";
import { api } from "./social/api.js";

const store = { get(k, d) { try { const v = localStorage.getItem("sky-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sky-" + k, JSON.stringify(v)); } catch (e) {} } };
const day = 864e5;
let current = "home";

/* ---------- backgrounds: Skyline's city photos ---------- */
const PHOTOS = [["your-view", "The View"], ["kanda", "Kanda Night"], ["akiba", "Akihabara Overhead"], ["kiyosu", "Midnight Avenue"], ["umeda", "Behind the Glass"],
  ["osaka", "Osaka Blue Hour"], ["shinjuku", "Shinjuku Deck"], ["seoul", "Seoul From the Top"], ["tokyoair", "Tokyo Night Flight"]];
const bg = () => { const b = store.get("bg", "osaka"); return b === "none" || PHOTOS.some(p => p[0] === b) ? b : "osaka"; };
function applyBg() { const b = bg(); $("#mSky").style.backgroundImage = b === "none" ? "" : `url("img/bg/${b}.jpg")`; document.body.classList.toggle("m-photo", b !== "none"); }

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
  if (view === "school") School.render();
  if (view === "settings") Settings.render();
  if (view === "admin") Social.showAdmin();
}
$$(".m-tabs .rbtn").forEach(b => b.onclick = () => { backTo = null; show(b.dataset.view); });
document.addEventListener("sky:goto", () => show("social"));

/* ---------- School data (from your PC's Skyline), shared by Home and School ---------- */
const School = {
  data: null, at: 0, who: null, tab: "due",
  async load(force) {
    if (!S.me) return null;
    if (this.who !== S.me.id) { this.data = null; this.who = S.me.id; }   // (another account signed in: never show the last one's)
    if (force || !this.data || Date.now() - this.at > 60000) { const r = await api.rpc("get_school"); this.data = r || {}; this.at = Date.now(); }
    return this.data;
  },
  async render() {
    const el = $("#mSchool");
    if (!S.me) { el.innerHTML = signInFirst("Your grades and homework come from your PC's Skyline, through your Skyline account."); return; }
    if (!this.data) el.innerHTML = `<div class="m-s-empty"><span class="sx-spin"></span></div>`;
    try { await this.load(); } catch (e) { if (!this.data) { el.innerHTML = `<div class="m-s-empty"><b>Couldn't load your school</b><p>${esc(e.message)}</p></div>`; return; } }
    const d = (this.data && this.data.data) || null;
    if (!d) { el.innerHTML = `<header class="m-s-head"><h1>School</h1></header><div class="m-s-empty"><b>Nothing here yet</b><p>Open Skyline on your PC (signed in to Social with this account). It sends your classes, grades and homework here by itself.</p></div>`; return; }
    const due = d.due || [], grades = d.grades || [], classes = (d.classes || []).filter(c => c.avg != null);
    const late = due.filter(x => x.late).length, soon = due.filter(x => !x.late && x.when - Date.now() < 2 * day).length;
    el.innerHTML = `<header class="m-s-head"><h1>School</h1><small>Updated ${esc(when(this.data.updated_at))} at ${esc(new Date(this.data.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} from your PC</small></header>
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

/* ---------- Home: your city, the time, and what needs you ---------- */
const Home = {
  timer: 0,
  render() {
    const el = $("#mHome"), now = new Date(), h = now.getHours();
    const hi = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
    const name = S.me ? S.me.display_name || S.me.username : "";
    const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
    const ampm = (now.toLocaleTimeString([], { hour: "numeric" }).match(/[AP]M/i) || [""])[0];
    let cards = "";
    if (!S.me) cards = `<section class="m-card"><h2>Welcome to Skyline</h2><p class="m-muted">Sign in with your Skyline account to see your messages, friends and school here.</p><button class="btn primary" data-m="signin">Sign in</button></section>`;
    else {
      const chats = [...S.friends].filter(f => f.last_message_at || f.unread).sort((a, b) => (b.unread > 0) - (a.unread > 0) || new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)).slice(0, 4);
      const unread = S.friends.reduce((n, f) => n + (f.unread || 0), 0);
      cards += `<section class="m-card"><header><h2>Messages</h2>${unread ? `<b class="sx-pill">${unread} new</b>` : ""}</header>
        ${chats.length ? chats.map(f => `<button class="m-row${f.unread ? " unread" : ""}" data-chat="${esc(f.id)}">${avatar(f, 38, statusOf(f))}<span class="t"><b>${esc(f.display_name)}</b><small>${esc(subline(f))}</small></span>${f.unread ? `<b class="sx-pill">${f.unread}</b>` : f.last_message_at ? `<em>${esc(when(f.last_message_at) === "Today" ? new Date(f.last_message_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : when(f.last_message_at))}</em>` : ""}</button>`).join("")
          : `<p class="m-muted">No messages yet. Add friends in Social.</p>`}</section>`;
      const online = S.friends.filter(f => statusOf(f) !== "offline");
      if (online.length) cards += `<section class="m-card"><header><h2>Online now</h2><small>${online.length}</small></header><div class="m-online">${online.slice(0, 12).map(f => `<button data-chat="${esc(f.id)}" title="${esc(f.display_name)}">${avatar(f, 46, statusOf(f))}<span>${esc(f.display_name)}</span></button>`).join("")}</div></section>`;
      const d = School.data && School.data.data;
      if (d && (d.due || []).length) cards += `<section class="m-card"><header><h2>Up next</h2><button class="link" data-m="school">See all</button></header><div class="m-s-list">${d.due.slice(0, 3).map(dueRow).join("")}</div></section>`;
    }
    el.innerHTML = `<div class="m-hero"><small>${esc(now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</small>
      <div class="m-clock">${esc(time)}<span>${esc(ampm)}</span></div><p>${esc(hi)}${name ? ", " + esc(name) : ""}</p></div><div class="m-cards">${cards}</div>`;
    if (S.me && (!School.data || Date.now() - School.at > 60000)) School.load().then(() => { if (current === "home") this.paint(); }).catch(() => {});
    clearTimeout(this.timer); this.timer = setTimeout(() => { if (current === "home") this.paint(); }, (60 - now.getSeconds()) * 1000 + 50);
  },
  paint() { if (current === "home") this.render(); },
};
$("#mHome").addEventListener("click", e => {
  const c = e.target.closest("[data-chat]"); if (c) return openSocial({ kind: "chat", id: c.dataset.chat }, "home");
  if (e.target.closest('[data-m="school"]')) show("school");
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
    const el = $("#mSettings"), b = bg(), me = S.me, notif = "Notification" in window ? Notification.permission : "unsupported";
    el.innerHTML = `<header class="m-s-head"><h1>Settings</h1></header>
      ${me ? `<button class="m-card m-me" data-set="profile">${avatar(me, 54)}<span class="t"><b>${esc(me.display_name)}</b><small>@${esc(me.username)}</small></span>${chev}</button>`
        : `<section class="m-card"><p class="m-muted">Sign in to change your profile and Social settings.</p><button class="btn primary" data-m="signin">Sign in</button></section>`}
      <h3 class="m-h3">Background</h3>
      <div class="m-bgs">${PHOTOS.map(([k, n]) => `<button class="m-bg${b === k ? " on" : ""}" data-bg="${k}" aria-label="${esc(n)}"><img src="img/bg/${k}-s.jpg" alt=""><span>${esc(n)}</span></button>`).join("")}
        <button class="m-bg plain${b === "none" ? " on" : ""}" data-bg="none" aria-label="Plain"><i></i><span>Plain</span></button></div>
      ${me ? `<h3 class="m-h3">Social</h3><div class="m-list">${SOCIAL_SECTIONS.map(([k, l, s]) => `<button data-set="${k}"><span class="t"><b>${l}</b><small>${s}</small></span>${chev}</button>`).join("")}</div>` : ""}
      <h3 class="m-h3">This phone</h3><div class="m-list">
        <div class="m-li"><span class="t"><b>Notifications</b><small>${notif === "granted" ? "On: you're told about new messages and calls" : notif === "denied" ? "Blocked. Turn them on in your phone's Settings › Notifications." : notif === "unsupported" ? "On iPhone: add Skyline to your Home Screen first" : "Get told about new messages and calls"}</small></span>${notif === "default" ? `<button class="btn sm primary" data-m="notify">Turn on</button>` : ""}</div>
        <button data-m="refresh"><span class="t"><b>Get the newest version</b><small>Skyline ${esc((window.SKY_CONFIG && SKY_CONFIG.version) || "")}. Updates come in by themselves; this checks right now.</small></span>${chev}</button>
        ${me ? `<button data-m="signout" class="danger"><span class="t"><b>Sign out</b><small>Signed in as @${esc(me.username)}</small></span></button>` : ""}</div>`;
  },
};
$("#mSettings").addEventListener("click", async e => {
  const t = e.target.closest("[data-bg], [data-set], [data-m]"); if (!t) return;
  if (t.dataset.bg) { store.set("bg", t.dataset.bg); applyBg(); return Settings.render(); }
  if (t.dataset.set) return openSocial({ kind: "settings", section: t.dataset.set }, "settings");
  const m = t.dataset.m;
  if (m === "notify") { await Notification.requestPermission().catch(() => {}); Settings.render(); }
  if (m === "refresh") { try { const r = await navigator.serviceWorker?.getRegistration(); if (r) await r.update(); } catch (e) {} location.reload(); }
  if (m === "signout") { await sky.social.signOut(); location.reload(); }
});

/* ---------- start ---------- */
applyBg();
show("home");
Social.init().then(() => { if (current === "home" || current === "settings") show(current); });
on(what => { if (what === "me" && current === "settings") Settings.render(); });
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // check for a new version on every open and whenever Skyline comes back to the front; switch to it right away
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => { r.update(); document.addEventListener("visibilitychange", () => { if (!document.hidden) r.update().catch(() => {}); }); }).catch(() => {});
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !document.body.classList.contains("m-main")) location.reload(); had = true; });
}
