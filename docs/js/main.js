// Skyline on a phone: Social (the same code as the PC app) in a one-screen-at-a-time layout, and School
// (the summary your PC's Skyline keeps on your account). Installable from the browser: "Add to Home Screen".
import { $, $$, esc, toast } from "./util.js";
import { Social } from "./social/social.js";
import { S, on } from "./social/state.js";
import { api } from "./social/api.js";

/* ---------- Social: the list, or one conversation ---------- */
// on a phone only one thing fits: the list (servers, channels, chats), or what you opened from it
on((what, v) => { if (what === "view") document.body.classList.toggle("m-main", true); });
function back() { document.body.classList.remove("m-main"); }
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
  $$(".m-tabs .rbtn").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".m-app > .view").forEach(s => s.classList.toggle("hidden", s.id !== "view-" + view));
  Social.show(view === "social");
  if (view === "school") School.render();
}
$$(".m-tabs .rbtn").forEach(b => b.onclick = () => show(b.dataset.view));
document.addEventListener("sky:goto", e => show(e.detail === "social" ? "social" : "social"));

/* ---------- School: what's due and your grades (from your PC's Skyline) ---------- */
const day = 864e5;
const when = t => { const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0); const n = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / day);
  return n < 0 ? (n === -1 ? "Yesterday" : `${-n} days ago`) : n === 0 ? "Today" : n === 1 ? "Tomorrow" : n < 7 ? d.toLocaleDateString([], { weekday: "long" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
const color = p => p >= 90 ? "#3ecf8e" : p >= 80 ? "#a3e635" : p >= 70 ? "#fbbf24" : "#f87171";
const School = {
  data: null, at: 0, who: null, tab: "due",
  async render() {
    const el = $("#mSchool");
    if (!S.me) { el.innerHTML = `<div class="m-s-empty"><b>Sign in on the Social tab first</b><p>Your grades and homework come from your PC's Skyline, through your Skyline account.</p></div>`; return; }
    if (this.who !== S.me.id) { this.data = null; this.who = S.me.id; }   // (another account signed in: never show the last one's)
    if (!this.data || Date.now() - this.at > 60000) {
      if (!this.data) el.innerHTML = `<div class="m-s-empty"><span class="sx-spin"></span></div>`;
      try { const r = await api.rpc("get_school"); this.data = r || {}; this.at = Date.now(); } catch (e) { if (!this.data) { el.innerHTML = `<div class="m-s-empty"><b>Couldn't load your school</b><p>${esc(e.message)}</p></div>`; return; } }
    }
    const d = (this.data && this.data.data) || null;
    if (!d) { el.innerHTML = `<div class="m-s-empty"><b>Nothing here yet</b><p>Open Skyline on your PC (signed in to Social with this account). It sends your classes, grades and homework here by itself.</p></div>`; return; }
    const due = d.due || [], grades = d.grades || [], classes = (d.classes || []).filter(c => c.avg != null);
    const late = due.filter(x => x.late).length, soon = due.filter(x => !x.late && x.when - Date.now() < 2 * day).length;
    el.innerHTML = `<header class="m-s-head"><h1>School</h1><small>Updated ${esc(when(this.data.updated_at))} at ${esc(new Date(this.data.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} from your PC</small></header>
      <div class="m-s-stats"><div><b style="color:${d.overall != null ? color(d.overall) : "inherit"}">${d.overall != null ? d.overall.toFixed(1) + "%" : "–"}</b><span>Overall</span></div><div><b>${d.gpa != null ? d.gpa.toFixed(2) : "–"}</b><span>GPA</span></div><div><b class="${late ? "bad" : ""}">${late}</b><span>Overdue</span></div><div><b>${soon}</b><span>Due soon</span></div></div>
      <div class="seg m-s-seg"><button class="${this.tab === "due" ? "on" : ""}" data-st="due">Due</button><button class="${this.tab === "grades" ? "on" : ""}" data-st="grades">Grades</button><button class="${this.tab === "classes" ? "on" : ""}" data-st="classes">Classes</button></div>
      <div class="m-s-list">${this.tab === "due" ? (due.length ? due.map(x => `<div class="m-s-row${x.late ? " late" : ""}" style="--c:${esc(x.color || "#94a3b8")}"><span class="t"><b>${esc(x.title)}</b><small><i class="dot"></i>${esc(x.cls || "Homework")}${x.kind === "test" ? " · Test" : ""}</small></span><em>${x.late ? "Overdue" : esc(when(x.when))}${x.timed ? "<br>" + esc(new Date(x.when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : ""}</em></div>`).join("") : `<p class="sx-none">Nothing due in the next three weeks. 🎉</p>`)
        : this.tab === "grades" ? (grades.length ? grades.map(g => `<div class="m-s-row" style="--c:${esc(g.color || "#94a3b8")}"><b class="m-s-pct" style="color:${color(g.pct)}">${Math.round(g.pct)}%</b><span class="t"><b>${esc(g.name)}</b><small><i class="dot"></i>${esc(g.cls || "")} · ${g.score}/${g.outOf}${g.late ? " · late" : ""}</small></span></div>`).join("") : `<p class="sx-none">No grades yet.</p>`)
        : (classes.length ? classes.map(c => `<div class="m-s-row" style="--c:${esc(c.color || "#94a3b8")}"><span class="m-s-ring" style="--p:${Math.min(100, c.avg)};--rc:${color(c.avg)}"><b>${Math.round(c.avg)}</b></span><span class="t"><b>${esc(c.name)}</b><small>${esc(c.letter)} · ${c.n} grade${c.n === 1 ? "" : "s"}</small></span></div>`).join("") : `<p class="sx-none">No class averages yet.</p>`)}</div>`;
    el.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { this.tab = b.dataset.st; this.render(); });
  },
};

/* ---------- start ---------- */
Social.init().then(() => show("social"));
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
// ask once (after you've signed in and tapped something) whether Skyline may show notifications
document.addEventListener("click", function ask() {
  document.removeEventListener("click", ask);
  if (S.me && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}, { once: false });
