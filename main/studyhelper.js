// The Study Helper: Skyline's side of the Chrome extension (helper-extension/). The extension reads the question on
// IXL / Sadlier and shows the side panel; Skyline does the AI work here, on this PC, so no key ever goes into the browser.
// It's a tutor: a hint and the method first, then "Check" on your own answer, and the full solution only after you've
// tried. Only this PC can reach it (127.0.0.1), and only with the pairing code shown in Skyline.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ipcMain, shell, app } = require("electron");
const { parse } = require("./study");

const PORTS = [47811, 47812, 47813, 47814, 47815];
const SYSTEM = `You are Sky, a patient tutor inside a student's study helper (middle and high school: math, vocabulary, grammar, reading, science, social studies).
Your job is to help the student understand and learn to do it themselves. Be accurate: work the problem out carefully and check your work before you answer.
Use simple words and short steps. Write math in plain text (x^2, sqrt(5), 3/4, -7). Answer with ONE JSON object only, no prose before or after, no code fences.`;
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const qText = q => `Question${q.subject ? ` (${clip(q.subject, 40)})` : ""}:\n"""\n${clip(q.question, 3000)}\n"""${q.choices && q.choices.length ? `\nAnswer choices: ${q.choices.map((c, i) => `(${String.fromCharCode(65 + i)}) ${clip(c, 200)}`).join("  ")}` : ""}`;

const TASKS = {
  // a screenshot -> the question in it
  read: () => `Read the homework question in this screenshot of a learning website. Copy it exactly (numbers, signs, fractions, units), with any answer choices.
Ignore menus, scores, timers, ads and anything that isn't the question. If there's no question you can read, say so.
JSON: {"found": true, "question": "the full question text", "choices": ["choice text", ...], "subject": "math|vocabulary|grammar|reading|science|social studies|other"}`,
  // the first help: the skill, a hint, the method on a DIFFERENT example. Never the answer to this question.
  hint: q => `${qText(q)}

Help the student get started WITHOUT giving the answer to this question (and without hinting which choice is right).
1. Name the skill being practised.
2. One short hint that points them in the right direction.
3. The method as 2-5 general steps.
4. Work a similar example with DIFFERENT numbers/words, step by step, including its answer.
If the question is unclear or missing information (e.g. it refers to a picture you can't see), set "ambiguous": true and say what's missing in "note".
JSON: {"skill": "short skill name", "subject": "math|...", "hint": "one or two sentences", "method": ["step", ...], "example": {"problem": "...", "steps": ["...", ...], "answer": "..."}, "ambiguous": false, "note": ""}`,
  // the student's answer -> right or wrong, and why (without giving away the right answer when it's wrong)
  check: q => `${qText(q)}

The student answered: "${clip(q.answer, 500)}"
${q.expected ? `The answer key says: "${clip(q.expected, 300)}"\n` : ""}First solve the question yourself, step by step. Then verify your result a second, different way (substitute it back, estimate, or re-derive). If the two disagree, solve it again carefully until they agree. Only then compare with the student's answer. Then decide if the student's answer is correct (accept equivalent forms: 0.5 = 1/2, x=3 = 3, different capitalisation, a matching choice letter).
If it's wrong, explain the likely mistake and give a nudge, but do NOT reveal the correct answer.
If you can't be sure (missing picture, unclear question), use "unsure".
JSON: {"correct": true|false|"unsure", "feedback": "one or two encouraging sentences", "mistake": "what went wrong, or empty"}`,
  // after an attempt: the full worked solution
  solve: q => `${qText(q)}

The student already tried and answered "${clip(q.attempt, 300)}". Now show the full solution: every step, then the final answer. Before you write it, verify the answer a second, different way (substitute it back, estimate, or re-derive); if the checks disagree, re-solve until they agree. Never guess: if the question is missing information, say so in "note".
If the question is ambiguous or missing information, say so in "note".
JSON: {"steps": ["step 1 ...", "step 2 ...", ...], "answer": "the final answer (and the choice letter if there are choices)", "note": ""}`,
  // new practice questions on a skill
  practice: q => `Write ${Math.max(1, Math.min(8, q.count | 0 || 5))} new practice questions on the skill "${clip(q.skill, 120)}"${q.subject ? ` (${clip(q.subject, 40)})` : ""}, difficulty ${q.difficulty === 3 ? "hard" : q.difficulty === 1 ? "easy" : "medium"}.
${q.sample ? `They should be like this one (but different numbers/words): "${clip(q.sample, 600)}"\n` : ""}Mix in multiple choice (4 choices) and short-answer questions. Every answer must be correct: solve each one and check it.
JSON: {"questions": [{"q": "question", "choices": ["A", "B", "C", "D"] or [], "answer": "exact answer (for multiple choice, the text of the right choice)", "steps": ["how to solve it", ...]}]}`,
  // a follow-up question in the chat
  ask: q => `${qText(q)}

${q.attempted ? "The student has already attempted this question." : "The student hasn't answered this question yet, so don't give its final answer: teach the idea instead."}
The student asks: "${clip(q.ask, 1000)}"
JSON: {"reply": "a short, clear answer (plain text, line breaks allowed)"}`,
};

