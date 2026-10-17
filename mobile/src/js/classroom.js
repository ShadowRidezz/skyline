// Google Classroom straight from the phone, without the PC: Google's own sign-in (Google Identity Services) gives
// this page a short-lived, read-only pass, and the page reads your classes, homework and grades from the Classroom
// API. Needs a Google Client ID, which Skyline's admin saves once (Admin › Phone Classroom sign-in).
// School accounts can block apps the school hasn't approved; then this says so and points to "Connect on your PC".
import { api } from "./social/api.js";

const SCOPES = ["https://www.googleapis.com/auth/classroom.courses.readonly", "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly"].join(" ");
const API = "https://classroom.googleapis.com/v1/";
const COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#f97316", "#a3e635", "#e879f9"];
const KEY = "sky-crd";
export const BLOCKED = "Your school doesn't let Skyline read Classroom on this phone (school accounts can block apps the school hasn't approved). Use Connect on your PC instead: it signs in on Google's own page there.";

const store = { get() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }, set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} } };
const fail = (msg, blocked) => Object.assign(new Error(msg), { blocked: !!blocked });

let gis = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return gis || (gis = new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => ok(); s.onerror = () => { gis = null; no(fail("Couldn't reach Google. Check your internet and try again.")); };
    document.head.appendChild(s);
  }));
}
// what Google's sign-in said, in words
export function explain(code) {
  code = String(code || "");
  if (/admin_policy_enforced|org_internal|disallowed|unauthorized_client|restricted/i.test(code)) return fail(BLOCKED, true);
  if (/access_denied/i.test(code)) return fail("Google said no. If you pressed Cancel, try again. If it said \"Access blocked\", your school doesn't allow this: use Connect on your PC.", true);
  if (/popup_closed/i.test(code)) return fail("The Google window closed before you finished. If it said \"Access blocked\", your school doesn't allow this: use Connect on your PC.");
  if (/popup_failed/i.test(code)) return fail("Your browser blocked Google's sign-in window. Allow pop-ups for this site and try again.");
  if (/invalid_client|origin/i.test(code)) return fail("The Google Client ID isn't set up for this site yet. Ask Skyline's admin to check it.");
  return fail("Google sign-in didn't finish (" + code.slice(0, 60) + ").");
}

