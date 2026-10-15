// Study help on the School page: flashcards from your notes, practice quizzes, and a plan for an assignment.
// Uses the same AI as the rest of Skyline: your Claude API key, else the Claude account signed in on this PC, else the AI on this PC (Ollama).
// It helps you learn: it explains and quizzes, it doesn't hand in work for you.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { ipcMain } = require("electron");
const Anthropic = require("@anthropic-ai/sdk");
const { findClaude } = require("./brain");

const SYSTEM = `You are Sky, the study helper inside Skyline, a student's desktop app. The student is in middle school (about 8th grade).
Be accurate, clear and encouraging. Use simple words, short sentences. Never write the student's assignment for them: you help them understand and practise.
Answer with ONE JSON object only, no prose before or after, no code fences.`;

const TASKS = {
  // { topic, notes, cls, count } -> { title, cards: [{ q, a }] }
  cards: i => `Make ${clampN(i.count, 4, 30, 12)} flashcards${i.cls ? ` for ${i.cls}` : ""}${i.topic ? ` about: ${i.topic}` : ""}.
${i.notes ? `Use these notes (only what's in them, and fix obvious typos):\n"""\n${String(i.notes).slice(0, 12000)}\n"""\n` : ""}
Front: a term or a short question. Back: the answer in under 25 words. No duplicates. Mix definitions, examples and "why" questions.
JSON: {"title": "short deck name", "cards": [{"q": "front", "a": "back"}]}`,
  // { topic, notes, cards, cls, count } -> { questions: [{ q, choices: [4], answer: index, why }] }
  quiz: i => `Write a ${clampN(i.count, 3, 15, 8)}-question multiple-choice practice quiz${i.cls ? ` for ${i.cls}` : ""}${i.topic ? ` on: ${i.topic}` : ""}.
${i.cards && i.cards.length ? `Base it on these flashcards:\n${i.cards.slice(0, 60).map(c => `- ${c.q} = ${c.a}`).join("\n")}\n` : ""}${i.notes ? `Notes:\n"""\n${String(i.notes).slice(0, 8000)}\n"""\n` : ""}
Each question has exactly 4 choices, one correct. Wrong choices must be believable. Vary which position is correct. "why" explains the right answer in one sentence.
JSON: {"questions": [{"q": "question", "choices": ["A", "B", "C", "D"], "answer": 0, "why": "one sentence"}]}`,
  // { title, cls, due, notes } -> { steps: [{ t, mins }], tip }
  plan: i => `Help the student plan this ${i.cls ? i.cls + " " : ""}assignment: "${String(i.title || "").slice(0, 200)}"${i.due ? `, due ${i.due}` : ""}.
${i.notes ? `Their notes about it: ${String(i.notes).slice(0, 2000)}\n` : ""}Break it into 3 to 6 concrete steps they can tick off, each with a time estimate in minutes. Steps are things THEY do (read, outline, draft, check), not answers.
"tip" is one short, specific tip for doing well on it.
JSON: {"steps": [{"t": "step", "mins": 15}], "tip": "one sentence"}`,
  // { question, cls } -> { answer }   (explains; for homework questions it teaches the method, then lets them try)
  explain: i => `The student asks${i.cls ? ` (${i.cls})` : ""}: "${String(i.question || "").slice(0, 2000)}"
Explain it so they understand it. If it's a homework problem, show the method on a similar example and give a hint for theirs instead of the final answer.
Keep it under 180 words. Plain text with line breaks; no markdown symbols.
JSON: {"answer": "your explanation"}`,
};
const clampN = (n, a, b, d) => Math.max(a, Math.min(b, Math.round(+n || d)));

// the JSON object in whatever came back
function parse(text) {
  const s = String(text || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("The AI didn't answer properly. Try again.");
  return JSON.parse(s.slice(a, b + 1));
}
// keep only what the page can use
function tidy(task, j) {
  const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  if (task === "cards") {
    const cards = (Array.isArray(j.cards) ? j.cards : []).map(c => ({ q: str(c.q || c.front || c.term, 200), a: str(c.a || c.back || c.definition, 400) })).filter(c => c.q && c.a);
    if (!cards.length) throw new Error("The AI didn't make any cards. Try a clearer topic.");
    return { title: str(j.title, 50), cards };
  }
  if (task === "quiz") {
    const questions = (Array.isArray(j.questions) ? j.questions : []).map(q => ({ q: str(q.q || q.question, 300), choices: (Array.isArray(q.choices) ? q.choices : []).map(c => str(c, 160)).slice(0, 4), answer: Math.round(+q.answer), why: str(q.why, 300) }))
      .filter(q => q.q && q.choices.length === 4 && q.choices.every(Boolean) && q.answer >= 0 && q.answer < 4);
    if (!questions.length) throw new Error("The AI didn't make a usable quiz. Try again.");
    return { questions };
  }
  if (task === "plan") {
    const steps = (Array.isArray(j.steps) ? j.steps : []).map(s => ({ t: str(s.t || s.step || s, 140), mins: clampN(s.mins, 5, 240, 20) })).filter(s => s.t).slice(0, 8);
    if (!steps.length) throw new Error("The AI didn't make a plan. Try again.");
    return { steps, tip: str(j.tip, 240) };
  }
  if (task === "explain") return { answer: String(j.answer || "").trim().slice(0, 3000) };
  return j;
}

class Study {
  constructor({ ai, brain }) { this.ai = ai; this.brain = brain; }
  async which() {
    if (this.ai.key().key) return "key";
    const b = await this.brain.status().catch(() => ({}));
    return b.which || "";
  }
  async ask(task, input) {
    if (!TASKS[task]) throw new Error("Unknown study task");
    const prompt = TASKS[task](input || {}), via = await this.which();
    if (!via) { const e = new Error(this.brain.auth.installed ? "Sign in to Claude on the AI page to use study help" : "Study help needs an AI: add a Claude key in Settings or sign in to Claude"); e.code = "nobrain"; throw e; }
    let text;
    if (via === "key") {
      const client = new Anthropic({ apiKey: this.ai.key().key, maxRetries: 1, timeout: 90000 });
      const r = await client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content: prompt }], output_config: { effort: "low" } });
      text = r.content.filter(b => b.type === "text").map(b => b.text).join("");
    } else if (via === "claude") text = await this.cli(prompt);
    else if (via === "chatgpt") text = await this.brain.gpt.ask(SYSTEM + "\n\n---\n\n" + prompt);
    else text = await this.brain.askOllama(SYSTEM, prompt, []);
    return { via, ...tidy(task, parse(text)) };
  }
  // a prompt (and optional screenshots, as base64 PNG/JPEG) -> the AI's text. Used by the Study Helper.
  async raw(prompt, images = [], system = SYSTEM, opts = {}) {
    const model = opts.model || "claude-sonnet-5-5", effort = opts.effort || "low";
    const via = await this.which();
    if (!via) { const e = new Error(this.brain.auth.installed ? "Sign in to Claude on Skyline's AI page first" : "Add a Claude key in Skyline (Settings › AI) or sign in to Claude"); e.code = "nobrain"; throw e; }
    const imgs = images.map(d => { const m = String(d).match(/^data:(image\/(?:png|jpeg));base64,(.+)$/); return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null; }).filter(Boolean);
    if (via === "key") {
      const client = new Anthropic({ apiKey: this.ai.key().key, maxRetries: 2, timeout: 90000 });
      const r = await client.messages.create({ model, max_tokens: 16000, thinking: { type: "adaptive" }, system, messages: [{ role: "user", content: [...imgs, { type: "text", text: prompt }] }], output_config: { effort } });
      return r.content.filter(b => b.type === "text").map(b => b.text).join("");
    }
    if (via === "claude") return this.cli(prompt, imgs, system, model, effort);
    if (via === "chatgpt") { if (imgs.length) throw new Error("Reading the screen needs Claude for now: type or fix the question text instead"); return this.brain.gpt.ask(system + "\n\n---\n\n" + prompt); }
    if (imgs.length) throw new Error("Reading the screen needs Claude (the AI on this PC can't see pictures)");
    return this.brain.askOllama(system, prompt, []);
  }
  // one question to the Claude account on this PC (its own short run, so the assistant's conversation isn't disturbed)
  cli(prompt, images = [], system = SYSTEM, model = "claude-sonnet-5-5", effort = "low") {
    const cli = findClaude(); if (!cli) throw new Error("Claude Code isn't installed");
    const mcp = path.join(os.tmpdir(), "skyline-mcp-empty.json"); if (!fs.existsSync(mcp)) fs.writeFileSync(mcp, '{"mcpServers":{}}');
    const shell = /\.cmd$/i.test(cli), q = a => shell && a === "" ? '""' : a;
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--mcp-config", mcp,
      "--disable-slash-commands", "--no-session-persistence", "--effort", effort, "--model", model];
    return new Promise((res, rej) => {
      const p = spawn(cli, args.map(q), { cwd: os.tmpdir(), windowsHide: true, shell, stdio: ["pipe", "pipe", "ignore"] });
      let result = null;
      const t = setTimeout(() => { try { p.kill(); } catch (e) {} rej(new Error("Claude took too long. Try again.")); }, 150000);
      readline.createInterface({ input: p.stdout }).on("line", line => { let e; try { e = JSON.parse(line); } catch (er) { return; } if (e.type === "result") result = e; });
      p.on("error", e => { clearTimeout(t); rej(e); });
      p.on("exit", () => {
        clearTimeout(t);
        const out = String((result && result.result) || "").trim();
        if (!result || result.is_error || !out) {
          if (/authenticat|log ?in|sign ?in|oauth|expired/i.test(out)) { this.brain.auth.at = 0; const e = new Error("Your Claude sign-in ran out. Sign in again on the AI page."); e.code = "nobrain"; return rej(e); }
          return rej(new Error(/limit/i.test(out) ? "You've hit your Claude usage limit for now. Try again later." : out.slice(0, 160) || "Claude didn't answer"));
        }
        res(out);
      });
      p.stdin.on("error", () => {});
      p.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content: [...images, { type: "text", text: system + "\n\n---\n\n" + prompt }] } }) + "\n");
    });
  }
  install() {
    ipcMain.handle("study:ask", (e, task, input) => this.ask(String(task), input || {}));
    ipcMain.handle("study:via", () => this.which());
  }
}

module.exports = { Study, tidy, parse };