// keep only what the panel can use, so a strange answer from the AI can't break it
function tidy(task, j) {
  const s = (v, n) => clip(v, n), arr = (v, n, m) => (Array.isArray(v) ? v : []).map(x => s(x, m)).filter(Boolean).slice(0, n);
  if (task === "read") return { found: j.found !== false && !!s(j.question, 10), question: String(j.question || "").trim().slice(0, 3000), choices: arr(j.choices, 8, 300), subject: s(j.subject, 30) };
  if (task === "hint") return { skill: s(j.skill, 80) || "This skill", subject: s(j.subject, 30), hint: s(j.hint, 600), method: arr(j.method, 6, 300), example: j.example && typeof j.example === "object" ? { problem: s(j.example.problem, 400), steps: arr(j.example.steps, 8, 300), answer: s(j.example.answer, 200) } : null, ambiguous: !!j.ambiguous, note: s(j.note, 300) };
  if (task === "check") return { correct: j.correct === true ? true : j.correct === false ? false : "unsure", feedback: s(j.feedback, 500), mistake: s(j.mistake, 500) };
  if (task === "solve") { const steps = arr(j.steps, 12, 400); if (!steps.length) throw new Error("The AI didn't send a solution. Try again."); return { steps, answer: s(j.answer, 300), note: s(j.note, 300) }; }
  if (task === "practice") { const qs = (Array.isArray(j.questions) ? j.questions : []).map(x => ({ q: s(x.q, 600), choices: arr(x.choices, 6, 200), answer: s(x.answer, 200), steps: arr(x.steps, 8, 300) })).filter(x => x.q && x.answer); if (!qs.length) throw new Error("The AI didn't make any questions. Try again."); return { questions: qs }; }
  if (task === "ask") return { reply: String(j.reply || "").trim().slice(0, 2500) };
  return j;
}