export const Direct = {
  token: null, until: 0, client: null,
  async clientId(force) {
    if (this.client != null && !force) return this.client;
    try { this.client = ((await api.rpc("get_app_settings")) || {}).classroom_client || ""; } catch (e) { this.client = this.client || ""; }
    return this.client;
  },
  saved(who) { const d = store.get(); return d && d.who === who ? d : null; },
  forget() { store.set(null); try { if (this.token && window.google) google.accounts.oauth2.revoke(this.token, () => {}); } catch (e) {} this.token = null; this.until = 0; },
  // Google's sign-in window (needs a tap: browsers only allow pop-ups from one)
  async signIn(hint) {
    const id = await this.clientId(); if (!id) throw fail("Phone sign-in isn't set up yet. Use Connect on your PC.");
    await loadGis();
    return new Promise((ok, no) => {
      const tc = google.accounts.oauth2.initTokenClient({ client_id: id, scope: SCOPES, prompt: this.token ? "" : "select_account", hint: hint || undefined,
        callback: r => {
          if (!r || r.error) return no(explain(r && (r.error + " " + (r.error_description || ""))));
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES.split(" "))) return no(fail("Skyline needs all three Classroom boxes ticked to read your homework and grades. Try again and tick them."));
          this.token = r.access_token; this.until = Date.now() + (r.expires_in || 3600) * 1000 - 60e3; ok();
        },
        error_callback: e => no(explain(e && e.type)) });
      tc.requestAccessToken();
    });
  },
  async get(path) {
    const r = await fetch(API + path, { headers: { Authorization: "Bearer " + this.token } }).catch(() => null);
    if (!r) throw fail("Couldn't reach Google Classroom. Check your internet.");
    if (r.status === 401) { this.token = null; throw fail("Your Google sign-in ran out. Tap Refresh to sign in again."); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) { const m = (j.error && j.error.message) || ""; throw /scope|insufficient/i.test(m) ? fail("Skyline needs all three Classroom boxes ticked. Disconnect and connect again.") : fail(BLOCKED, true); }
    if (!r.ok) throw fail("Classroom said: " + String((j.error && j.error.message) || r.status).slice(0, 120));
    return j;
  },
  async all(path, key) { let out = [], tok = ""; for (let i = 0; i < 6; i++) { const j = await this.get(path + (tok ? "&pageToken=" + encodeURIComponent(tok) : "")); out = out.concat(j[key] || []); if (!(tok = j.nextPageToken)) break; } return out; },
  // read Classroom and build the same summary the PC sends (classes and averages, what's due, recent grades)
  async read(who) {
    if (!this.token || Date.now() > this.until) await this.signIn();
    const courses = (await this.all("courses?studentId=me&courseStates=ACTIVE&pageSize=50", "courses")).slice(0, 25);
    const now = Date.now(), soon = now + 21 * 864e5, due = [], grades = [], classes = [];
    await Promise.all(courses.map(async (c, i) => {
      const color = COLORS[i % COLORS.length], name = c.name || "Class";
      const [work, subs] = await Promise.all([this.all(`courses/${c.id}/courseWork?pageSize=100`, "courseWork").catch(e => { if (e.blocked) throw e; return []; }),
        this.all(`courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=200`, "studentSubmissions").catch(e => { if (e.blocked) throw e; return []; })]);
      const sub = new Map(subs.map(s => [s.courseWorkId, s]));
      let got = 0, max = 0, n = 0;
      for (const w of work) {
        const s = sub.get(w.id) || {}, done = s.state === "TURNED_IN" || s.state === "RETURNED";
        if (w.dueDate && !done) {
          const t = Date.UTC(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day, w.dueTime ? w.dueTime.hours || 0 : 23, w.dueTime ? w.dueTime.minutes || 0 : 59);
          if (t < soon) due.push({ title: String(w.title || "Untitled").slice(0, 120), cls: name, color, when: t, timed: !!w.dueTime, kind: /quiz|test/i.test(w.title || "") ? "test" : "hw", late: t < now });
        }
        if (s.assignedGrade != null && w.maxPoints > 0) {
          got += s.assignedGrade; max += w.maxPoints; n++;
          grades.push({ name: String(w.title || "Grade").slice(0, 100), cls: name, color, score: s.assignedGrade, outOf: w.maxPoints, pct: Math.round(s.assignedGrade / w.maxPoints * 1000) / 10,
            at: Date.parse(s.updateTime || w.updateTime || "") || null, late: !!s.late });
        }
      }
      const avg = max ? Math.round(got / max * 1000) / 10 : null;
      classes[i] = { name, color, avg, letter: avg == null ? "" : letter(avg)[0], n };
    }));
    const graded = classes.filter(c => c && c.avg != null);
    const snap = { at: now, classes: classes.filter(Boolean), due: due.sort((a, b) => a.when - b.when).slice(0, 60), grades: grades.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 40),
      overall: graded.length ? Math.round(graded.reduce((a, c) => a + c.avg, 0) / graded.length * 10) / 10 : null,
      gpa: graded.length ? Math.round(graded.reduce((a, c) => a + letter(c.avg)[1], 0) / graded.length * 100) / 100 : null };
    store.set({ who, at: now, snap });
    return snap;
  },
};
function letter(p) { return p >= 93 ? ["A", 4] : p >= 90 ? ["A-", 3.7] : p >= 87 ? ["B+", 3.3] : p >= 83 ? ["B", 3] : p >= 80 ? ["B-", 2.7] : p >= 77 ? ["C+", 2.3] : p >= 73 ? ["C", 2] : p >= 70 ? ["C-", 1.7] : p >= 60 ? ["D", 1] : ["F", 0]; }
