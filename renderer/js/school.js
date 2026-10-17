// The School page: everything that's due (Google Classroom and your own), a calendar, your class schedule, grades,
// and study tools (flashcards, quizzes, a study helper). Everything is saved on this PC.
import { $, $$, esc, sky, toast, dialog, store } from "./util.js";
import { icon } from "./social/icons.js";
import { Widgets } from "./widgets.js";
import { FX } from "./fx.js";

const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const day = 864e5;
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const today = () => dayStart(Date.now());
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };   // calendar days (DST-safe)
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const parseDay = s => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d).getTime() : 0; };
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const clean = e => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#f97316", "#a3e635", "#e879f9"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KINDS = { hw: ["pencil", "Homework"], test: ["flask", "Test / quiz"], project: ["layers", "Project"] };
const CATS = { test: "Tests", quiz: "Quizzes", hw: "Homework", cw: "Classwork", project: "Projects", other: "Other" };
const CR_ICON = `<svg class="sc-cri" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="4" fill="#16a34a"/><rect x="3" y="3.5" width="10" height="7" rx="1.2" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M5.5 13h5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const INTERVALS = [0, 1, 2, 4, 8, 16, 32];   // flashcards: days until a card comes back, by how well you know it
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const hm = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const toMin = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const fromMin = n => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const clock = s => { const d = new Date(); d.setHours(0, toMin(s), 0, 0); return hm(d); };

let D = null;   // the saved School data
const save = () => { store.write("school", D); phoneSoon(); };
// your phone's Skyline shows a summary of this (classes and averages, what's due, recent grades): kept on your
// Social account (only you can read it), refreshed a little after anything changes
let phoneT = 0;
function phoneSoon(ms = 20000) { clearTimeout(phoneT); phoneT = setTimeout(pushPhone, ms); }
async function pushPhone() {
  try {
    const [{ S: SS }, { api }] = await Promise.all([import("./social/state.js"), import("./social/api.js")]);
    if (!SS.me || !D) return;
    const now = Date.now(), soon = now + 21 * 864e5;
    const classes = D.classes.map(c => { const a = classAvg(c); return { name: c.name, color: c.color, avg: a == null ? null : Math.round(a * 10) / 10, letter: a == null ? "" : letter(a)[1], n: gradesOf(c.id).length }; });
    const graded = classes.filter(c => c.avg != null);
    const due = items().filter(i => !i.done && i.when && (i.when < soon)).sort((a, b) => a.when - b.when).slice(0, 60)
      .map(i => ({ title: String(i.title || "").slice(0, 120), cls: clsName(i.classId), color: clsColor(i.classId), when: i.when, timed: !!i.hasTime, kind: i.kind || "hw", late: late(i) }));
    const grades = crGrades().concat(D.grades.map(g => ({ ...g, seen: g.at }))).filter(g => g.outOf > 0).sort((a, b) => (b.seen || 0) - (a.seen || 0)).slice(0, 40)
      .map(g => ({ name: String(g.name || "Grade").slice(0, 100), cls: clsName(g.classId), color: clsColor(g.classId), score: g.score, outOf: g.outOf, pct: Math.round(pct(g) * 10) / 10, at: g.at || g.seen || null, late: !!g.late }));
    await api.rpc("save_school", { p_data: { at: now, classes, overall: graded.length ? Math.round(graded.reduce((a, c) => a + c.avg, 0) / graded.length * 10) / 10 : null,
      gpa: graded.length ? Math.round(graded.reduce((a, c) => a + letter(c.avg)[2], 0) / graded.length * 100) / 100 : null, due, grades } });
  } catch (e) {}
}
const S = { tab: store.local("sc-tab") || "agenda", filter: "all", open: null, calOff: 0, calDay: null, schedDay: null, gradeCls: null, deck: null, sess: null, quiz: null, busy: {}, help: { q: "", a: "", cls: "" } };

/* ---------- reading dates ---------- */
// Classroom's due text ("Tomorrow, 11:59 PM", "Friday", "Oct 14", "Oct 14, 2026") -> a time (0 when there isn't one)
function dueTime(text, missing) {
  const s = String(text || "").toLowerCase(); if (!s) return 0;
  const t0 = today(), tm = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/), at = d => { if (!tm) return d + day - 60e3; let h = +tm[1] % 12 + (tm[3] === "pm" ? 12 : 0); if (!tm[3] && +tm[1] === 12) h = 12; return d + h * 36e5 + +tm[2] * 6e4; };
  if (/\btoday\b/.test(s)) return at(t0);
  if (/\btomorrow\b/.test(s)) return at(addDays(t0, 1));
  if (/\byesterday\b/.test(s)) return at(addDays(t0, -1));
  const md = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (md) { const now = new Date(); const y = md[3] ? +md[3] : now.getFullYear(); let d = new Date(y, MONTHS.indexOf(md[1]), +md[2]).getTime();
    if (!md[3] && !missing && d < t0 - 60 * day) d = new Date(y + 1, MONTHS.indexOf(md[1]), +md[2]).getTime(); return at(d); }
  const wd = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (wd) { let diff = (DAYS.indexOf(wd[1]) - new Date(t0).getDay() + 7) % 7; if (missing && diff) diff -= 7; return at(addDays(t0, diff)); }
  return 0;
}
const DUE_WORD = "(?:due\\s+|by\\s+|on\\s+|for\\s+)?";
// what you typed -> homework: "math worksheet p.42 due friday", "science test oct 20", "essay in 3 days"
export function parseQuick(text, classes = []) {
  let s = " " + String(text || "").trim() + " ", due = 0, m;
  const t0 = today(), take = re => { const r = s.match(re); if (r) s = s.slice(0, r.index) + " " + s.slice(r.index + r[0].length); return r; };
  if ((m = take(new RegExp("\\s" + DUE_WORD + "(today|tonight)\\b", "i")))) due = t0;
  else if ((m = take(new RegExp("\\s" + DUE_WORD + "(tomorrow|tmrw|tmr|tmw)\\b", "i")))) due = addDays(t0, 1);
  else if ((m = take(new RegExp("\\s" + DUE_WORD + "in\\s+(\\d{1,2})\\s+days?\\b", "i")))) due = addDays(t0, +m[1]);
  else if ((m = take(new RegExp("\\s" + DUE_WORD + "in\\s+a\\s+week\\b|\\s" + DUE_WORD + "next\\s+week\\b", "i")))) due = addDays(t0, 7);
  else if ((m = take(new RegExp("\\s" + DUE_WORD + "(next\\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\\b", "i")))) {
    const dow = DAYS.indexOf(m[2].slice(0, 3).toLowerCase()); let diff = (dow - new Date(t0).getDay() + 7) % 7 || 7; if (m[1] && diff < 7) diff += 7; due = addDays(t0, diff);
  } else if ((m = take(new RegExp("\\s" + DUE_WORD + "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b", "i")))) {
    const y = new Date().getFullYear(); due = new Date(y, MONTHS.indexOf(m[1].toLowerCase()), +m[2]).getTime(); if (due < t0 - 30 * day) due = new Date(y + 1, MONTHS.indexOf(m[1].toLowerCase()), +m[2]).getTime();
  } else if ((m = take(new RegExp("\\s" + DUE_WORD + "(\\d{1,2})/(\\d{1,2})\\b", "i")))) {
    const y = new Date().getFullYear(); due = new Date(y, +m[1] - 1, +m[2]).getTime(); if (due < t0 - 30 * day) due = new Date(y + 1, +m[1] - 1, +m[2]).getTime();
  }
  s = s.replace(/\s(due|by|on|for)\s*$/i, " ").replace(/\s+/g, " ").trim();
  const kind = /\b(test|quiz|exam|midterm|final|assessment|unit test)\b/i.test(s) ? "test" : /\b(project|presentation|poster|lab report|diorama)\b/i.test(s) ? "project" : "hw";
  const low = s.toLowerCase();
  const ALIAS = [[/math|algebra|geometry/, /\b(math|algebra|alg|geometry|geo)\b/], [/science|physics|chem|bio/, /\b(sci|science|physics|chem|chemistry|bio|biology)\b/], [/english|literature|ela|reading/, /\b(ela|eng|english|lit|literature|reading)\b/],
    [/social|history|civics/, /\b(ss|social studies|history|hist|civics)\b/], [/espa|spanish/, /\b(spanish|español|espanol)\b/], [/comput|tech/, /\b(computers?|comp sci|tech|coding|typing)\b/], [/relig|theolog/, /\b(religion|theology|rel)\b/]];
  let cls = classes.find(c => new RegExp("\\b" + c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(low))
    || classes.find(c => c.name.split(/\s+/).some(w => w.length >= 4 && !/^(honors|grade|class|seminar|academic)$/i.test(w) && new RegExp("\\b" + w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(low)))
    || classes.find(c => { const said = low.split(/[^a-z0-9ñáéíóú]+/).filter(x => x.length >= 3 && !/^(the|and|for|due|read|test|quiz|pro|his|her|our|all|any|new|out|get|set|per|com|pre|sci|lit|eng)$/.test(x) || /^(sci|lit|eng)$/.test(x));
      return c.name.toLowerCase().split(/\s+/).some(w => said.some(x => w.startsWith(x))); })   // "lit" -> Literature, "chem" -> Chemistry
    || classes.find(c => ALIAS.some(([cn, said]) => cn.test(c.name.toLowerCase()) && said.test(low)));
  return { title: s ? s[0].toUpperCase() + s.slice(1) : "", due, kind, classId: cls ? cls.id : "" };
}
// "D7 Math 2026-2027 Honors Algebra" -> "Math Honors Algebra"; "Español 8G (26-27) X, Y, Z" -> "Español"
export function shortName(n) {
  const s = String(n || "")
    .replace(/\(?\b(?:19|20)\d{2}\s*[-–/]\s*(?:(?:19|20)?\d{2})\b\)?/g, " ").replace(/\(\s*\d{2}\s*[-–]\s*\d{2}\s*\)/g, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\s+grade\b/gi, " ").replace(/\bgrade\s*\d+\b/gi, " ").replace(/\b[A-Z]?\d+[A-Z]?\b/g, " ").replace(/\b[A-Z](?:\s*,\s*[A-Z])+\b/g, " ")
    .replace(/\s+-\s+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-–:,·|]+|[\s\-–:,·|]+$/g, "").trim();
  return s.length >= 2 ? s : String(n || "").trim();
}
const courseOf = url => (String(url).match(/\/c\/([A-Za-z0-9_-]+)/) || [])[1] || "";

/* ---------- Google Classroom ---------- */
const Classroom = {
  st: { connected: false, items: [], courses: {} },
  async init() {
    if (!sky || !sky.classroom) return;
    this.st = await sky.classroom.status().catch(() => this.st);
    linkCourses();
    sky.classroom.onStatus(s => { const was = this.st; this.st = s; linkCourses(); newWork(s, was); newGrades(s, was); trackGrades(); if (School.visible()) School.render(); phoneSoon(); });
  },
  shown() { if (this.st.connected && !this.st.expired && !this.st.syncing && Date.now() - (this.st.at || 0) > 15 * 60e3) sky.classroom.sync().catch(() => {}); },   // fresh when you look
};
// every Classroom class with work becomes one of your classes (colour, short name), once
function linkCourses() {
  const st = Classroom.st; if (!D || !st.connected) return;
  let changed = false;
  for (const id of new Set([...Object.keys(st.courses || {}), ...(st.items || []).map(x => x.course || courseOf(x.url))].filter(Boolean))) {
    if (D.classes.some(c => c.cr === id)) continue;
    const full = (st.courses || {})[id] || ((st.items || []).find(x => (x.course || courseOf(x.url)) === id) || {}).cls || "Class", name = shortName(full);
    const same = D.classes.find(c => !c.cr && c.name.toLowerCase() === name.toLowerCase());
    if (same) { same.cr = id; same.full = full; } else D.classes.push({ id: uid("c"), name, full, cr: id, color: COLORS[D.classes.length % COLORS.length] });
    changed = true;
  }
  const ids = new Set((st.items || []).map(x => x.id));   // forget "done here" marks for work that's gone from Classroom
  if (st.at && !st.expired) for (const k of Object.keys(D.crDone)) if (!ids.has(k)) { delete D.crDone[k]; changed = true; }
  if (changed) save();
}
// a heads-up when new work shows up in Classroom
function newWork(s, was) {
  if (!D.remind.on || !s.fresh || !s.fresh.length || s.at === was.at) return;
  const seen = new Set(D.reminded.fresh || []), fresh = (s.items || []).filter(x => s.fresh.includes(x.id) && !seen.has(x.id));
  if (!fresh.length) return;
  D.reminded.fresh = [...seen, ...fresh.map(x => x.id)].slice(-200); save();
  sky.app.notify({ title: fresh.length === 1 ? "New in Google Classroom" : `${fresh.length} new things in Google Classroom`, body: fresh.slice(0, 3).map(x => `${x.title}${x.due ? " (due " + x.due + ")" : ""}`).join("\n") });
}

function newGrades(s, was) {
  if (!D.remind.on || !s.freshGrades || !s.freshGrades.length || s.gradesAt === was.gradesAt) return;
  const seen = new Set(D.reminded.grades || []), list = (s.grades || []).filter(g => s.freshGrades.includes(g.id) && !seen.has(g.id + "|" + g.score + "/" + g.outOf));
  if (!list.length) return;
  D.reminded.grades = [...seen, ...list.map(g => g.id + "|" + g.score + "/" + g.outOf)].slice(-300); save();
  const name = g => { const c = D.classes.find(c => c.cr === g.course); return (c ? c.name + " · " : "") + g.title; };
  say(list.length === 1 ? `New grade: you got ${Math.round(pct(list[0]))} percent on ${list[0].title}.` : `You have ${list.length} new grades in Google Classroom.`);
  sky.app.notify({ title: list.length === 1 ? `New grade: ${fmtPct(pct(list[0]))}` : `${list.length} new grades`, body: list.slice(0, 4).map(g => `${name(g)}: ${fmtPct(pct(g))} (${g.score}/${g.outOf})`).join("\n") });
}

/* ---------- everything that's due, in one list ---------- */
const cls = id => D.classes.find(c => c.id === id) || null;
const clsName = id => (cls(id) || {}).name || "";
const clsColor = id => (cls(id) || {}).color || "#94a3b8";
function items() {
  const out = [];
  for (const w of D.work) out.push({ key: "w:" + w.id, src: "mine", w, title: w.text, classId: w.classId, when: w.due, hasTime: false, kind: w.kind || "hw", done: !!w.done, doneAt: w.doneAt || 0, steps: w.steps || [], notes: w.notes || "", tip: w.tip || "" });
  if (Classroom.st.connected) for (const x of Classroom.st.items || []) {
    if (x.noDue || !x.due) continue;   // work without a due date isn't listed
    const when = dueTime(x.due, x.missing); if (!when) continue;
    if (!x.missing && dayStart(when) < today()) continue;   // the "assigned" list never has past due dates: a past date there is when it was posted
    const c = D.classes.find(c => c.cr && c.cr === (x.course || courseOf(x.url))), e = D.extra[x.id] || {};
    out.push({ key: "c:" + x.id, src: "classroom", x, title: x.title, classId: c ? c.id : "", when, hasTime: /\d:\d\d/.test(x.due), kind: /\b(test|quiz|exam)\b/i.test(x.title) ? "test" : "hw",
      done: !!D.crDone[x.id], doneAt: D.crDone[x.id] || 0, missing: !!x.missing, url: x.url, points: x.points || 0, steps: e.steps || [], notes: e.notes || "", tip: e.tip || "" });
  }
  return out;
}
const find = key => items().find(i => i.key === key);
// where an item's steps and notes are kept
const extra = it => it.src === "mine" ? D.work.find(w => w.id === it.w.id) : (D.extra[it.x.id] = D.extra[it.x.id] || {});
function dueText(it) {
  const n = Math.round((dayStart(it.when) - today()) / day), time = it.hasTime ? ", " + hm(it.when) : "";
  return n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "Today" + time : n === 1 ? "Tomorrow" + time : n < 7 ? DAY_NAMES[new Date(it.when).getDay()] + time : new Date(it.when).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
const late = it => !it.done && (it.missing || dayStart(it.when) < today());
function markDone(it, on, x, y) {
  if (it.src === "mine") { const w = D.work.find(w => w.id === it.w.id); w.done = on; w.doneAt = on ? Date.now() : 0; }
  else if (on) D.crDone[it.x.id] = Date.now(); else delete D.crDone[it.x.id];
  const k = ymd(Date.now()); D.doneLog[k] = Math.max(0, (D.doneLog[k] || 0) + (on ? 1 : -1));
  save();
  if (on) { FX.confetti(x || innerWidth / 2, y || innerHeight / 2); if (it.src === "classroom") toast("Done here. Remember to turn it in on Classroom too"); }
}
function streak() {
  let n = 0, t = today(); if (!D.doneLog[ymd(t)]) t = addDays(t, -1);   // today still counts until it's over
  while (D.doneLog[ymd(t)] > 0) { n++; t = addDays(t, -1); }
  return n;
}
export function addHomework(text, clsText, due) {
  if (!D) return false;
  const q = parseQuick(text, D.classes), c = clsText ? D.classes.find(c => c.name.toLowerCase() === String(clsText).toLowerCase()) : null;
  D.work.push({ id: uid("w"), text: (q.title || String(text)).slice(0, 140), classId: (c && c.id) || q.classId || "", due: due || q.due || addDays(today(), 1), kind: q.kind, done: false });
  save(); if (School.visible()) School.render(); return true;
}

/* ---------- class schedule ---------- */
const periodName = p => p.classId ? clsName(p.classId) || p.name || "Class" : p.name || "Free";
const periodColor = p => p.classId ? clsColor(p.classId) : "#64748b";
function dayPeriods(dow) { return D.periods.filter(p => (p.days || []).includes(dow)).sort((a, b) => toMin(a.start) - toMin(b.start)); }
function nowNext(t = Date.now()) {
  const d = new Date(t), mins = d.getHours() * 60 + d.getMinutes(), list = dayPeriods(d.getDay());
  const now = list.find(p => toMin(p.start) <= mins && mins < toMin(p.end)), next = list.find(p => toMin(p.start) > mins);
  if (now || next) return { now, next, mins, list };
  for (let i = 1; i <= 7; i++) { const l = dayPeriods((d.getDay() + i) % 7); if (l.length) return { mins, list, later: { p: l[0], day: i } }; }
  return { mins, list };
}

/* ---------- grades ---------- */
// a test, quiz, homework…: from the assignment's name (for weighted categories)
const guessCat = t => /\b(test|exam|midterm|final|assessment)\b/i.test(t) ? "test" : /\bquiz/i.test(t) ? "quiz" : /\b(hw|homework|ws|worksheet|bookwork|review|practice|journal)\b/i.test(t) ? "hw" : /\b(lab|project|poster|presentation|essay)\b/i.test(t) ? "project" : "cw";
// your grades from Google Classroom (read from each class's "View your work")
function crGrades() {
  if (!Classroom.st.connected) return [];
  return (Classroom.st.grades || []).map(g => { const c = D.classes.find(c => c.cr === g.course);
    return { id: "cr:" + g.id, cr: true, classId: c ? c.id : "", name: g.title, score: g.score, outOf: g.outOf, cat: guessCat(g.title), at: g.due ? dueTime(g.due, true) : 0, seen: g.seen || 0, late: !!g.late }; });
}
const gradesOf = id => D.grades.filter(g => g.classId === id).concat(crGrades().filter(g => g.classId === id));
const pct = g => g.outOf ? g.score / g.outOf * 100 : 0;
const fmtPct = p => (Math.round(p * 10) / 10).toString().replace(/\.0$/, "") + "%";
// the class average after each grade, oldest first (for the trend line)
function trend(c) {
  const g = gradesOf(c.id).filter(x => x.outOf > 0).sort((a, b) => (a.at || a.seen || 0) - (b.at || b.seen || 0)), out = [];
  for (let i = 1; i <= g.length; i++) { const sub = g.slice(0, i); out.push(classAvgOf(c, sub)); }
  return out;
}
// slipping: the average now vs. before the last few grades
function slipping(c) { const t = trend(c); if (t.length < 4) return 0; const before = t[Math.max(0, t.length - 4)], now = t[t.length - 1]; return before - now >= 3 ? before - now : 0; }
// ---------- grade history: every change to a class's average, and why ----------
// Regrades: a teacher changing a score after the fact. Skyline remembers the score it last saw for each grade and
// writes down any change (D.gradeLog); new grades need no log, they're in the grades themselves.
function trackGrades() {
  const all = crGrades().concat(D.grades).filter(g => g.outOf > 0 && g.classId), snap = D.gradeSnap || null, now = Date.now();
  const next = {}; for (const g of all) next[g.id] = [g.score, g.outOf];
  if (snap) {
    let changed = false;
    for (const g of all) { const was = snap[g.id]; if (was && (was[0] !== g.score || was[1] !== g.outOf)) { (D.gradeLog = D.gradeLog || []).push({ t: now, id: g.id, classId: g.classId, name: g.name || "Grade", from: was, to: [g.score, g.outOf] }); changed = true; } }
    if (D.gradeLog && D.gradeLog.length > 300) D.gradeLog = D.gradeLog.slice(-300);
    if (changed || Object.keys(snap).length !== Object.keys(next).length) { D.gradeSnap = next; save(); }
  } else { D.gradeSnap = next; save(); }
}
// the timeline for one class, newest first: each grade as it came in (what the average was before and after it),
// plus regrades. The average is worked out the same way as everywhere else (weights included).
function history(c) {
  const g = gradesOf(c.id).filter(x => x.outOf > 0).sort((a, b) => (a.at || a.seen || 0) - (b.at || b.seen || 0)), out = [];
  for (let i = 0; i < g.length; i++) {
    const before = i ? classAvgOf(c, g.slice(0, i)) : null, after = classAvgOf(c, g.slice(0, i + 1));
    out.push({ kind: "grade", at: g[i].at || g[i].seen || 0, g: g[i], before, after, delta: before == null ? 0 : after - before });
  }
  for (const r of (D.gradeLog || []).filter(r => r.classId === c.id)) {
    const cur = g.find(x => x.id === r.id); if (!cur) continue;
    const old = g.map(x => x.id === r.id ? { ...x, score: r.from[0], outOf: r.from[1] } : x), now = g.map(x => x.id === r.id ? { ...x, score: r.to[0], outOf: r.to[1] } : x);
    const before = classAvgOf(c, old), after = classAvgOf(c, now);
    out.push({ kind: "regrade", at: r.t, g: cur, from: r.from, to: r.to, before, after, delta: after - before });
  }
  return out.sort((a, b) => b.at - a.at);
}
function historyHtml(c) {
  const h = history(c); if (!h.length) return "";
  const worst = h.filter(x => x.delta < -0.05).sort((a, b) => a.delta - b.delta)[0];
  const day = t => t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date";
  const row = x => {
    const p = x.kind === "regrade" ? x.to[0] / x.to[1] * 100 : pct(x.g), d = x.delta, cls = Math.abs(d) < 0.05 ? "" : d < 0 ? "down" : "up";
    const what = x.kind === "regrade" ? `<b>${esc(x.g.name || "Grade")}</b> regraded ${fmtPct(x.from[0] / x.from[1] * 100)} → ${fmtPct(p)}` : `<b>${esc(x.g.name || "Grade")}</b> · ${fmtPct(p)} (${x.g.score}/${x.g.outOf})`;
    return `<div class="sc-hi ${cls}${x === worst ? " worst" : ""}"><span class="sc-hd">${day(x.at)}</span><span class="sc-hw"><span>${what}</span><small>${x.before == null ? `First grade: average ${fmtPct(x.after)}` : `Average ${fmtPct(x.before)} → ${fmtPct(x.after)}`}</small></span>
      <span class="sc-hc" title="${cls ? "How much this moved your average" : "No change to your average"}">${x.before == null ? "" : cls ? icon(d < 0 ? "trendDown" : "trendUp") + (d > 0 ? "+" : "−") + Math.abs(Math.round(d * 10) / 10) : "–"}</span></div>`;
  };
  const shown = S.histAll ? h : h.slice(0, 8);
  return `<div class="sc-hist"><div class="pg-sub">Grade history<span class="sp"></span>${h.length > 8 ? `<button class="btn xs ghost" data-hist>${S.histAll ? "Show less" : `Show all ${h.length}`}</button>` : ""}</div>
    ${worst ? `<p class="sc-hwhy">Biggest drop: <b>${esc(worst.g.name || "a grade")}</b> on ${day(worst.at)} took your average down ${Math.abs(Math.round(worst.delta * 10) / 10)} points.</p>` : ""}
    <div class="sc-hl">${shown.map(row).join("")}</div></div>`;
}
function classAvgOf(c, g) {
  const w = c.weights && Object.values(c.weights).some(v => v > 0) ? c.weights : null;
  if (!w) return sum(g, x => x.score) / sum(g, x => x.outOf) * 100;
  let tot = 0, ws = 0; for (const [cat, wt] of Object.entries(w)) { if (!(wt > 0)) continue; const gc = g.filter(x => (x.cat || "other") === cat); if (!gc.length) continue; tot += wt * sum(gc, x => x.score) / sum(gc, x => x.outOf); ws += wt; }
  return ws ? tot / ws * 100 : sum(g, x => x.score) / sum(g, x => x.outOf) * 100;
}
function classAvg(c, add) {
  const g = gradesOf(c.id).filter(x => x.outOf > 0).concat(add ? [add] : []); if (!g.length) return null;
  const w = c.weights && Object.values(c.weights).some(v => v > 0) ? c.weights : null;
  if (!w) return sum(g, x => x.score) / sum(g, x => x.outOf) * 100;
  let tot = 0, ws = 0;
  for (const [cat, wt] of Object.entries(w)) { if (!(wt > 0)) continue; const gc = g.filter(x => (x.cat || "other") === cat); if (!gc.length) continue; tot += wt * sum(gc, x => x.score) / sum(gc, x => x.outOf); ws += wt; }
  return ws ? tot / ws * 100 : sum(g, x => x.score) / sum(g, x => x.outOf) * 100;
}
const LETTERS = [[97, "A+", 4], [93, "A", 4], [90, "A-", 3.7], [87, "B+", 3.3], [83, "B", 3], [80, "B-", 2.7], [77, "C+", 2.3], [73, "C", 2], [70, "C-", 1.7], [67, "D+", 1.3], [63, "D", 1], [60, "D-", .7], [0, "F", 0]];
const letter = p => (LETTERS.find(([min]) => p >= min) || LETTERS[LETTERS.length - 1]);
const gradeColor = p => p >= 90 ? "#34d399" : p >= 80 ? "#60a5fa" : p >= 70 ? "#fbbf24" : p >= 60 ? "#fb923c" : "#fb7185";
// the least you need on the next one to get to your goal
function need(c, target, points, cat) {
  const at = x => classAvg(c, { score: x, outOf: points, cat });
  if ((at(0) ?? 0) >= target) return { safe: true, at0: at(0) };
  if (at(points * 1.5) < target) return { never: true, best: at(points) };
  let lo = 0, hi = points * 1.5; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(mid) >= target) hi = mid; else lo = mid; }
  const score = Math.ceil(Math.round(hi * 1000) / 1000 * 2) / 2;   // to the half point, without float dust (95.0000001 is 95)
  return { score, pct: score / points * 100 };
}

/* ---------- flashcards ---------- */
const deckDue = d => d.cards.filter(c => (c.due || 0) <= Date.now());
const mastery = d => d.cards.length ? Math.round(sum(d.cards, c => Math.min(5, c.box || 0)) / (d.cards.length * 5) * 100) : 0;
// "term - definition", "term: definition", Quizlet's "term<tab>definition", one per line
function parseCards(text) {
  return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(.+?)\s*(?:\t|\s[-–—=]\s|:\s)\s*(.+)$/); return m ? { q: m[1].trim().slice(0, 200), a: m[2].trim().slice(0, 400) } : null; }).filter(Boolean);
}
const newCard = c => ({ id: uid("k"), q: c.q, a: c.a, box: 0, due: 0 });
function offlineQuiz(deck, n = 10) {
  const answers = [...new Set(deck.cards.map(c => c.a))];
  if (answers.length < 4) return null;
  return shuffle(deck.cards).slice(0, n).map(c => { const wrong = shuffle(answers.filter(a => a !== c.a)).slice(0, 3), choices = shuffle([c.a, ...wrong]); return { q: c.q, choices, answer: choices.indexOf(c.a), why: "" }; });
}

/* ---------- reminders ---------- */
const voiceOn = () => D.remind.voice !== false;
function say(text) { if (!voiceOn() || !text) return; import("./assistant.js").then(m => m.Assistant.speak(text)).catch(() => {}); }
const spokenList = list => list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
function remind() {
  if (!D || !D.remind.on || !sky) return;
  const now = new Date(), k = ymd(now), mins = now.getHours() * 60 + now.getMinutes(), all = items().filter(i => !i.done);
  if (mins >= toMin(D.remind.at || "19:00") && D.reminded.evening !== k) {   // the evening heads-up: what's due tomorrow
    D.reminded.evening = k; save();
    const tmr = all.filter(i => dayStart(i.when) === addDays(today(), 1)), over = all.filter(late);
    if (tmr.length) say(`Heads up: ${tmr.length === 1 ? "your " + tmr[0].title + " is" : "you have " + tmr.length + " things"} due tomorrow${tmr.length > 1 ? ": " + spokenList(tmr.slice(0, 4).map(i => i.title)) : ""}.${over.length ? ` And ${over.length} ${over.length === 1 ? "thing is" : "things are"} overdue.` : ""}`);
    else if (over.length) say(`You have ${over.length} overdue ${over.length === 1 ? "assignment" : "assignments"}.`);
    if (tmr.length || over.length) sky.app.notify({ title: tmr.length ? `${tmr.length} thing${tmr.length > 1 ? "s" : ""} due tomorrow` : `${over.length} overdue`,
      body: tmr.slice(0, 4).map(i => `• ${i.title}${clsName(i.classId) ? " (" + clsName(i.classId) + ")" : ""}`).join("\n") + (over.length && tmr.length ? `\n+ ${over.length} overdue` : over.length ? over.slice(0, 4).map(i => `• ${i.title}`).join("\n") : "") });
  }
  if (now.getHours() >= 7) for (const t of all.filter(i => i.kind === "test")) {   // tests: 3 days and 1 day ahead, in the morning
    const n = Math.round((dayStart(t.when) - today()) / day), id = t.key + "|" + n;
    if ((n === 3 || n === 1) && !D.reminded.tests[id]) { D.reminded.tests[id] = 1; save(); sky.app.notify({ title: `${t.title} ${n === 1 ? "is tomorrow" : "in 3 days"}`, body: `${clsName(t.classId) || "Test"} · Make a flashcard deck and quiz yourself on the School page.` }); }
  }
}

/* ---------- the page ---------- */
export const School = {
  async init() {
    D = Object.assign({ classes: [], work: [], links: [], crDone: {}, extra: {}, periods: [], grades: [], decks: [], doneLog: {}, remind: { on: true, at: "19:00" }, reminded: { tests: {} } }, (await store.read("school")) || {});
    if (!D.links.length && !D.linksSet) D.links = [{ name: "Google Classroom", url: "https://classroom.google.com" }, { name: "Google Docs", url: "https://docs.google.com" }, { name: "Quizlet", url: "https://quizlet.com" }, { name: "Khan Academy", url: "https://www.khanacademy.org" }];
    D.reminded.tests = D.reminded.tests || {};
    await Classroom.init();
    trackGrades();   // (remembers today's scores, so a regrade later shows up in the grade history)
    const v = $("#view-school");
    v.addEventListener("click", e => this.click(e));
    v.addEventListener("submit", e => { e.preventDefault(); this.submit(e.target, e); });
    v.addEventListener("change", e => this.change(e));
    v.addEventListener("input", e => this.input(e));
    addEventListener("keydown", e => this.key(e), true);   // study sessions take the keyboard first
    setInterval(() => { if (this.visible()) this.tick(); remind(); }, 20e3);
    setTimeout(remind, 30e3);
    phoneSoon(60000);   // (your phone gets today's summary a minute after Skyline starts)
  },
  visible() { return !!$("#view-school:not(.hidden)"); },
  show() { this.render(); Classroom.shown(); },
  // the clock-driven bits only (what class is on, minutes left): no full redraw
  tick() { this.renderHero(); if (S.tab === "schedule") this.renderTimeline(); },
  render() {
    if (!D || !$("#scBody")) return;
    $$("#scTabs button").forEach(b => b.classList.toggle("on", b.dataset.v === S.tab));
    this.renderHero();
    ({ agenda: () => this.renderAgenda(), calendar: () => this.renderCalendar(), schedule: () => this.renderSchedule(), grades: () => this.renderGrades(), study: () => this.renderStudy() }[S.tab] || (() => this.renderAgenda()))();
    this.renderOverlay();
  },
  setTab(t) { S.tab = t; store.local("sc-tab", t); this.render(); FX.cascade($("#scBody")); },

  /* ----- the top: class now, what's due next, your streak ----- */
  renderHero() {
    const box = $("#scHero"); if (!box) return;
    const nn = nowNext(), all = items().filter(i => !i.done).sort((a, b) => a.when - b.when), t0 = today();
    const over = all.filter(late), dueToday = all.filter(i => !late(i) && dayStart(i.when) === t0), week = all.filter(i => !late(i) && dayStart(i.when) < addDays(t0, 7));
    const next = all.find(i => !late(i)) || over[0];
    let a;
    if (!D.periods.length) a = `<span class="sc-hk">Class schedule</span><b class="sc-hb">Add your classes and times</b><p>See which class is on now, what's next, and how long until the bell.</p><button class="btn xs" data-tab="schedule">Set up schedule</button>`;
    else if (nn.now) { const left = toMin(nn.now.end) - nn.mins, len = toMin(nn.now.end) - toMin(nn.now.start), pct = Math.round((1 - left / len) * 100);
      a = `<span class="sc-hk"><i class="sc-live"></i>Now</span><b class="sc-hb" style="--c:${periodColor(nn.now)}"><i class="dot"></i>${esc(periodName(nn.now))}</b><p>${nn.now.room ? esc(nn.now.room) + " · " : ""}${left} min left · ends ${clock(nn.now.end)}</p>
        <div class="sc-bar"><i style="width:${pct}%;background:${periodColor(nn.now)}"></i></div>${nn.next ? `<small>Next: ${esc(periodName(nn.next))} at ${clock(nn.next.start)}</small>` : `<small>Last class today</small>`}`; }
    else if (nn.next) { const inMin = toMin(nn.next.start) - nn.mins;
      a = `<span class="sc-hk">Next class</span><b class="sc-hb" style="--c:${periodColor(nn.next)}"><i class="dot"></i>${esc(periodName(nn.next))}</b><p>${nn.next.room ? esc(nn.next.room) + " · " : ""}at ${clock(nn.next.start)} · in ${inMin >= 60 ? Math.floor(inMin / 60) + " h " + (inMin % 60) + " min" : inMin + " min"}</p>`; }
    else a = `<span class="sc-hk">School's out</span><b class="sc-hb">${nn.later ? `${esc(periodName(nn.later.p))} ${nn.later.day === 1 ? "tomorrow" : DAY_NAMES[(new Date().getDay() + nn.later.day) % 7]}` : "No classes set"}</b><p>${nn.later ? `First class at ${clock(nn.later.p.start)}` : ""}</p>`;
    const b = next ? `<span class="sc-hk">${late(next) ? "Overdue" : "Due next"}</span><b class="sc-hb" style="--c:${clsColor(next.classId)}"><i class="dot"></i>${esc(next.title)}</b><p>${esc(clsName(next.classId) || (next.src === "classroom" ? "Classroom" : "Homework"))} · ${esc(dueText(next))}</p>
        <div class="sc-hcounts"><span class="${over.length ? "bad" : ""}"><b>${over.length}</b> overdue</span><span class="${dueToday.length ? "warn" : ""}"><b>${dueToday.length}</b> today</span><span><b>${week.length}</b> this week</span></div>`
      : `<span class="sc-hk">Due next</span><b class="sc-hb">Nothing due</b><p>${Classroom.st.connected ? "You're all caught up." : "Add homework below, or connect Google Classroom."}</p>`;
    const st = streak(), bars = [...Array(7)].map((_, i) => { const t = addDays(today(), i - 6); return { n: D.doneLog[ymd(t)] || 0, d: DAY_NAMES[new Date(t).getDay()][0], today: i === 6 }; }), mx = Math.max(1, ...bars.map(x => x.n));
    const c = `<span class="sc-hk">${st ? "Streak" : "Done this week"}</span><b class="sc-hb">${st ? `${st} day${st > 1 ? "s" : ""}` : sum(bars, x => x.n) + " done"}</b><p>${st ? `${sum(bars, x => x.n)} done this week. Keep it going!` : "Finish something today to start a streak."}</p>
      <div class="sc-week">${bars.map(x => `<span class="${x.today ? "on" : ""}" title="${x.n} done"><i style="height:${Math.round(x.n / mx * 100)}%"></i><small>${x.d}</small></span>`).join("")}</div>`;
    const html = `<div class="glass sc-h">${a}</div><div class="glass sc-h">${b}</div><div class="glass sc-h">${c}</div>`;
    if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  },

  /* ----- agenda ----- */
  renderAgenda() {
    const t0 = today(), all = items(), f = S.filter;
    const pass = i => f === "all" || (f === "classroom" && i.src === "classroom") || (f === "mine" && i.src === "mine") || (f === "tests" && i.kind === "test") || i.classId === f;
    const open = all.filter(i => !i.done && pass(i)).sort((a, b) => a.when - b.when), done = all.filter(i => i.done && pass(i)).sort((a, b) => b.doneAt - a.doneAt).slice(0, 8);
    const groups = [["Overdue", i => late(i)], ["Today", i => dayStart(i.when) === t0], ["Tomorrow", i => dayStart(i.when) === addDays(t0, 1)], ["This week", i => dayStart(i.when) < addDays(t0, 7)], ["Next week", i => dayStart(i.when) < addDays(t0, 14)], ["Later", () => true]];
    const placed = new Set(), sections = groups.map(([name, test]) => { const l = open.filter(i => !placed.has(i.key) && test(i)); l.forEach(i => placed.add(i.key)); return l.length ? `<div class="sc-g ${name === "Overdue" ? "bad" : ""}">${name}<span>${l.length}</span></div>` + l.map(i => this.row(i)).join("") : ""; }).join("");
    const usedCls = [...new Set(all.filter(i => !i.done).map(i => i.classId).filter(Boolean))];
    const chips = [["all", "All"], ["classroom", CR_ICON + "Classroom"], ["mine", "Mine"], ["tests", "Tests"], ...usedCls.map(id => [id, clsName(id)])].map(([v, n]) => `<button class="sc-f ${f === v ? "on" : ""}" data-filter="${esc(v)}" ${cls(v) ? `style="--c:${clsColor(v)}"` : ""}>${cls(v) ? `<i class="dot"></i>` : ""}${v === "classroom" ? n : esc(n)}</button>`).join("");
    const q = $("#scQuick input[name=text]"), keep = q ? { text: q.value, focus: document.activeElement === q } : null;
    $("#scBody").innerHTML = `<div class="pg-cols sc-cols">
      <section class="glass pg-card">
        <form class="sc-quick" id="scQuick"><div class="sc-qrow"><input name="text" placeholder="Add homework… try “math worksheet due friday” or “science test oct 20”" maxlength="140" autocomplete="off"><button class="btn primary">Add</button></div>
          <div class="sc-qrow sm"><span class="sc-guess" id="scGuess"></span><select name="cls" title="Class"><option value="">No class</option>${D.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
          <select name="kind" title="Type">${Object.entries(KINDS).map(([k, [i, n]]) => `<option value="${k}">${n}</option>`).join("")}</select><input name="due" type="date" title="Due" value="${ymd(addDays(t0, 1))}"></div></form>
        <div class="sc-fs">${chips}</div>
        ${this.crBanner()}${this.focusBar()}${this.cardHints()}
        <div class="sc-list">${sections || `<div class="sc-empty"><b>Nothing due${f !== "all" ? " here" : ""}</b><span>${Classroom.st.connected ? "You're all caught up." : "Add homework above, or connect Google Classroom to fill this in by itself."}</span></div>`}</div>
        ${done.length ? `<div class="sc-g">Done<span>${done.length}</span><button class="btn xs ghost" data-sc="clear">Clear mine</button></div>` + done.map(i => this.row(i)).join("") : ""}
      </section>
      <div class="pg-side">${this.crCard()}${this.classesCard()}${this.linksCard()}${this.remindCard()}</div></div>`;
    if (keep && keep.text) { const n = $("#scQuick input[name=text]"); n.value = keep.text; this.guess(); if (keep.focus) n.focus(); }
    this.favicons();
  },
  row(i) {
    const c = clsColor(i.classId), steps = i.steps.length ? `${i.steps.filter(s => s.done).length}/${i.steps.length} steps` : "", open = S.open === i.key;
    const meta = [esc(clsName(i.classId) || (i.src === "classroom" ? (i.x.cls ? shortName(i.x.cls) : "Classroom") : "No class")), i.src === "classroom" ? "Classroom" : "", i.missing ? "<em>missing</em>" : "", i.points ? i.points + " pts" : "", steps].filter(Boolean).join(" · ");
    return `<div class="sc-it ${late(i) ? "late" : ""} ${!i.done && !late(i) && i.when - Date.now() < 36e5 * 30 ? "soon" : ""} ${i.done ? "done" : ""} ${open ? "open" : ""}" style="--c:${c}" data-key="${esc(i.key)}">
      <div class="sc-r"><button class="sc-ck" data-ck="${esc(i.key)}" title="${i.done ? "Not done" : "Mark done"}" aria-label="${i.done ? "Not done" : "Mark done"}">${icon("check")}</button><span class="sc-k" title="${(KINDS[i.kind] || KINDS.hw)[1]}">${icon((KINDS[i.kind] || KINDS.hw)[0])}</span>
        <button class="sc-m" data-tog="${esc(i.key)}"><b>${esc(i.title)}</b><small><i class="dot"></i>${meta}</small></button>
        <span class="sc-when">${esc(dueText(i))}</span>
        <span class="sc-acts">${i.url ? `<button class="ibtn xs" data-act="open" title="Open in Google Classroom">↗</button>` : ""}<button class="ibtn xs" data-act="focus" title="Focus on this for 25 minutes" aria-label="Focus on this for 25 minutes">${icon("timer")}</button>${i.src === "mine" ? `<button class="ibtn xs" data-act="del" title="Remove">${icon("x")}</button>` : ""}</span></div>
      ${open ? this.detail(i) : ""}</div>`;
  },
  detail(i) {
    const busy = S.busy[i.key];
    return `<div class="sc-x">
      ${i.steps.length ? `<div class="sc-steps">${i.steps.map((s, n) => `<label class="sc-step ${s.done ? "done" : ""}"><input type="checkbox" data-step="${n}" ${s.done ? "checked" : ""}><span class="tk"></span><span class="t">${esc(s.t)}</span>${s.mins ? `<small>${s.mins} min</small>` : ""}<button class="ibtn xs" data-stepdel="${n}" title="Remove">${icon("x")}</button></label>`).join("")}</div>` : ""}
      <form class="sc-stepadd" data-stepadd="${esc(i.key)}"><input name="t" placeholder="${i.steps.length ? "Add a step" : "Break it into steps: add one, or let the AI plan it"}" maxlength="140" autocomplete="off"><button class="btn xs">Add</button></form>
      ${i.tip ? `<p class="sc-tip">${esc(i.tip)}</p>` : ""}
      <textarea class="sc-notes" data-notes="${esc(i.key)}" placeholder="Notes: what the teacher said, page numbers, links…" rows="2">${esc(i.notes)}</textarea>
      <div class="sc-xb"><button class="btn xs" data-act="plan" ${busy ? "disabled" : ""}>${busy ? "Planning…" : "Plan it with AI"}</button><button class="btn xs" data-act="focus">Focus 25 min</button><button class="btn xs" data-act="help">Get help</button><button class="btn xs" data-act="cards">Make flashcards</button>
        ${i.url ? `<button class="btn xs" data-act="open">Open in Classroom ↗</button>` : ""}
        ${i.src === "mine" ? `<span class="sp"></span><select data-wkind title="Type">${Object.entries(KINDS).map(([k, [ic, n]]) => `<option value="${k}" ${i.kind === k ? "selected" : ""}>${n}</option>`).join("")}</select><select data-wcls title="Class"><option value="">No class</option>${D.classes.map(c => `<option value="${c.id}" ${c.id === i.classId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select><input type="date" data-wdue value="${ymd(i.when)}" title="Due">` : ""}</div></div>`;
  },
  crBanner() {
    const st = Classroom.st;
    if (!st.connected) return `<div class="sc-cr-cta"><span class="cr-logo">${icon("cap")}</span><div><b>Connect Google Classroom</b><span>Your assignments show up here by themselves, with due dates, and open in one click.</span></div><button class="btn primary sm" data-cr="connect" ${st.signingIn ? "disabled" : ""}>${st.signingIn ? "Signing in…" : "Connect"}</button></div>`;
    if (st.expired) return `<div class="sc-warn">Your school Google sign-in ran out (school accounts ask again every so often). Showing Classroom as of ${esc(ago(st.at))}. <button class="btn xs primary" data-cr="connect" ${st.signingIn ? "disabled" : ""}>${st.signingIn ? "Signing in…" : "Sign in again"}</button></div>`;
    return "";
  },
  crCard() {
    const st = Classroom.st; if (!st.connected) return "";
    const n = items().filter(i => i.src === "classroom" && !i.done).length;
    return `<section class="glass pg-card sc-crc"><div class="pg-h">${CR_ICON} Google Classroom<span class="sp"></span><button class="ibtn xs" data-cr="sync" title="Check Classroom now" ${st.syncing || st.expired ? "disabled" : ""}>↻</button></div>
      <p class="sc-crs">${st.syncing ? `<span class="sc-spin"></span>${esc(st.phase || "Checking Classroom…")}` : st.expired ? "Sign in again to update" : `${n} to do · checked ${esc(ago(st.at))}`}${st.error && !st.expired ? `<br><span class="bad">${esc(st.error)}</span>` : ""}</p>
      <div class="sc-crb"><button class="btn xs" data-cr="open">Open Classroom ↗</button><button class="btn xs ghost" data-cr="off">Disconnect</button></div></section>`;
  },
  classesCard() {
    return `<section class="glass pg-card"><div class="pg-h">Classes</div><div class="sc-classes">${D.classes.length ? D.classes.map(c => `<span class="sc-chip" style="--c:${c.color}"><button class="dot" data-ccol="${c.id}" title="Change colour"></button><button class="nm" data-cren="${c.id}" title="${esc(c.full || "Rename")}">${esc(c.name)}</button>${c.cr ? `<small title="From Google Classroom">${CR_ICON}</small>` : `<button class="ibtn xs" data-cdel="${c.id}" title="Remove class">${icon("x")}</button>`}</span>`).join("") : `<span class="muted">No classes yet${Classroom.st.connected ? "" : ". Connect Classroom and they're added by themselves"}.</span>`}</div>
      <form class="pg-add slim" id="scClassAdd"><input name="name" placeholder="Add a class" autocomplete="off" maxlength="30"><button class="btn sm">Add</button></form></section>`;
  },
  linksCard() {
    return `<section class="glass pg-card"><div class="pg-h">School links</div><div class="sc-links">${D.links.map((l, i) => { let h = ""; try { h = new URL(l.url).hostname.replace(/^www\./, ""); } catch (e) {} return `<div class="sc-link"><button class="lk" data-sclink="${i}" title="${esc(l.url)}"><span class="lk-i" data-host="${esc(h)}">${esc(l.name[0] || "?")}</span><span>${esc(l.name)}</span></button><button class="ibtn xs" data-ldel="${i}" title="Remove">${icon("x")}</button></div>`; }).join("")}</div>
      <form class="pg-add slim" id="scLinkAdd"><input name="name" placeholder="Name" autocomplete="off" maxlength="24" class="w-name"><input name="url" placeholder="Web address" autocomplete="off"><button class="btn sm">Add</button></form></section>`;
  },
  remindCard() {
    return `<section class="glass pg-card"><div class="pg-h">Reminders</div>
      <label class="toggle"><input type="checkbox" data-remind="on" ${D.remind.on ? "checked" : ""}><span class="sw"></span><span class="t"><b>Remind me</b><small>What's due tomorrow at <input type="time" data-remind="at" value="${esc(D.remind.at || "19:00")}" class="sc-time">, tests 3 days and 1 day ahead, new Classroom work and new grades.</small></span></label>
      <label class="toggle"><input type="checkbox" data-remind="voice" ${voiceOn() ? "checked" : ""}><span class="sw"></span><span class="t"><b>Sky says it out loud</b><small>“Your Chapter 7 HW is due tomorrow”, and new grades as they come in.</small></span></label></section>`;
  },
  favicons() {
    $$("#view-school [data-host]").forEach(async e => { if (!e.dataset.host || e.classList.contains("img")) return; const url = await sky.favicon(e.dataset.host).catch(() => null); if (url) { const img = new Image(); img.onload = () => { e.textContent = ""; e.appendChild(img); e.classList.add("img"); }; img.src = url; } });
  },
  guess() {
    const f = $("#scQuick"); if (!f) return;
    const q = parseQuick(f.text.value, D.classes), g = $("#scGuess");
    if (!f.dataset.cls) f.cls.value = q.classId || f.cls.value;
    if (!f.dataset.kind) f.kind.value = q.kind;
    if (!f.dataset.due && q.due) f.due.value = ymd(q.due);
    const bits = [q.classId && clsName(q.classId), q.due && dueText({ when: q.due + day - 60e3 }), q.kind !== "hw" && KINDS[q.kind][1]].filter(Boolean);
    g.innerHTML = f.text.value.trim() && bits.length ? `→ ${bits.map(esc).join(" · ")}` : "";
  },

  /* ----- calendar ----- */
  renderCalendar() {
    const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + S.calOff);
    const y = base.getFullYear(), m = base.getMonth(), lead = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate(), weeks = Math.ceil((lead + dim) / 7), t0 = today();
    const byDay = {};
    for (const i of items()) (byDay[dayStart(i.when)] = byDay[dayStart(i.when)] || []).push(i);
    const cells = [...Array(weeks * 7)].map((_, n) => {
      const t = new Date(y, m, 1 - lead + n).getTime(), list = (byDay[t] || []).filter(i => !i.done), out = new Date(t).getMonth() !== m;
      return `<button class="sc-cd ${out ? "out" : ""} ${t === t0 ? "today" : ""} ${t === S.calDay ? "sel" : ""} ${list.some(i => i.kind === "test") ? "test" : ""}" data-calday="${t}"><span class="n">${new Date(t).getDate()}</span>
        ${list.slice(0, 3).map(i => `<span class="pill" style="--c:${clsColor(i.classId)}">${i.kind === "test" ? "" : ""}${esc(i.title)}</span>`).join("")}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ""}</button>`;
    }).join("");
    const sel = S.calDay || t0, list = (byDay[sel] || []).sort((a, b) => a.done - b.done || a.when - b.when);
    $("#scBody").innerHTML = `<div class="pg-cols sc-cols"><section class="glass pg-card">
        <div class="sc-calh"><button class="ibtn" data-cal="-1" title="Previous month">‹</button><b>${base.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b><button class="ibtn" data-cal="1" title="Next month">›</button><span class="sp"></span>${S.calOff ? `<button class="btn xs ghost" data-cal="0">Today</button>` : ""}</div>
        <div class="sc-cal"><div class="sc-cwd">${DAY_NAMES.map(d => `<span>${d.slice(0, 3)}</span>`).join("")}</div><div class="sc-cgrid">${cells}</div></div></section>
      <div class="pg-side"><section class="glass pg-card"><div class="pg-h">${new Date(sel).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
        <div class="sc-list">${list.length ? list.map(i => this.row(i)).join("") : `<div class="pg-empty">Nothing due this day.</div>`}</div>
        <form class="pg-add slim" id="scCalAdd" data-day="${sel}"><input name="text" placeholder="Add something due this day" maxlength="140" autocomplete="off"><button class="btn sm">Add</button></form></section></div></div>`;
  },

  /* ----- class schedule ----- */
  renderSchedule() {
    $("#scBody").innerHTML = `<div class="pg-cols sc-cols"><section class="glass pg-card" id="scTl"></section>
      <section class="glass pg-card"><div class="pg-h">Your periods<span class="sp"></span><button class="btn xs" data-padd>＋ Add period</button></div><div class="sc-pe" id="scPe"></div></section></div>`;
    this.renderTimeline(); this.renderPeriods();
  },
  // the day, with the class that's on now (redrawn by the clock)
  renderTimeline() {
    const box = $("#scTl"); if (!box) return;
    const dow = S.schedDay ?? new Date().getDay(), isToday = dow === new Date().getDay(), list = dayPeriods(dow), nn = nowNext();
    const timeline = list.length ? list.map(p => {
      const st = isToday ? (nn.mins >= toMin(p.end) ? "past" : nn.mins >= toMin(p.start) ? "now" : "") : "", pct = st === "now" ? Math.round((nn.mins - toMin(p.start)) / (toMin(p.end) - toMin(p.start)) * 100) : 0;
      return `<div class="sc-p ${st}" style="--c:${periodColor(p)}"><span class="tm">${clock(p.start)}<small>${clock(p.end)}</small></span><span class="nm"><b>${esc(periodName(p))}</b><small>${[p.room, st === "now" ? `${toMin(p.end) - nn.mins} min left` : ""].filter(Boolean).map(esc).join(" · ")}</small>${st === "now" ? `<span class="sc-bar"><i style="width:${pct}%;background:${periodColor(p)}"></i></span>` : ""}</span></div>`;
    }).join("") : `<div class="pg-empty">No classes on ${DAY_NAMES[dow]}.${D.periods.length ? "" : " Add your periods on the right."}</div>`;
    const html = `<div class="pg-h">${isToday ? "Today" : DAY_NAMES[dow]}<span class="sp"></span><div class="seg sm">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button data-sday="${d}" class="${d === dow ? "on" : ""}">${DAY_NAMES[d].slice(0, 3)}</button>`).join("")}</div></div><div class="sc-tl">${timeline}</div>`;
    if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  },
  // the editor: only redrawn when periods are added, removed or re-sorted (never while you type a time)
  renderPeriods() {
    const box = $("#scPe"); if (!box) return;
    box.innerHTML = D.periods.length ? D.periods.slice().sort((a, b) => toMin(a.start) - toMin(b.start)).map(p => `<div class="sc-pr" data-pid="${p.id}" style="--c:${periodColor(p)}">
          <select data-pf="classId"><option value="">${esc(p.name || "Other…")}</option>${D.classes.map(c => `<option value="${c.id}" ${c.id === p.classId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}<option value="__name">Name it (Lunch, Homeroom…)</option></select>
          <input type="time" data-pf="start" value="${p.start}"><span class="muted">–</span><input type="time" data-pf="end" value="${p.end}"><input data-pf="room" value="${esc(p.room || "")}" placeholder="Room" maxlength="16" class="rm">
          <span class="sc-days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button data-pday="${d}" class="${(p.days || []).includes(d) ? "on" : ""}" title="${DAY_NAMES[d]}">${DAY_NAMES[d][0]}</button>`).join("")}</span><button class="ibtn xs" data-pdel title="Remove">${icon("x")}</button></div>`).join("")
      : `<div class="pg-empty">Add each class period with its start and end time and pick the days it happens. Skyline shows what's on now and counts down to the bell.</div>`;
  },

  /* ----- grades ----- */
  renderGrades() {
    const withG = D.classes.map(c => ({ c, avg: classAvg(c), n: gradesOf(c.id).length })).sort((a, b) => (b.avg != null) - (a.avg != null));
    const graded = withG.filter(x => x.avg != null), overall = graded.length ? sum(graded, x => x.avg) / graded.length : null, gpa = graded.length ? sum(graded, x => letter(x.avg)[2]) / graded.length : null;
    if (!S.gradeCls || !cls(S.gradeCls)) { const newest = crGrades().concat(D.grades).filter(g => g.classId).sort((a, b) => (b.seen || b.at || 0) - (a.seen || a.at || 0))[0]; S.gradeCls = (newest && newest.classId) || (graded[0] || withG[0] || {}).c?.id || null; }   // the class with the newest grade
    const c = cls(S.gradeCls);
    const ring = p => `<span class="sc-ring" style="--p:${p == null ? 0 : Math.min(100, p)};--c:${p == null ? "#475569" : gradeColor(p)}"><b>${p == null ? "–" : Math.round(p)}</b></span>`;
    const spark = id => { const g = gradesOf(id).filter(x => x.outOf > 0).sort((a, b) => (a.at || a.seen) - (b.at || b.seen)).slice(-10); if (g.length < 2) return ""; const pts = g.map((x, i) => `${(i / (g.length - 1) * 76 + 2).toFixed(1)},${(22 - Math.max(0, Math.min(110, x.score / x.outOf * 100)) / 110 * 20).toFixed(1)}`).join(" "); return `<svg class="sc-spark" viewBox="0 0 80 24"><polyline points="${pts}"/></svg>`; };
    const cards = withG.map(({ c: k, avg, n }) => `<button class="sc-gc ${k.id === S.gradeCls ? "on" : ""}" data-gcls="${k.id}" style="--c:${k.color}">${ring(avg)}<span class="t"><b>${esc(k.name)}</b><small>${avg == null ? "No grades yet" : `${letter(avg)[1]} · ${n} grade${n > 1 ? "s" : ""}${slipping(k) ? " · dropping" : ""}`}</small></span>${spark(k.id)}</button>`).join("");
    let detail = `<div class="pg-empty">Add a class first (on the Agenda tab, or connect Google Classroom).</div>`;
    if (c) {
      const g = gradesOf(c.id).sort((a, b) => (b.at || b.seen || 0) - (a.at || a.seen || 0)), avg = classAvg(c), w = c.weights || {};
      const nd = $("#scNeed"), tgt = +(nd && nd.target.value) || D.goal?.[c.id] || 90, pts = +(nd && nd.pts.value) || 100, cat = (nd && nd.cat.value) || "test", r = avg == null ? null : need(c, tgt, pts, cat);
      const tr = trend(c), slip = slipping(c);
      const chart = tr.length >= 2 ? (() => { let lo = Math.min(...tr) - 5, hi = Math.max(...tr) + 5; if (hi - lo < 24) { const mid = (hi + lo) / 2; lo = mid - 12; hi = mid + 12; } const X = i => (i / (tr.length - 1) * 560 + 20).toFixed(1), Y = v => (110 - (v - lo) / (hi - lo || 1) * 90).toFixed(1);
        return `<svg class="sc-trend" viewBox="0 0 600 130" preserveAspectRatio="none"><defs><linearGradient id="scTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.color}" stop-opacity=".22"/><stop offset="1" stop-color="${c.color}" stop-opacity="0"/></linearGradient></defs><path d="M${tr.map((v, i) => X(i) + " " + Y(v)).join(" L")} L${X(tr.length - 1)} 125 L20 125Z" fill="url(#scTrendFill)"/><polyline points="${tr.map((v, i) => X(i) + "," + Y(v)).join(" ")}" fill="none" stroke="${c.color}" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${[100, 90, 80, 70].filter(v => v > lo + 2 && v < hi - 2).map(v => `<line x1="20" x2="556" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.12)" stroke-dasharray="4 6"/><text x="562" y="${(+Y(v) + 4).toFixed(1)}" fill="rgba(255,255,255,.45)" font-size="11">${v}</text>`).join("")}<circle cx="${X(tr.length - 1)}" cy="${Y(tr[tr.length - 1])}" r="5" fill="${c.color}"/></svg>`; })() : "";
      detail = `<div class="pg-h" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}<span class="sp"></span>${avg != null ? `<span class="sc-big" style="color:${gradeColor(avg)}">${avg.toFixed(1)}% · ${letter(avg)[1]}</span>` : ""}</div>
        ${slip ? `<div class="sc-warn">Your ${esc(c.name)} average dropped ${slip.toFixed(1)} points over the last few grades. A study session or a chat with your teacher could help.</div>` : ""}${chart ? `<div class="sc-trendw"><small>Your average over time</small>${chart}</div>` : ""}${historyHtml(c)}
        <form class="pg-add" id="scGradeAdd"><input name="name" placeholder="What was it? e.g. Unit 2 test" maxlength="60" autocomplete="off"><input name="score" type="number" step="0.5" min="0" placeholder="Score" class="w-amt"><span class="muted">/</span><input name="outOf" type="number" step="0.5" min="0.5" placeholder="Out of" value="100" class="w-amt">
          <select name="cat">${Object.entries(CATS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select><button class="btn primary">Add</button></form>
        <div class="sc-gl">${g.length ? g.map(x => { const p = x.outOf ? x.score / x.outOf * 100 : 0; return `<div class="sc-gr"><span class="p" style="color:${gradeColor(p)}">${Math.round(p)}%</span><span class="t"><b>${x.cr ? CR_ICON + " " : ""}${esc(x.name || "Grade")}</b><small>${CATS[x.cat] || "Other"}${x.at ? " · " + (x.cr ? "due " : "") + new Date(x.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}${x.late ? " · late" : ""}${x.cr ? " · from Classroom" : ""}</small></span><span class="s">${x.score} / ${x.outOf}</span>${x.cr ? `<span class="sc-gsp"></span>` : `<button class="ibtn xs" data-gdel="${x.id}" title="Remove">${icon("x")}</button>`}</div>`; }).join("") : `<div class="pg-empty">No grades in ${esc(c.name)} yet.${Classroom.st.connected ? " Grades from Google Classroom show up here by themselves." : ""} You can add scores yourself above.</div>`}</div>
        ${avg != null ? `<div class="sc-need"><div class="pg-sub">What do I need?</div><form id="scNeed" class="sc-needf">To get <input name="target" type="number" min="1" max="110" value="${tgt}" class="w-s">% , on a <input name="pts" type="number" min="1" value="${pts}" class="w-s">-point <select name="cat">${Object.entries(CATS).map(([k, n]) => `<option value="${k}" ${k === cat ? "selected" : ""}>${n.replace(/s$/, "").toLowerCase()}</option>`).join("")}</select> I need:</form>
          <p class="sc-needr">${r.safe ? `You're set: even a 0 keeps you at ${r.at0.toFixed(1)}%.` : r.never ? `Even a perfect score only gets you to ${r.best.toFixed(1)}%. Ask about extra credit!` : `<b>${r.score} / ${pts}</b> (${r.pct.toFixed(1)}%)`}</p></div>` : ""}
        <details class="sc-wts" ${c.weights ? "open" : ""}><summary>Weighted categories (optional)</summary><p class="muted">If your teacher weights grades (like tests 50%, homework 20%), enter the percentages. Leave empty to average by points.</p>
          <div class="sc-wrow">${Object.entries(CATS).map(([k, n]) => `<label>${n}<input type="number" min="0" max="100" data-wt="${k}" value="${w[k] || ""}" placeholder="–">%</label>`).join("")}</div></details>`;
    }
    const st = Classroom.st, recent = crGrades().concat(D.grades.map(g => ({ ...g, seen: g.at }))).filter(g => g.outOf > 0).sort((a, b) => (b.seen || 0) - (a.seen || 0) || (b.at || 0) - (a.at || 0));
    const newIds = new Set((st.freshGrades || []).map(id => "cr:" + id)), more = S.allGrades ? recent : recent.slice(0, 8);
    const recentCard = `<section class="glass pg-card sc-rgc"><div class="pg-h">Recent grades<span class="sp"></span>${st.connected ? `<span class="ct-note">${st.syncing && st.phase ? `<span class="sc-spin"></span>${esc(st.phase)}` : st.gradesAt ? "from Google Classroom · " + esc(ago(st.gradesAt)) : ""}</span>` : ""}</div>
      <div class="sc-rg">${recent.length ? more.map(g => { const p = pct(g); return `<button class="sc-rgr ${newIds.has(g.id) ? "new" : ""}" data-gcls="${g.classId}" style="--c:${clsColor(g.classId)}"><span class="sc-pct" style="color:${gradeColor(p)}">${fmtPct(p)}</span><span class="t"><b>${esc(g.name || "Grade")}</b><small><i class="dot"></i>${esc(clsName(g.classId) || "Class")} · ${g.score}/${g.outOf}${g.late ? " · late" : ""}</small></span>${newIds.has(g.id) ? `<em>NEW</em>` : ""}</button>`; }).join("")
        : `<div class="pg-empty">${st.connected ? (st.syncing ? "Reading your grades from Google Classroom…" : "No grades yet. When a teacher grades something in Classroom, it shows up here, like “Math HW 4 · 95%”.") : "Connect Google Classroom (Agenda tab) and your grades show up here by themselves, like “Math HW 4 · 95%”. Or add scores yourself below."}</div>`}</div>
      ${recent.length > 8 ? `<button class="btn xs ghost sc-rgm" data-allgrades>${S.allGrades ? "Show less" : `Show all ${recent.length}`}</button>` : ""}</section>`;
    const stats = graded.length ? `<div class="sc-gstats"><div><span>Overall</span><b style="color:${gradeColor(overall)}">${overall.toFixed(1)}%</b><small>${graded.length} class${graded.length > 1 ? "es" : ""}</small></div><div><span>GPA</span><b>${gpa.toFixed(2)}</b><small>unweighted</small></div></div>` : "";
    $("#scBody").innerHTML = recentCard + `
      <div class="pg-cols sc-cols"><section class="glass pg-card">${detail}</section><div class="pg-side"><section class="glass pg-card"><div class="pg-h">Your classes</div>${stats}<div class="sc-gcs">${cards || `<div class="pg-empty">No classes yet.</div>`}</div></section></div></div>`;
  },

  /* ----- study: flashcards, quizzes, help ----- */
  renderStudy() {
    const deck = D.decks.find(d => d.id === S.deck);
    const clsOpts = sel => `<option value="">No class</option>${D.classes.map(c => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("")}`;
    const decks = D.decks.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).map(d => { const due = deckDue(d).length, m = mastery(d);
      return `<button class="sc-deck ${d.id === S.deck ? "on" : ""}" data-deck="${d.id}" style="--c:${clsColor(d.classId)}"><b>${esc(d.name)}</b><small><i class="dot"></i>${esc(clsName(d.classId) || "Flashcards")} · ${d.cards.length} card${d.cards.length === 1 ? "" : "s"}${due ? ` · <em>${due} to review</em>` : ""}</small><span class="sc-mast"><i style="width:${m}%"></i></span></button>`; }).join("");
    const left = deck ? `<div class="pg-h" style="--c:${clsColor(deck.classId)}"><button class="ibtn xs" data-deck="" title="All decks">‹</button><i class="dot"></i><span class="sc-dn" data-dren title="Rename">${esc(deck.name)}</span><span class="sp"></span><select data-dcls title="Class">${clsOpts(deck.classId)}</select><button class="ibtn xs" data-ddel title="Delete deck" aria-label="Delete deck">${icon("trash")}</button></div>
        <div class="sc-dacts"><button class="btn primary" data-sess="due" ${deck.cards.length ? "" : "disabled"}>Study${deckDue(deck).length ? ` ${deckDue(deck).length} due` : " all"}</button><button class="btn" data-quiz="deck" ${deck.cards.length >= 4 ? "" : "disabled title='Needs 4 cards'"}>Quiz me</button><button class="btn" data-quiz="ai" ${deck.cards.length && !S.busy.quiz ? "" : "disabled"}>${S.busy.quiz ? "Writing…" : "AI quiz"}</button>
          <span class="sc-mlabel">${mastery(deck)}% learned${deck.best != null ? ` · best quiz ${deck.best}%` : ""}</span></div>
        <form class="sc-cadd" id="scCardAdd"><input name="q" placeholder="Front (term or question)" maxlength="200" autocomplete="off"><input name="a" placeholder="Back (answer)" maxlength="400" autocomplete="off"><button class="btn sm">Add</button></form>
        <div class="sc-cards">${deck.cards.map(k => `<div class="sc-card" data-cid="${k.id}"><span class="q" contenteditable="plaintext-only" data-ced="q">${esc(k.q)}</span><span class="a" contenteditable="plaintext-only" data-ced="a">${esc(k.a)}</span><span class="bx" title="How well you know it">${"●".repeat(Math.min(5, k.box || 0))}${"○".repeat(5 - Math.min(5, k.box || 0))}</span><button class="ibtn xs" data-cdel2="${k.id}" title="Remove">${icon("x")}</button></div>`).join("") || `<div class="pg-empty">No cards yet. Add some above, paste a list below, or make them with AI.</div>`}</div>
        <details class="sc-paste"><summary>Paste a list (from Quizlet or your notes)</summary><form id="scPaste"><textarea name="t" rows="5" placeholder="One card per line:&#10;mitochondria - the powerhouse of the cell&#10;photosynthesis: how plants make food from light&#10;(Quizlet export: term and definition separated by a tab)"></textarea><button class="btn sm">Add cards</button></form></details>`
      : `<div class="pg-h">Flashcard decks<span class="sp"></span><button class="btn xs" data-dnew>＋ New deck</button></div><div class="sc-decks">${decks || `<div class="pg-empty">No decks yet. Make one by hand, paste a list, or let the AI make one from a topic or your notes.</div>`}</div>`;
    const busyC = S.busy.cards, busyQ = S.busy.tquiz, busyH = S.busy.help;
    $("#scBody").innerHTML = `<div class="pg-cols sc-cols"><section class="glass pg-card">${left}</section><div class="pg-side">
      <section class="glass pg-card"><div class="pg-h">Make flashcards with AI</div><form id="scAiCards" class="sc-aif"><input name="topic" placeholder="Topic, e.g. “cell organelles” or “Spanish -ar verbs”" maxlength="120" autocomplete="off" value="${esc(S.cardTopic || "")}">
        <textarea name="notes" rows="3" placeholder="…or paste your notes / study guide here (optional)"></textarea><div class="sc-qrow sm"><select name="cls">${clsOpts(S.cardCls || "")}</select><select name="count">${[8, 12, 20, 30].map(n => `<option ${n === 12 ? "selected" : ""}>${n}</option>`).join("")}</select><span class="muted">cards</span><span class="sp"></span><button class="btn primary sm" ${busyC ? "disabled" : ""}>${busyC ? "Making cards…" : "Make deck"}</button></div></form></section>
      <section class="glass pg-card"><div class="pg-h">Practice quiz</div><form id="scAiQuiz" class="sc-aif"><input name="topic" placeholder="What's the test on? e.g. “Civil War causes”" maxlength="160" autocomplete="off"><div class="sc-qrow sm"><select name="cls">${clsOpts("")}</select><span class="sp"></span><button class="btn sm" ${busyQ ? "disabled" : ""}>${busyQ ? "Writing…" : "Quiz me"}</button></div></form></section>
      <section class="glass pg-card"><div class="pg-h">Homework help</div><form id="scHelp" class="sc-aif"><textarea name="q" rows="3" placeholder="Stuck? Ask how to do something. It explains and gives hints, it won't do it for you." maxlength="2000">${esc(S.help.q)}</textarea><div class="sc-qrow sm"><select name="cls">${clsOpts(S.help.cls)}</select><span class="sp"></span><button class="btn sm" ${busyH ? "disabled" : ""}>${busyH ? "Thinking…" : "Explain it"}</button></div></form>
        ${S.help.a ? `<div class="sc-ans">${esc(S.help.a).replace(/\n/g, "<br>")}</div>` : ""}</section>
      <section class="glass pg-card sc-tips"><div class="pg-h">Study session</div><p class="muted">25 minutes of focus, then a 5-minute break. Phone away!</p><div class="sc-qrow sm"><button class="btn sm" data-sc="study">Start 25 min</button><button class="btn sm ghost" data-focus="45">45 min</button><button class="btn sm ghost" data-focus="15">15 min</button></div></section>
      </div></div>`;
  },
  // study session and quiz: a card in the middle of the page
  renderOverlay() {
    let ov = $("#scOv");
    if (!S.sess && !S.quiz) { if (ov) ov.remove(); return; }
    if (!ov) { ov = document.createElement("div"); ov.id = "scOv"; ov.className = "sc-ov"; $("#view-school").appendChild(ov); }
    if (S.sess) {
      const s = S.sess, deck = D.decks.find(d => d.id === s.deck), card = deck && deck.cards.find(c => c.id === s.queue[0]);
      if (!card) { const pct = s.seen ? Math.round(s.right / s.seen * 100) : 0;
        ov.innerHTML = `<div class="sc-ovc glass"><button class="ibtn sc-x2" data-ovx>${icon("x")}</button><div class="sc-fin"><span class="big">${icon(pct >= 80 ? "trophy" : "cards")}</span><h2>Session done</h2><p>${s.seen} card${s.seen === 1 ? "" : "s"} · ${s.right} known first try · ${mastery(deck)}% of the deck learned</p><div class="sc-qrow"><button class="btn primary" data-ovx>Done</button>${deck.cards.length >= 4 ? `<button class="btn" data-quiz="deck">Quiz me now</button>` : ""}</div></div></div>`;
        return; }
      const done = s.total - s.queue.length;
      ov.innerHTML = `<div class="sc-ovc glass"><button class="ibtn sc-x2" data-ovx title="Stop (Esc)">${icon("x")}</button><div class="sc-ovh"><b>${esc(deck.name)}</b><span>${done} / ${s.total}</span></div><div class="sc-bar"><i style="width:${s.total ? done / s.total * 100 : 0}%"></i></div>
        <button class="sc-flip ${s.flipped ? "back" : ""}" data-flip><span class="f">${esc(card.q)}</span><span class="b">${esc(card.a)}</span><small>${s.flipped ? "" : "Click or press Space to flip"}</small></button>
        <div class="sc-grade ${s.flipped ? "" : "hide"}"><button class="btn bad" data-gr="0">Again <kbd>1</kbd></button><button class="btn" data-gr="1">Got it <kbd>2</kbd></button><button class="btn good" data-gr="2">Easy <kbd>3</kbd></button></div></div>`;
      return;
    }
    const z = S.quiz, q = z.qs[z.i];
    if (!q) { const pct = Math.round(z.score / z.qs.length * 100);
      ov.innerHTML = `<div class="sc-ovc glass"><button class="ibtn sc-x2" data-ovx>${icon("x")}</button><div class="sc-fin"><span class="big">${icon(pct >= 70 ? "trophy" : "cards")}</span><h2>${z.score} / ${z.qs.length} · ${pct}%</h2><p>${pct >= 90 ? "You're ready." : pct >= 70 ? "Nice work. Review the ones you missed." : "Keep going: study the cards, then try again."}</p>
        ${z.missed.length ? `<div class="sc-miss">${z.missed.map(m => `<div><b>${esc(m.q)}</b><span>${esc(m.a)}</span></div>`).join("")}</div>` : ""}<div class="sc-qrow"><button class="btn primary" data-ovx>Done</button><button class="btn" data-quiz="again">Try again</button></div></div></div>`;
      return; }
    ov.innerHTML = `<div class="sc-ovc glass"><button class="ibtn sc-x2" data-ovx title="Stop (Esc)">${icon("x")}</button><div class="sc-ovh"><b>${esc(z.title)}</b><span>${z.i + 1} / ${z.qs.length} · ${z.score} right</span></div><div class="sc-bar"><i style="width:${z.i / z.qs.length * 100}%"></i></div>
      <div class="sc-qq">${esc(q.q)}</div><div class="sc-ch">${q.choices.map((c, n) => `<button class="sc-c ${z.picked == null ? "" : n === q.answer ? "right" : n === z.picked ? "wrong" : "dim"}" data-pick="${n}" ${z.picked == null ? "" : "disabled"}><kbd>${n + 1}</kbd>${esc(c)}</button>`).join("")}</div>
      ${z.picked != null ? `<div class="sc-why ${z.picked === q.answer ? "ok" : "bad"}">${z.picked === q.answer ? "Right!" : "Not quite."} ${esc(q.why || "")}</div><div class="sc-qrow end"><button class="btn primary" data-next>${z.i + 1 < z.qs.length ? "Next" : "See score"} <kbd>Enter</kbd></button></div>` : ""}</div>`;
  },
  startSession(deck, all) {
    const due = deckDue(deck), list = shuffle(all || !due.length ? deck.cards : due).map(c => c.id);
    S.sess = { deck: deck.id, queue: list, total: list.length, seen: 0, right: 0, flipped: false, missed: new Set() };
    this.renderOverlay();
  },
  gradeCard(g) {
    const s = S.sess, deck = D.decks.find(d => d.id === s.deck), card = deck && deck.cards.find(c => c.id === s.queue[0]); if (!card || !s.flipped) return;
    s.queue.shift(); s.flipped = false;
    if (g === 0) { card.box = 0; card.due = 0; if (!s.missed.has(card.id)) { s.missed.add(card.id); s.seen++; } s.queue.splice(Math.min(s.queue.length, 3), 0, card.id); }
    else { if (!s.missed.has(card.id)) { s.seen++; s.right++; } card.box = Math.min(6, (card.box || 0) + g); card.due = addDays(today(), INTERVALS[card.box] || 32); }
    deck.at = Date.now(); save();
    if (!s.queue.length) { FX.confetti(innerWidth / 2, innerHeight / 3); this.render(); } else this.renderOverlay();
  },
  startQuiz(qs, title, deckId) { S.quiz = { qs, title, deck: deckId, i: 0, score: 0, picked: null, missed: [] }; this.renderOverlay(); },
  pick(n) {
    const z = S.quiz, q = z && z.qs[z.i]; if (!q || z.picked != null) return;
    z.picked = n; if (n === q.answer) { z.score++; FX.sound("success"); } else z.missed.push({ q: q.q, a: q.choices[q.answer] });
    this.renderOverlay();
  },
  nextQ() {
    const z = S.quiz; if (!z || z.picked == null) return;
    z.i++; z.picked = null;
    if (z.i >= z.qs.length) { const pct = Math.round(z.score / z.qs.length * 100), deck = D.decks.find(d => d.id === z.deck); if (deck) { deck.best = Math.max(deck.best || 0, pct); save(); } if (pct >= 70) FX.confetti(innerWidth / 2, innerHeight / 3); }
    this.renderOverlay();
  },
  closeOverlay() { S.sess = null; S.quiz = null; this.render(); },
  key(e) {
    if (!this.visible() || (!S.sess && !S.quiz) || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key; let used = true;
    if (k === "Escape") this.closeOverlay();
    else if (S.sess) { if (k === " " || k === "Enter") { if (S.sess.queue.length) { S.sess.flipped = !S.sess.flipped; this.renderOverlay(); } else this.closeOverlay(); } else if (/^[123]$/.test(k)) this.gradeCard(+k - 1); else used = false; }
    else if (S.quiz) { if (/^[1-4]$/.test(k)) this.pick(+k - 1); else if (k === "Enter" || k === " ") { if (S.quiz.i >= S.quiz.qs.length) this.closeOverlay(); else this.nextQ(); } else used = false; }
    if (used) { e.preventDefault(); e.stopPropagation(); }
  },

  /* ----- AI ----- */
  async ai(task, input, busyKey) {
    if (S.busy[busyKey]) return null;
    S.busy[busyKey] = true; this.render();
    try { return await sky.study.ask(task, input); }
    catch (er) { const m = clean(er); toast(m, true); if (/sign in|claude key|needs an ai/i.test(m)) this.needBrain(); return null; }
    finally { S.busy[busyKey] = false; this.render(); }
  },
  // the Refresh button: read Classroom again now
  async refresh() {
    const b = $("[data-sc=refresh]"), st = Classroom.st;
    if (!st.connected) { this.render(); return toast("Connect Google Classroom to load your assignments"); }
    if (st.expired) { toast("Your school sign-in ran out. Sign in again in the window that opened"); return sky.classroom.connect(); }
    if (b) { b.disabled = true; b.innerHTML = `<span class="sc-spin"></span>Refreshing…`; }
    try { Classroom.st = await sky.classroom.sync(true); linkCourses(); toast(Classroom.st.error ? Classroom.st.error : "Up to date with Google Classroom"); }
    catch (er) { toast(clean(er), true); }
    finally { if (b) { b.disabled = false; b.textContent = "↻ Refresh"; } this.render(); }
  },
  needBrain() { dialog({ title: "Study help needs the AI", text: "Connect Sky's brain in Settings → AI (no key needed), or add a Claude key in Settings. Everything else on the School page works without it.", ok: "Go to the AI page", cancel: "Not now" }).then(ok => { if (ok) document.dispatchEvent(new CustomEvent("sky:goto", { detail: "ai" })); }); },
  async planItem(it) {
    const r = await this.ai("plan", { title: it.title, cls: clsName(it.classId) || (it.x && it.x.cls) || "", due: dueText(it), notes: it.notes }, it.key); if (!r) return;
    const e = extra(it); e.steps = (e.steps || []).concat(r.steps.map(s => ({ t: s.t, mins: s.mins, done: false }))); if (r.tip) e.tip = r.tip; save(); S.open = it.key; this.render();
    toast(`Planned: ${r.steps.length} steps, about ${sum(r.steps, s => s.mins)} minutes`);
  },

  /* ----- events ----- */
  async click(e) {
    const t = e.target, at = s => t.closest(s);
    let b;
    if ((b = at("[data-tab]"))) return this.setTab(b.dataset.tab);
    if ((b = at("#scTabs button"))) return this.setTab(b.dataset.v);
    if (at("[data-sc=refresh]")) return this.refresh();
    if ((b = at("[data-focusmode]"))) { this.setFocus(b.dataset.focusmode === "1"); toast(D.focus ? "Focus mode on: games and YouTube are locked until your homework is done" : "Focus mode off"); return; }
    if ((b = at("[data-autocards]"))) return this.autoCards(b.dataset.autocards);
    if ((b = at("[data-cardhintoff]"))) { D.cardHintOff = (D.cardHintOff || []).concat(b.dataset.cardhintoff).slice(-50); save(); return this.render(); }
    if (at("[data-sc=study]")) { Widgets.timer(25); toast("25-minute study timer started. You've got this"); return; }
    if ((b = at("[data-focus]"))) { Widgets.timer(+b.dataset.focus); toast(`${b.dataset.focus}-minute study timer started`); return; }
    // Classroom
    if ((b = at("[data-cr]"))) {
      const a = b.dataset.cr;
      if (a === "connect") { await sky.classroom.connect(); toast("Sign in with your school Google account in the window that opened"); }
      if (a === "sync") { b.disabled = true; Classroom.st = await sky.classroom.sync().catch(er => (toast(clean(er), true), Classroom.st)); linkCourses(); this.render(); }
      if (a === "open") sky.classroom.open("https://classroom.google.com/a/not-turned-in/all").catch(er => toast(clean(er), true));
      if (a === "off" && await dialog({ title: "Disconnect Google Classroom?", text: "Skyline forgets your Google sign-in and the assignments it read. Your Classroom itself isn't touched.", ok: "Disconnect", danger: true })) { Classroom.st = await sky.classroom.disconnect(); this.render(); }
      return;
    }
    // agenda items
    if ((b = at("[data-filter]"))) { S.filter = b.dataset.filter; return this.render(); }
    if ((b = at("[data-ck]"))) { const it = find(b.dataset.ck); if (it) { markDone(it, !it.done, e.clientX, e.clientY); this.render(); } return; }
    if ((b = at("[data-tog]"))) { S.open = S.open === b.dataset.tog ? null : b.dataset.tog; return this.render(); }
    const row = at("[data-key]"), it = row && find(row.dataset.key);
    if ((b = at("[data-act]")) && it) {
      const a = b.dataset.act;
      if (a === "open") return sky.classroom.open(it.url).catch(er => toast(clean(er), true));
      if (a === "focus") { Widgets.timer(25); toast(`25 minutes on “${it.title}”. You've got this`); return; }
      if (a === "del") { D.work = D.work.filter(w => w.id !== it.w.id); save(); return this.render(); }
      if (a === "plan") return this.planItem(it);
      if (a === "help") { S.help = { q: `I'm working on “${it.title}”${clsName(it.classId) ? ` for ${clsName(it.classId)}` : ""}. How should I get started?`, a: "", cls: it.classId || "" }; this.setTab("study"); setTimeout(() => { const q = $("#scHelp textarea"); if (q) { q.focus(); q.select(); } }, 60); return; }
      if (a === "cards") { S.cardTopic = it.title; S.cardCls = it.classId || ""; this.setTab("study"); setTimeout(() => { const n = $("#scAiCards [name=notes]"); if (n) { n.value = it.notes || ""; n.focus(); } }, 60); return; }
    }
    if ((b = at("[data-stepdel]")) && it) { const x = extra(it); x.steps.splice(+b.dataset.stepdel, 1); save(); return this.render(); }
    if (at("[data-sc=clear]")) { D.work = D.work.filter(w => !w.done); save(); return this.render(); }
    // classes, links
    if ((b = at("[data-ccol]"))) { const c = cls(b.dataset.ccol); c.color = COLORS[(COLORS.indexOf(c.color) + 1) % COLORS.length]; save(); return this.render(); }
    if ((b = at("[data-cren]"))) { const c = cls(b.dataset.cren), n = await dialog({ title: "Rename class", text: c.full ? `In Classroom: ${c.full}` : "", input: c.name, ok: "Save" }); if (n && n.trim()) { c.name = n.trim().slice(0, 30); save(); this.render(); } return; }
    if ((b = at("[data-cdel]"))) { D.classes = D.classes.filter(c => c.id !== b.dataset.cdel); save(); return this.render(); }
    if ((b = at("[data-sclink]"))) { const l = D.links[+b.dataset.sclink]; if (!l) return; if (Classroom.st.connected && /^https:\/\/([\w-]+\.)*google\.com(\/|$)/i.test(l.url)) sky.classroom.open(l.url).catch(() => sky.openUrl(l.url)); else sky.openUrl(l.url); return; }   // Google links: on the school account
    if ((b = at("[data-ldel]"))) { D.links.splice(+b.dataset.ldel, 1); D.linksSet = true; save(); return this.render(); }
    // calendar
    if ((b = at("[data-cal]"))) { S.calOff = b.dataset.cal === "0" ? 0 : S.calOff + +b.dataset.cal; if (b.dataset.cal === "0") S.calDay = null; return this.render(); }
    if ((b = at("[data-calday]"))) { S.calDay = +b.dataset.calday; return this.render(); }
    // schedule
    if ((b = at("[data-sday]"))) { S.schedDay = +b.dataset.sday; return this.renderTimeline(); }
    if (at("[data-padd]")) {
      const last = D.periods.slice().sort((a, b) => toMin(b.end) - toMin(a.end))[0], start = last ? toMin(last.end) + 5 : 8 * 60;
      D.periods.push({ id: uid("p"), classId: "", name: "", start: fromMin(start), end: fromMin(start + 50), room: "", days: last ? last.days.slice() : [1, 2, 3, 4, 5] }); save(); this.renderPeriods(); this.renderTimeline(); this.renderHero(); return;
    }
    const pr = at("[data-pid]"), p = pr && D.periods.find(x => x.id === pr.dataset.pid);
    if (p && (b = at("[data-pday]"))) { const d = +b.dataset.pday; p.days = p.days.includes(d) ? p.days.filter(x => x !== d) : p.days.concat(d); save(); b.classList.toggle("on", p.days.includes(d)); this.renderTimeline(); this.renderHero(); return; }
    if (p && at("[data-pdel]")) { D.periods = D.periods.filter(x => x !== p); save(); this.renderPeriods(); this.renderTimeline(); this.renderHero(); return; }
    // grades
    if ((b = at("[data-gcls]"))) { if (b.dataset.gcls) S.gradeCls = b.dataset.gcls; this.render(); if (b.classList.contains("sc-rgr")) $(".sc-cols")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (at("[data-allgrades]")) { S.allGrades = !S.allGrades; return this.render(); }
    if (at("[data-hist]")) { S.histAll = !S.histAll; return this.render(); }
    if ((b = at("[data-gdel]"))) { D.grades = D.grades.filter(g => g.id !== b.dataset.gdel); save(); return this.render(); }
    // study
    if ((b = at("[data-deck]"))) { S.deck = b.dataset.deck || null; return this.render(); }
    if (at("[data-dnew]")) { const n = await dialog({ title: "New flashcard deck", input: "", ok: "Create" }); if (n && n.trim()) { const d = { id: uid("d"), name: n.trim().slice(0, 50), classId: "", cards: [], at: Date.now() }; D.decks.push(d); S.deck = d.id; save(); this.render(); setTimeout(() => $("#scCardAdd [name=q]")?.focus(), 50); } return; }
    const deck = D.decks.find(d => d.id === S.deck);
    if (deck && at("[data-dren]")) { const n = await dialog({ title: "Rename deck", input: deck.name, ok: "Save" }); if (n && n.trim()) { deck.name = n.trim().slice(0, 50); save(); this.render(); } return; }
    if (deck && at("[data-ddel]")) { if (await dialog({ title: `Delete “${deck.name}”?`, text: `${deck.cards.length} cards will be gone.`, ok: "Delete", danger: true })) { D.decks = D.decks.filter(d => d !== deck); S.deck = null; save(); this.render(); } return; }
    if (deck && (b = at("[data-cdel2]"))) { deck.cards = deck.cards.filter(c => c.id !== b.dataset.cdel2); save(); return this.render(); }
    if ((b = at("[data-sess]")) && deck) return this.startSession(deck);
    if ((b = at("[data-quiz]"))) {
      const q = b.dataset.quiz, dk = deck || D.decks.find(d => d.id === (S.sess && S.sess.deck));
      if (q === "again" && S.quiz) { const z = S.quiz; return this.startQuiz(shuffle(z.qs), z.title, z.deck); }
      if (q === "deck" && dk) { const qs = offlineQuiz(dk); if (!qs) return toast("A quiz needs at least 4 cards with different answers", true); S.sess = null; return this.startQuiz(qs, dk.name, dk.id); }
      if (q === "ai" && dk) { const r = await this.ai("quiz", { cards: dk.cards.map(c => ({ q: c.q, a: c.a })), cls: clsName(dk.classId), count: Math.min(10, Math.max(5, dk.cards.length)) }, "quiz"); if (r) this.startQuiz(r.questions, dk.name + " · AI quiz", dk.id); return; }
    }
    // the session / quiz card
    if (at("[data-ovx]")) return this.closeOverlay();
    if (at("[data-flip]") && S.sess) { S.sess.flipped = !S.sess.flipped; return this.renderOverlay(); }
    if ((b = at("[data-gr]"))) return this.gradeCard(+b.dataset.gr);
    if ((b = at("[data-pick]"))) return this.pick(+b.dataset.pick);
    if (at("[data-next]")) return this.nextQ();
  },
  async submit(f) {
    const v = n => (f[n] ? f[n].value.trim() : "");
    if (f.id === "scQuick") {
      const text = v("text"); if (!text) return;
      const q = parseQuick(text, D.classes);
      D.work.push({ id: uid("w"), text: (q.title || text).slice(0, 140), classId: f.cls.value, due: parseDay(f.due.value) || q.due || addDays(today(), 1), kind: f.kind.value || q.kind, done: false });
      save(); FX.sound("success"); delete f.dataset.cls; delete f.dataset.kind; delete f.dataset.due; f.text.value = ""; this.render(); setTimeout(() => $("#scQuick [name=text]")?.focus(), 30); return;
    }
    if (f.id === "scCalAdd") { const text = v("text"); if (!text) return; const q = parseQuick(text, D.classes); D.work.push({ id: uid("w"), text: (q.title || text).slice(0, 140), classId: q.classId, due: +f.dataset.day, kind: q.kind, done: false }); save(); return this.render(); }
    if (f.dataset.stepadd) { const it = find(f.dataset.stepadd), t = v("t"); if (!it || !t) return; const x = extra(it); x.steps = (x.steps || []).concat({ t: t.slice(0, 140), done: false }); save(); this.render(); setTimeout(() => $(`[data-stepadd="${CSS.escape(it.key)}"] input`)?.focus(), 30); return; }
    if (f.id === "scClassAdd") { const n = v("name"); if (!n) return; D.classes.push({ id: uid("c"), name: n.slice(0, 30), color: COLORS[D.classes.length % COLORS.length] }); save(); return this.render(); }
    if (f.id === "scLinkAdd") { let u = v("url"); if (!u) return; if (!/^https?:\/\//i.test(u)) u = "https://" + u;
      try { const h = new URL(u).hostname.replace(/^www\./, ""); D.links.push({ name: v("name").slice(0, 24) || h, url: u }); D.linksSet = true; save(); this.render(); } catch (er) { toast("That isn't a web address", true); } return; }
    if (f.id === "scGradeAdd") { const score = parseFloat(f.score.value), outOf = parseFloat(f.outOf.value); if (!(score >= 0) || !(outOf > 0)) return toast("Enter the score and what it was out of", true);
      D.grades.push({ id: uid("g"), classId: S.gradeCls, name: v("name").slice(0, 60), score, outOf, cat: f.cat.value, at: Date.now() }); save(); FX.sound("success"); this.render(); setTimeout(() => $("#scGradeAdd [name=name]")?.focus(), 30); return; }
    if (f.id === "scNeed") return this.render();
    const deck = D.decks.find(d => d.id === S.deck);
    if (f.id === "scCardAdd" && deck) { const q = v("q"), a = v("a"); if (!q || !a) return toast("Fill in both sides", true); deck.cards.push(newCard({ q, a })); deck.at = Date.now(); save(); this.render(); setTimeout(() => $("#scCardAdd [name=q]")?.focus(), 30); return; }
    if (f.id === "scPaste" && deck) { const cards = parseCards(f.t.value); if (!cards.length) return toast("Put one card per line, like “term - definition”", true); deck.cards.push(...cards.map(newCard)); deck.at = Date.now(); save(); this.render(); toast(`Added ${cards.length} cards`); return; }
    if (f.id === "scAiCards") {
      const topic = v("topic"), notes = v("notes"); if (!topic && !notes) return toast("Type a topic or paste your notes", true);
      S.cardTopic = topic; S.cardCls = f.cls.value;
      const r = await this.ai("cards", { topic, notes, cls: clsName(f.cls.value), count: +f.count.value }, "cards"); if (!r) return;
      const d = { id: uid("d"), name: (r.title || topic || "AI deck").slice(0, 50), classId: S.cardCls, cards: r.cards.map(newCard), at: Date.now(), ai: true }; D.decks.push(d); S.deck = d.id; S.cardTopic = ""; save(); this.render();
      toast(`Made “${d.name}”: ${d.cards.length} cards`); return;
    }
    if (f.id === "scAiQuiz") { const topic = v("topic"); if (!topic) return toast("What's the quiz on?", true); const r = await this.ai("quiz", { topic, cls: clsName(f.cls.value), count: 8 }, "tquiz"); if (r) this.startQuiz(r.questions, topic); return; }
    if (f.id === "scHelp") { const q = v("q"); if (!q) return; S.help = { q, a: "", cls: f.cls.value }; const r = await this.ai("explain", { question: q, cls: clsName(f.cls.value) }, "help"); if (r) { S.help.a = r.answer; this.render(); } return; }
  },
  change(e) {
    const t = e.target, row = t.closest("[data-key]"), it = row && find(row.dataset.key);
    if (t.matches("[data-step]") && it) { const x = extra(it); x.steps[+t.dataset.step].done = t.checked; save(); if (t.checked && x.steps.every(s => s.done) && !it.done) { markDone(it, true, e.clientX, e.clientY); } return this.render(); }
    if (t.matches("[data-notes]") && it) { extra(it).notes = t.value.slice(0, 4000); save(); return; }
    if (it && it.src === "mine") { const w = D.work.find(w => w.id === it.w.id);
      if (t.matches("[data-wdue]")) { w.due = parseDay(t.value) || w.due; save(); return this.render(); }
      if (t.matches("[data-wcls]")) { w.classId = t.value; save(); return this.render(); }
      if (t.matches("[data-wkind]")) { w.kind = t.value; save(); return this.render(); } }
    if (t.closest("#scQuick")) { const f = t.closest("#scQuick"); if (t.name !== "text") f.dataset[t.name] = "1"; return; }
    if (t.matches("[data-remind]")) { if (t.dataset.remind === "on") D.remind.on = t.checked; else if (t.dataset.remind === "voice") D.remind.voice = t.checked; else { D.remind.at = t.value || "19:00"; if (toMin(D.remind.at) > new Date().getHours() * 60 + new Date().getMinutes()) D.reminded.evening = ""; } save(); return; }
    const pr = t.closest("[data-pid]"), p = pr && D.periods.find(x => x.id === pr.dataset.pid);
    if (p && t.dataset.pf) {
      if (t.dataset.pf === "classId" && t.value === "__name") { dialog({ title: "Name this period", input: p.name || "Lunch", ok: "Save" }).then(n => { if (n && n.trim()) { p.name = n.trim().slice(0, 24); p.classId = ""; } save(); this.renderPeriods(); this.renderTimeline(); this.renderHero(); }); return; }
      if ((t.dataset.pf === "start" || t.dataset.pf === "end") && !/^\d\d:\d\d$/.test(t.value)) return;
      p[t.dataset.pf] = t.value;
      if (t.dataset.pf === "start" && toMin(p.end) <= toMin(p.start)) { p.end = fromMin(toMin(p.start) + 50); const e2 = pr.querySelector('[data-pf="end"]'); if (e2) e2.value = p.end; }
      if (t.dataset.pf === "classId") pr.style.setProperty("--c", periodColor(p));
      save(); this.renderTimeline(); this.renderHero(); return;
    }
    if (t.closest("#scNeed")) return this.render();
    if (t.matches("[data-wt]")) { const c = cls(S.gradeCls); if (!c) return; c.weights = c.weights || {}; const n = parseFloat(t.value); if (n > 0) c.weights[t.dataset.wt] = n; else delete c.weights[t.dataset.wt]; if (!Object.keys(c.weights).length) delete c.weights; save(); return this.render(); }
    const deck = D.decks.find(d => d.id === S.deck);
    if (deck && t.matches("[data-dcls]")) { deck.classId = t.value; save(); return this.render(); }
  },
  input(e) {
    const t = e.target;
    if (t.closest("#scQuick") && t.name === "text") return this.guess();
    if (t.matches("[data-ced]")) {   // editing a card in place
      const deck = D.decks.find(d => d.id === S.deck), c = deck && deck.cards.find(c => c.id === t.closest("[data-cid]").dataset.cid);
      if (c) { c[t.dataset.ced] = t.textContent.trim().slice(0, t.dataset.ced === "q" ? 200 : 400); clearTimeout(this.cedT); this.cedT = setTimeout(save, 400); }
    }
  },
  // for the command bar: homework and flashcard decks, and showing one of them
  search() {
    if (!D) return [];
    return items().filter(i => !i.done).map(i => ({ i: (KINDS[i.kind] || KINDS.hw)[0], t: i.title, s: `${clsName(i.classId) || "School"} · due ${dueText(i)}`, key: i.key }))
      .concat(D.decks.map(d => ({ i: "cards", t: d.name, s: `Flashcards · ${d.cards.length} cards`, deck: d.id })));
  },
  reveal(x) { if (x.deck) { S.tab = "study"; S.deck = x.deck; } else { S.tab = "agenda"; S.filter = "all"; S.open = x.key; } store.local("sc-tab", S.tab); if (this.visible()) this.render(); },
  // homework focus mode: games and YouTube wait until what's due soon is done
  focusLeft() { if (!D || !D.focus) return null; const t0 = today(), left = items().filter(i => !i.done && (late(i) || dayStart(i.when) <= addDays(t0, 1))).map(i => i.title); if (!left.length) { D.focus = false; save(); return null; } return left; },
  setFocus(on) { D.focus = !!on; save(); if (this.visible()) this.render(); },
  focusBar() {
    const n = items().filter(i => !i.done && (late(i) || dayStart(i.when) <= addDays(today(), 1))).length;
    return D.focus ? `<div class="sc-focus on"><b>Focus mode is on</b><span>Games and YouTube are locked until the ${n} thing${n === 1 ? "" : "s"} due by tomorrow ${n === 1 ? "is" : "are"} done.</span><button class="btn xs ghost" data-focusmode="0">Turn off</button></div>`
      : n ? `<div class="sc-focus"><span>${n} thing${n === 1 ? "" : "s"} due by tomorrow. Lock games and YouTube until ${n === 1 ? "it's" : "they're"} done?</span><button class="btn xs primary" data-focusmode="1">Focus mode</button></div>` : "";
  },
  // tests coming up: offer flashcards made by Sky
  cardHints() {
    const t0 = today(), tests = items().filter(i => !i.done && i.kind === "test" && dayStart(i.when) >= t0 && dayStart(i.when) <= addDays(t0, 5) && !D.decks.some(d => d.from === i.key) && !(D.cardHintOff || []).includes(i.key));
    return tests.slice(0, 2).map(i => { const n = Math.round((dayStart(i.when) - t0) / day);
      return `<div class="sc-cardhint" data-key="${esc(i.key)}"><span><b>${esc(i.title)}</b> is ${n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days"}. Want Sky to make flashcards for it?</span><button class="btn xs primary" data-autocards="${esc(i.key)}" ${S.busy.cards ? "disabled" : ""}>${S.busy.cards ? "Making…" : "Make flashcards"}</button><button class="ibtn xs" data-cardhintoff="${esc(i.key)}" title="No thanks">${icon("x")}</button></div>`; }).join("");
  },
  async autoCards(key) {
    const it = find(key); if (!it) return;
    const r = await this.ai("cards", { topic: it.title, notes: it.notes, cls: clsName(it.classId) || (it.x && it.x.cls) || "", count: 15 }, "cards"); if (!r) return;
    const d = { id: uid("d"), name: (r.title || it.title).slice(0, 50), classId: it.classId || "", cards: r.cards.map(newCard), at: Date.now(), ai: true, from: key }; D.decks.push(d); save();
    toast(`${d.cards.length} flashcards ready for “${it.title}”. Find them on the Study tab`); this.render();
  },
  // for the assistant and the daily briefing
  brief() {
    if (!D) return null;
    const all = items().filter(i => !i.done), t0 = today();
    const name = i => i.title + (clsName(i.classId) ? ` (${clsName(i.classId)})` : "");
    const tests = all.filter(i => i.kind === "test" && dayStart(i.when) >= t0).sort((a, b) => a.when - b.when);
    return { overdue: all.filter(late).map(name), today: all.filter(i => !late(i) && dayStart(i.when) === t0).map(name), tomorrow: all.filter(i => dayStart(i.when) === addDays(t0, 1)).map(name),
      test: tests[0] ? { name: name(tests[0]), days: Math.round((dayStart(tests[0].when) - t0) / day) } : null, now: (() => { const nn = nowNext(); return nn.now ? periodName(nn.now) : ""; })(), streak: streak() };
  },
  addHomework,
};