class StudyHelper {
  constructor(dataDir, study) {
    this.file = path.join(dataDir, "studyhelper.json"); this.study = study; this.port = 0; this.seen = 0; this.busy = Promise.resolve(); this.recent = [];
    this.data = this.read(); if (!this.data.token) { this.data.token = this.code(); this.save(); }
  }
  read() { try { return { skills: {}, log: [], ...JSON.parse(fs.readFileSync(this.file, "utf8")) }; } catch (e) { return { skills: {}, log: [] }; } }
  save() { const tmp = this.file + ".tmp"; try { fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); } catch (e) {} }
  code() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.randomBytes(6), b => a[b % a.length]).join(""); }
  folder() { return app.isPackaged ? path.join(process.resourcesPath, "helper-extension") : path.join(__dirname, "..", "helper-extension"); }

  // one AI job at a time, and at most 40 a minute (so a stuck page can't run up a usage limit)
  async run(task, input, images) {
    const now = Date.now(); this.recent = this.recent.filter(t => now - t < 60e3);
    if (this.recent.length >= 40) { const e = new Error("Slow down a little: too many requests this minute"); e.status = 429; throw e; }
    this.recent.push(now);
    if (task === "solve" && !clip(input.attempt, 300)) { const e = new Error("Try the question first: enter your answer and press Check, then the full solution unlocks"); e.status = 400; throw e; }
    const job = this.busy.then(async () => {
      let lastErr;
      for (let i = 0; i < 2; i++) {   // one retry when the answer isn't usable JSON
        // reading, checking and solving: Claude's strongest model, thinking hard; hints and practice: still careful, a bit quicker
        const opts = /^(check|solve|read)$/.test(task) ? { model: "claude-opus-5-5", effort: "high" } : { model: "claude-opus-5-5", effort: "medium" };
        try { return tidy(task, parse(await this.study.raw(TASKS[task](input), images, SYSTEM, opts))); }
        catch (e) { lastErr = e; if (e.code === "nobrain" || /limit|sign/i.test(e.message)) break; }
      }
      throw lastErr;
    });
    this.busy = job.catch(() => {});
    return job;
  }
  progress() {
    const list = Object.entries(this.data.skills).map(([name, s]) => ({ name, tries: s.tries, right: s.right, pct: s.tries ? Math.round(s.right / s.tries * 100) : 0, last: s.last }));
    return { skills: list.sort((a, b) => b.last - a.last), weak: list.filter(s => s.tries >= 2 && s.pct < 70).sort((a, b) => a.pct - b.pct), total: list.reduce((a, s) => a + s.tries, 0) };
  }
  record(skill, correct, source) {
    const k = clip(skill, 80) || "General"; const s = this.data.skills[k] = this.data.skills[k] || { tries: 0, right: 0, last: 0 };
    s.tries++; if (correct === true) s.right++; s.last = Date.now();
    this.data.log.push({ skill: k, correct: correct === true, at: Date.now(), source: source === "practice" ? "practice" : "site" }); this.data.log = this.data.log.slice(-2000);
    this.save(); return this.progress();
  }
  async handle(req, res) {
    const origin = req.headers.origin || "";
    const cors = /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, X-Sky-Code", "Access-Control-Allow-Methods": "GET, POST" } : {};
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(obj)); };
    if (req.method === "OPTIONS") return send(204, {});
    if (origin && !cors["Access-Control-Allow-Origin"]) return send(403, { error: "Only the Sky Study Helper extension can use this" });   // web pages can't
    if (req.headers["x-sky-code"] !== this.data.token) return send(401, { error: "Pair the extension: enter the code shown in Skyline (Sky page › Study Helper)" });
    this.seen = Date.now();
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/status") { const via = await this.study.which().catch(() => ""); return send(200, { ok: true, ai: via, version: app.getVersion(), progress: this.progress() }); }
    if (req.method === "GET" && url.pathname === "/api/progress") return send(200, this.progress());
    if (req.method !== "POST") return send(404, { error: "Not found" });
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 9e6) return send(413, { error: "That screenshot is too big" }); }
    let input; try { input = JSON.parse(body || "{}"); } catch (e) { return send(400, { error: "Bad request" }); }
    if (url.pathname === "/api/progress") return send(200, this.record(input.skill, input.correct, input.source));
    const task = url.pathname.replace(/^\/api\//, "");
    if (!TASKS[task]) return send(404, { error: "Not found" });
    const images = task === "read" ? (Array.isArray(input.images) ? input.images : [input.image]).filter(Boolean).slice(0, 2) : [];
    if (task === "read" && !images.length) return send(400, { error: "No screenshot" });
    if (task !== "read" && task !== "practice" && !clip(input.question, 3)) return send(400, { error: "No question yet" });
    try { send(200, await this.run(task, input, images)); }
    catch (e) { send(e.status || (e.code === "nobrain" ? 503 : 500), { error: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "").slice(0, 300), code: e.code || "" }); }
  }
  listen(i = 0) {
    if (i >= PORTS.length) { console.log("[study helper] no free port"); return; }
    const srv = http.createServer((req, res) => this.handle(req, res).catch(e => { try { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); } catch (er) {} }));
    srv.on("error", () => this.listen(i + 1));
    srv.listen(PORTS[i], "127.0.0.1", () => { this.port = PORTS[i]; this.srv = srv; });
  }
  install() {
    this.listen();
    ipcMain.handle("helper:status", () => ({ port: this.port, code: this.data.token, seen: this.seen, folder: this.folder(), progress: this.progress() }));
    ipcMain.handle("helper:newCode", () => { this.data.token = this.code(); this.save(); return this.data.token; });
    ipcMain.handle("helper:folder", () => shell.showItemInFolder(this.folder()));   // opens the folder around it, with helper-extension highlighted
    ipcMain.handle("helper:reset", () => { this.data.skills = {}; this.data.log = []; this.save(); return this.progress(); });
  }
}

module.exports = { StudyHelper, tidy, TASKS, PORTS };
