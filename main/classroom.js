// Google Classroom on the School page. You sign in to Google yourself in a Skyline window (its own private browser
// storage, kept on this PC); Skyline then reads your Classroom to-do list (assigned + missing work) in the background,
// the same page you'd see at classroom.google.com. No developer setup, no keys.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { BrowserWindow, ipcMain, session, shell } = require("electron");

const { chrome } = require("./links");
const PART = "persist:classroom";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const HOME = "https://classroom.google.com/u/0/h";
const PAGES = [["assigned", "https://classroom.google.com/u/0/a/not-turned-in/all"], ["missing", "https://classroom.google.com/u/0/a/missing/all"]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isClassroom = u => { try { return new URL(u).hostname === "classroom.google.com"; } catch (e) { return false; } };

// runs inside Classroom's page: class names from the home page, work items from the to-do pages
const READ_CLASSES = `(() => {
  const out = {};
  for (const a of document.querySelectorAll('a[href*="/c/"]')) {
    const m = a.href.match(/\\/c\\/([A-Za-z0-9_-]+)(?:[/?#]|$)/); if (!m || /\\/c\\/[^/]+\\/(a|sa|mc|qa|m|p)\\//.test(a.href)) continue;
    const name = (a.getAttribute("aria-label") || a.innerText || a.title || "").split("\\n").map(s => s.trim()).filter(Boolean)[0];
    if (name && !out[m[1]] && name.length < 120 && !/^(stream|classwork|people|grades|open|view|go to)/i.test(name)) out[m[1]] = name;
  }
  return out;
})()`;
const READ_EMAIL = `(() => {
  for (const e of document.querySelectorAll('a[href*="SignOutOptions"], a[aria-label*="Google Account"], [aria-label*="@"]')) {
    const m = (e.getAttribute("aria-label") || "").match(/[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+/); if (m) return m[0].toLowerCase();
  }
  return "";
})()`;
const READ_SPID = `(() => { const a = document.querySelector('a[href*="/sp/"]'); const m = a && a.getAttribute("href").match(/\\/sp\\/([A-Za-z0-9_-]+)/); return m ? m[1] : ""; })()`;
const READ_GRADES = `(() => {
  const rows = [];
  for (const b of document.querySelectorAll('[role="button"][aria-expanded][aria-label]')) {
    const row = b.parentElement; if (!row) continue;
    const texts = []; const tw = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode()) && texts.length < 16) { const t = n.nodeValue.trim(); if (t) texts.push(t); }
    if (texts.length) rows.push({ title: b.getAttribute("aria-label"), texts });
  }
  return rows;
})()`;
const GRADES_EVERY = 3 * 3600e3;   // grades are read every few hours, and whenever you press Refresh
const EXPAND = `(() => { let n = 0; for (const b of document.querySelectorAll('main [aria-expanded="false"], [role="main"] [aria-expanded="false"]')) { if (n++ < 12) b.click(); } return n; })()`;
const READ_WORK = `(() => {
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/c/"]')) {
    const m = a.href.match(/\\/c\\/([A-Za-z0-9_-]+)\\/(a|sa|mc|qa)\\/([A-Za-z0-9_-]+)/); if (!m || seen.has(m[3])) continue; seen.add(m[3]);
    const box = a.closest("li") || a.closest('[role="listitem"]') || a.parentElement || a;
    const lines = (box.innerText || "").split("\\n").map(s => s.trim()).filter(Boolean).slice(0, 8);
    const texts = []; const tw = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode()) && texts.length < 16) { const t = n.nodeValue.trim(); if (t && !(n.parentElement && n.parentElement.closest("script,style"))) texts.push(t); }
    const label = (a.getAttribute("aria-label") || "").trim();
    let sec = "", el = box;
    for (let i = 0; i < 8 && el && !sec; i++) { let p = el.previousElementSibling; while (p && !sec) { const h = p.matches("h2,h3,[role=heading]") ? p : p.querySelector("h2,h3,[role=heading]"); if (h) sec = h.innerText.trim(); p = p.previousElementSibling; } el = el.parentElement; }
    out.push({ course: m[1], kind: m[2], id: m[3], url: a.href.split("?")[0], lines, texts, label, sec: sec.slice(0, 40) });
  }
  return out;
})()`;

class Classroom {
  constructor(dataDir, getWin) {
    this.file = path.join(dataDir, "classroom.json"); this.getWin = getWin; this.busy = null; this.login = null;
    // older versions dropped the connection when the school sign-in ran out; now that's "sign in again", keeping the list
    const d = this.read(); if (!d.connected && /ran out/i.test(d.error || "") && (d.items || []).length) { d.connected = true; d.expired = true; d.error = "Your school sign-in ran out"; try { this.write(d); } catch (e) {} }
  }
  read() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { return { connected: false, items: [], courses: {}, at: 0 }; } }
  write(d) { const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d), "utf8"); fs.renameSync(tmp, this.file); return d; }
  ses() { const s = session.fromPartition(PART); s.setUserAgent(UA); return s; }
  win(show) {
    const w = new BrowserWindow({ show, width: 980, height: 760, title: "Sign in to Google Classroom", autoHideMenuBar: true, backgroundColor: "#ffffff",
      parent: show ? this.getWin() || undefined : undefined, webPreferences: { partition: PART, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    w.webContents.setUserAgent(UA);
    w.webContents.setAudioMuted(!show);
    w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
    return w;
  }

  // you sign in yourself, in Google's own page; the window closes once Classroom opens
  connect() {
    if (this.fake) return this.fakeConnect();
    if (this.login && !this.login.isDestroyed()) { this.login.focus(); return true; }
    this.ses();
    const w = this.win(true); this.login = w;
    let done = false;
    const check = async u => {
      if (done || !isClassroom(u)) return;
      done = true; await sleep(1200); if (!w.isDestroyed()) w.close();
      const d = this.read(); d.connected = true; d.expired = false; d.error = ""; this.write(d);
      this.sync().catch(() => {}).finally(() => this.tell());
      this.tell();
    };
    w.webContents.on("did-navigate", (e, u) => check(u));
    w.webContents.on("did-navigate-in-page", (e, u) => check(u));
    w.on("closed", () => { if (this.login === w) this.login = null; this.tell(); });
    w.loadURL("https://accounts.google.com/ServiceLogin?" + new URLSearchParams({ service: "classroom", continue: HOME, followup: HOME }));
    return true;
  }
  async disconnect() {
    await this.ses().clearStorageData();
    this.write({ connected: false, items: [], courses: {}, at: 0 });
    this.tell(); return this.status();
  }
  // open a Classroom / Google link on the school account, not whichever Google account the browser shows first:
  // in the Chrome profile signed in to that account, with ?authuser= so Google picks it even in a shared profile
  openAsSchool(url) {
    let u; try { u = new URL(String(url)); } catch (e) { throw new Error("That isn't a web address"); }
    if (u.protocol !== "https:" || !/(^|\.)google\.com$/.test(u.hostname)) throw new Error("Not a Google link");
    const d = this.read(), email = d.email || "";
    if (u.hostname === "classroom.google.com") u.pathname = u.pathname.replace(/^\/u\/\d+(?=\/|$)/, "") || "/";
    if (email) u.searchParams.set("authuser", email);
    const c = chrome();
    if (c) {
      const prof = (email && c.profiles.find(p => p.account.toLowerCase() === email)) || c.profiles.find(p => p.hosted && /school|edu|k12|academy/i.test(p.hosted)) || c.profiles.find(p => p.hosted);
      if (prof) { const p = spawn(c.exe, [`--profile-directory=${prof.dir}`, u.href], { detached: true, stdio: "ignore" }); p.on("error", () => shell.openExternal(u.href)); p.unref(); return { how: "chrome", profile: prof.name }; }
    }
    return shell.openExternal(u.href).then(() => ({ how: "browser" }));
  }
  status() { const d = this.read(); return { connected: !!d.connected, expired: !!d.expired, at: d.at || 0, items: d.items || [], courses: d.courses || {}, fresh: d.fresh || [], grades: d.grades || [], gradesAt: d.gradesAt || 0, freshGrades: d.freshGrades || [], error: d.error || "", syncing: !!this.busy, phase: this.phase || "", signingIn: !!this.login }; }
  tell() { const w = this.getWin(); if (w && !w.isDestroyed()) w.webContents.send("cr:status", this.status()); }

  // read Classroom in a hidden window
  sync(opts = {}) {
    if (this.busy) { if (opts.grades) this.wantGrades = true; return this.busy; }
    this.busy = this._sync(opts).finally(() => { this.busy = null; this.phase = ""; this.tell(); });
    this.tell();
    return this.busy;
  }
  async _sync(opts = {}) {
    const d = this.read(); if (!d.connected) return this.status();
    const w = this.win(false);
    const load = async url => {
      await w.loadURL(url).catch(() => {});
      if (!isClassroom(w.webContents.getURL())) { const e = new Error("signedout"); e.signedOut = true; throw e; }
    };
    const until = async (js, ok, ms) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await w.webContents.executeJavaScript(js, true).catch(() => null); if (ok(v)) return v; await sleep(700); } return v; };
    try {
      await load(HOME);
      const courses = await until(READ_CLASSES, v => v && Object.keys(v).length, 12000) || {};
      const email = await until(READ_EMAIL, v => !!v, 8000) || d.email || "";   // the account button draws a moment after the classes
      const items = [];
      for (const [kind, url] of PAGES) {
        await load(url);
        await until(READ_WORK, v => v && v.length, 9000);   // the list draws itself after the page loads
        await w.webContents.executeJavaScript(EXPAND, true).catch(() => 0); await sleep(1500);
        await w.webContents.executeJavaScript(EXPAND, true).catch(() => 0); await sleep(900);
        const found = await w.webContents.executeJavaScript(READ_WORK, true).catch(() => []) || [];
        for (const f of found) if (!items.some(x => x.id === f.id)) items.push(tidy(f, courses, kind));
      }
      // new since last time (not on the very first read, when everything would be "new")
      const before = new Set((d.items || []).map(x => x.id)), fresh = d.at ? items.filter(x => !before.has(x.id)).map(x => x.id) : [];
      let out = this.write({ ...d, connected: true, expired: false, items, courses: Object.keys(courses).length ? courses : d.courses || {}, fresh, freshGrades: [], email, at: Date.now(), error: "" });
      this.tell();   // the to-do list is ready; grades come next
      if (opts.grades || this.wantGrades || !d.gradesAt || Date.now() - d.gradesAt > GRADES_EVERY) {
        this.wantGrades = false;
        try { out = await this.readGrades(w, load, out); }
        catch (e) { if (e.signedOut) { out.expired = true; out.error = "Your school sign-in ran out"; this.write(out); } }
      }
      return out;
    } catch (e) {
      // school accounts have to sign in again every so often: keep the last list and ask for a sign-in
      if (e.signedOut) { d.expired = true; d.error = "Your school sign-in ran out"; }
      else d.error = "Couldn't read Classroom: " + String(e.message || e).slice(0, 120);
      this.write(d); return this.status();
    } finally { if (!w.isDestroyed()) w.destroy(); }
  }
  // every class's "View your work" page: the grade on each assignment
  async readGrades(w, load, d) {
    const ids = Object.keys(d.courses || {}); if (!ids.length) return d;
    const poll = async (js, ok, ms) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await w.webContents.executeJavaScript(js, true).catch(() => null); if (ok(v, Date.now() - t0)) return v; await sleep(500); } return v; };
    let sp = d.spId;
    if (!sp) {   // the page is /c/<class>/sp/<you>/all: find <you> once, on a class's Classwork page
      for (const id of ids.slice(0, 4)) { this.phase = "Finding your grades…"; this.tell(); await load(`https://classroom.google.com/u/0/w/${id}/t/all`); sp = await poll(READ_SPID, v => !!v, 8000); if (sp) break; }
      if (!sp) return d;
    }
    const prev = new Map((d.grades || []).map(g => [g.id, g])), grades = [], now = Date.now();
    let n = 0;
    for (const id of ids) {
      this.phase = `Reading your grades (${++n} of ${ids.length})…`; this.tell();
      await load(`https://classroom.google.com/u/0/c/${id}/sp/${sp}/all/default`);
      // wait for the rows and their grades ("Loading submission details" at first); a class with no work has no rows
      const rows = await poll(READ_GRADES, (v, ms) => (v && v.length && !v.some(r => r.texts.some(t => /loading submission/i.test(t)))) || (!(v && v.length) && ms > 6000), 12000) || [];
      for (const r of rows) {
        const g = gradeOf(r, id, d.courses[id]); if (!g) continue;
        const p = prev.get(g.id); g.seen = p && p.score === g.score && p.outOf === g.outOf ? p.seen || 0 : d.gradesAt ? now : 0;
        if (!grades.some(x => x.id === g.id)) grades.push(g);
      }
    }
    // new or changed since last time (not on the very first read)
    const freshGrades = d.gradesAt ? grades.filter(g => { const p = prev.get(g.id); return !p || p.score !== g.score || p.outOf !== g.outOf; }).map(g => g.id) : [];
    return this.write({ ...d, grades, gradesAt: now, spId: sp, freshGrades });
  }
  // tests only (--shot with SKY_CR_FAKE=1): "signing in" takes a few seconds, then two made-up assignments; never opens Google
  fakeConnect() {
    if (this.login) return true;
    this.login = { fake: true }; this.tell();
    setTimeout(() => {
      this.login = null;
      const due = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      this.write({ connected: true, expired: false, error: "", at: Date.now(), courses: { c1: "8th Grade Science" }, fresh: [], grades: [], freshGrades: [],
        items: [{ id: "f1", course: "c1", title: "Lab report: density", cls: "8th Grade Science", due, noDue: false, missing: false, url: "https://classroom.google.com/c/c1/a/f1", kind: "a", points: 20 }] });
      this.tell();
    }, 4000);
    return true;
  }
  install(testing) {
    this.fake = !!testing && process.env.SKY_CR_FAKE === "1";
    const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
    if (testing) h("cr:test", (pieces, label, courses) => tidy({ course: "c1", kind: "a", id: "t1", url: "https://classroom.google.com/u/0/c/c1/a/t1/details", lines: [], texts: pieces, label: label || "" }, courses || {}, "assigned"));
    h("cr:status", () => this.status());
    h("cr:connect", () => this.connect());
    h("cr:sync", async force => { await this.sync({ grades: !!force }); return this.status(); });
    h("cr:disconnect", () => this.disconnect());
    h("cr:open", url => this.openAsSchool(url));
    if (!testing) setInterval(() => { const d = this.read(); if (d.connected && !d.expired && Date.now() - (d.at || 0) > 4.5 * 60e3) this.sync().catch(() => {}); }, 5 * 60e3);
  }
}

// one to-do item, in words: title, class, due. Classroom draws each in its own span; icon names ("assignment") are text too.
const DATE = /\b(today|tomorrow|yesterday|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;
const DATE_BITS = /due|today|tomorrow|yesterday|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}:\d{2}\s*[ap]\.?m\.?|[\s,.\d]/gi;
const ICON = /^[a-z]+(?:_[a-z]+)*$/;  // material icon ligatures: assignment, assignment_late, help_outline, more_vert…
const STATUS = /^(assignment|question|material|quiz assignment|posted|edited|turned in|handed in|assigned|missing|done|graded|returned|late|\d+ points?|no points|this week|next week|later|earlier|no due date)$/i;
// "Friday, Oct 16FridayOct 16" -> "Friday, Oct 16"; "Due Tomorrow, 11:59 PM" -> "Tomorrow, 11:59 PM"
function cleanDue(t) {
  t = String(t || "").replace(/^due\s*/i, "").trim();
  const rel = t.match(/\b(today|tomorrow|yesterday)\b/i), wd = t.match(/\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b/i),
    md = t.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?/i), tm = t.match(/\b\d{1,2}:\d{2}\s*[ap]\.?m\.?/i);
  const d = rel ? rel[0] : wd && md ? wd[0] + ", " + md[0] : md ? md[0] : wd ? wd[0] : "";
  return d ? d + (tm ? ", " + tm[0].toUpperCase() : "") : t.slice(0, 40);
}
function gradeOf(r, course, cls) {
  const all = (r.texts || []).join(" | ");
  const m = all.match(/(\d+(?:\.\d+)?)\s*points?\s+out\s+of\s+(?:a\s+)?possible\s+(\d+(?:\.\d+)?)/i); if (!m) return null;
  const score = +m[1], outOf = +m[2]; if (!(outOf > 0) || !isFinite(score)) return null;
  const title = String(r.title || r.texts[0] || "").replace(/\s+/g, " ").trim().slice(0, 160); if (!title) return null;
  const due = (r.texts || []).find(t => /^due\b/i.test(t));
  return { id: course + ":" + title, course, cls: cls || "", title, score, outOf, due: due ? cleanDue(due) : "", late: /done late/i.test(all) };
}
function tidy(f, courses, kind) {
  const cls = courses[f.course] || "";
  let pieces = (f.texts && f.texts.length ? f.texts : f.lines).map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  // drop the date after "Posted" / "Edited" (Classroom shows that for work with no due date), and "Posted Sep 22" in one piece
  pieces = pieces.filter((t, i) => !/^(posted|edited|assigned|turned in|handed in|returned)\b/i.test(t) && !(i > 0 && /^(posted|edited|assigned|turned in|handed in|returned)$/i.test(pieces[i - 1])));
  // an older page ran everything together ("assignmentQ1 Form8th Grade ReligionFriday, Oct 16"): cut it at the class name and the date
  if (pieces.length === 1 && cls && pieces[0].includes(cls)) pieces = pieces[0].replace(/^(assignment|question|quiz)(?=[A-Z0-9])/, "").split(cls).flatMap((x, i) => i ? [cls, x] : [x]).map(x => x.trim()).filter(Boolean);
  // a due date is a piece that's all date: "Friday, Oct 16", "Tomorrow, 11:59 PM" (not "Read chapter 4 by Tuesday")
  const isDue = t => /^due\b/i.test(t) || /^no due date$/i.test(t) || (DATE.test(t) && t.replace(DATE_BITS, "").length <= 3);
  let due = pieces.find(t => /^due\b/i.test(t)) || pieces.find(isDue) || "";
  if (!due) { const lm = (f.label || "").match(/\bdue[: ]+([^.;]*)/i); const rest = pieces.filter(t => !/^(posted|edited|assigned|turned in|handed in)\b/i.test(t)).join(" "); due = lm ? lm[1] : DATE.test(rest) ? rest : ""; }
  const noDue = /no due date/i.test(due) || /no due date/i.test(f.label || "") || /no due date/i.test(f.sec || "") || (!due && !/missing/i.test(kind));
  const points = (pieces.find(t => /^\d+ points?$/i.test(t)) || "").replace(/\D+/g, "");
  const skip = t => t === cls || ICON.test(t) || STATUS.test(t) || isDue(t) || /^(due|posted|edited)\b/i.test(t);
  let title = pieces.find(t => !skip(t)) || (f.label.split(/,| due /i)[0] || "").trim() || "Untitled";
  if (cls && title.endsWith(cls)) title = title.slice(0, -cls.length).trim();
  title = title.replace(/^(assignment|question|quiz)(?=[A-Z0-9])/, "");
  return { id: f.id, course: f.course, title: title.slice(0, 160), cls: cls || (pieces.find(t => t !== title && !skip(t)) || ""), due: noDue ? "" : cleanDue(due), noDue, missing: kind === "missing", url: f.url, kind: f.kind, points: points ? +points : 0 };
}

module.exports = { Classroom, tidy, gradeOf };
