// Skyline's brain when there's no Claude API key, like Jarvis: the Claude account signed in on this PC (through the
// Claude Code app), or else an AI model running on this PC in Ollama. Either answers with a small JSON plan
// ({ reply, do: [...] }) that the assistant carries out.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { spawn, execFile } = require("child_process");
const { net } = require("electron");

const OLLAMA = "http://127.0.0.1:11434";
const OLLAMA_OPTS = { temperature: 0.7, num_ctx: 8192 };   // the same every time: a different size would make Ollama reload the model
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isFile = f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };

function findClaude() {
  if (process.env.SKYLINE_TEST_CLAUDE && isFile(process.env.SKYLINE_TEST_CLAUDE)) return process.env.SKYLINE_TEST_CLAUDE;   // tests only: a stand-in Claude
  const c = [path.join(os.homedir(), ".local", "bin", "claude.exe")];
  for (const d of (process.env.PATH || "").split(";").filter(Boolean)) c.push(path.join(d, "claude.exe"));
  c.push(path.join(process.env.APPDATA || "", "npm", "claude.cmd"), path.join(process.env.ProgramFiles || "", "nodejs", "claude.cmd"));
  for (const d of (process.env.PATH || "").split(";").filter(Boolean)) c.push(path.join(d, "claude.cmd"));
  return c.find(isFile) || null;
}
// .cmd launchers only run through the shell; the real .exe doesn't need it
const shellFor = file => /\.cmd$/i.test(file);
const arg = (file, a) => shellFor(file) && a === "" ? '""' : a;
function run(file, args, ms) {
  return new Promise((res, rej) => execFile(file, args.map(a => arg(file, a)), { windowsHide: true, timeout: ms, shell: shellFor(file), cwd: os.tmpdir() },
    (e, out) => e && !out ? rej(e) : res(String(out || ""))));
}
async function getJson(url, ms, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await net.fetch(url, body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, signal: ctl.signal } : { signal: ctl.signal });
    if (!r.ok) throw new Error("Ollama answered " + r.status); return await r.json();
  } finally { clearTimeout(t); }
}

class Brain {
  constructor() {
    this.auth = { at: 0, ok: false, installed: false }; this.oll = { at: 0, models: [] };
    this.proc = null; this.primed = ""; this.turns = 0; this.pending = null; this.queue = Promise.resolve();
  }

  /* ---------- what's available ---------- */
  async claudeOk(force) {
    if (!force && Date.now() - this.auth.at < (this.auth.ok ? 10 : 2) * 60e3) return this.auth.ok;
    const cli = findClaude(); let ok = false;
    if (cli) { try { ok = !!JSON.parse(await run(cli, ["auth", "status", "--json"], 20000)).loggedIn; } catch (e) {} }
    this.cli = cli; this.auth = { at: Date.now(), ok, installed: !!cli };
    return ok;
  }
  ollamaExe() { return [path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe")].find(isFile) || null; }
  async ollamaModels(force) {
    if (!force && Date.now() - this.oll.at < 60e3) return this.oll.models;
    const list = async () => ((await getJson(OLLAMA + "/api/tags", 1500)).models || []).map(m => m.name).filter(n => !/embed/i.test(n));
    let models = [];
    try { models = await list(); }
    catch (e) {   // installed but not running: start it quietly in the background
      const exe = this.ollamaExe();
      if (exe) {
        // Ollama's own tray app runs the server with no windows. Started "detached" instead, the server has no console,
        // so every model it loads would open a visible command window.
        const tray = path.join(path.dirname(exe), "ollama app.exe");
        try {
          if (isFile(tray)) spawn(tray, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
          else { const p = spawn(exe, ["serve"], { windowsHide: true, stdio: "ignore" }); p.on("error", () => {}); p.unref(); }   // a hidden console its helpers share
        } catch (er) {}
        for (let i = 0; i < 16 && !models.length; i++) { await sleep(500); try { models = await list(); } catch (er) {} }
      }
    }
    this.oll = { at: Date.now(), models };
    return models;
  }
  // a quick one for talking; llama3.1 follows the plan format well and answers fast
  ollamaModel(models) {
    for (const want of [/^llama3\.[123]/, /^qwen/, /^gemma/, /^mistral/, /^phi/]) { const m = models.find(n => want.test(n)); if (m) return m; }
    return models[0] || "";
  }
  async status(force) {
    // the sign-in check runs a program (about a second); answers use the last result and refresh it in the background
    let claude;
    if (!force && this.auth.at) { claude = this.auth.ok; if (Date.now() - this.auth.at > (this.auth.ok ? 10 : 2) * 60e3 && !this.checking) { this.checking = true; this.claudeOk(true).finally(() => { this.checking = false; }); } }
    else claude = await this.claudeOk(force);
    const models = await this.ollamaModels(force);
    const local = this.ollamaModel(models);
    const gpt = this.gpt ? await this.gpt.ok(force).catch(() => false) : false;
    // which brain: the one you picked (if it's ready), else Claude, then ChatGPT, then the AI on this PC
    const ready = { claude, chatgpt: gpt, ollama: !!local };
    const which = ready[this.pref] ? this.pref : claude ? "claude" : gpt ? "chatgpt" : local ? "ollama" : "";
    return { which, pref: this.pref || "auto", claude, claudeInstalled: this.auth.installed, chatgpt: gpt, chatgptInstalled: !!(this.gpt && this.gpt.find()), chatgptInstalling: !!(this.gpt && this.gpt.installing), ollama: local, ollamaInstalled: !!this.ollamaExe() || models.length > 0 };
  }
  // sign in to the Claude account on this PC: the user does it themselves, in Claude's own window
  signIn() {
    const cli = findClaude(); if (!cli) throw new Error("Claude Code isn't installed on this PC");
    if (process.env.SKYLINE_TEST_CLAUDE) { this.auth.at = 0; return true; }   // tests never open windows
    spawn("cmd.exe", ["/c", "start", '"Sign in to Claude"', "cmd", "/k", `""${cli}" auth login"`], { detached: true, windowsHide: true, stdio: "ignore", shell: false, windowsVerbatimArguments: true }).unref();
    this.auth.at = 0;
    return true;
  }

  /* ---------- asking ---------- */
  // prime: what it should know (instructions, lists); turn: this message. Calls are taken one at a time.
  ask(which, prime, turn, history, model) {
    const job = this.queue.then(() => which === "claude" ? this.askClaude(prime, turn, model) : which === "chatgpt" ? this.gpt.ask(prime + "\n\n---\n\n" + turn) : this.askOllama(prime, turn, history));
    this.queue = job.catch(() => {});
    return job;
  }
  startClaude() {
    if (this.proc) return;
    const cli = this.cli || findClaude(); if (!cli) throw new Error("Claude Code isn't installed");
    const mcp = path.join(os.tmpdir(), "skyline-mcp-empty.json"); if (!isFile(mcp)) fs.writeFileSync(mcp, '{"mcpServers":{}}');
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--mcp-config", mcp,
      "--disable-slash-commands", "--no-session-persistence", "--effort", "low"];
    const p = spawn(cli, args.map(a => arg(cli, a)), { cwd: os.tmpdir(), windowsHide: true, shell: shellFor(cli), stdio: ["pipe", "pipe", "ignore"] });
    this.proc = p; this.primed = ""; this.turns = 0;
    p.stdin.on("error", () => {});
    readline.createInterface({ input: p.stdout }).on("line", line => {
      let e; try { e = JSON.parse(line); } catch (er) { return; }
      if (e.type === "result" && this.pending) { const w = this.pending; this.pending = null; w(e); }
    });
    p.on("exit", () => { if (this.proc === p) this.proc = null; if (this.pending) { const w = this.pending; this.pending = null; w({ is_error: true, result: "Claude stopped" }); } });
    p.on("error", () => { if (this.proc === p) this.proc = null; });
  }
  stopClaude() { if (this.proc) { try { this.proc.kill(); } catch (e) {} } this.proc = null; this.primed = ""; }
  warm(which) {
    if (which === "claude") { try { this.startClaude(); } catch (e) {} }
    if (which === "ollama" && this.ollamaModel(this.oll.models)) getJson(OLLAMA + "/api/generate", 60000, { model: this.ollamaModel(this.oll.models), keep_alive: "15m", options: OLLAMA_OPTS }).catch(() => {});
  }
  // read Skyline's instructions into the model ahead of time (Ollama keeps them, so answers only process the new words)
  async prefill(prime) {
    const model = this.ollamaModel(await this.ollamaModels()); if (!model) return;
    await getJson(OLLAMA + "/api/chat", 120000, { model, messages: [{ role: "system", content: prime }, { role: "user", content: "hi" }], format: "json", stream: false, keep_alive: "15m", options: { ...OLLAMA_OPTS, num_predict: 1 } });
  }
  async askClaude(prime, turn, model) {
    const key = crypto.createHash("sha1").update(prime + "|" + (model || "")).digest("hex");
    if (this.proc && this.primed && (this.primed !== key || this.turns >= 30)) this.stopClaude();   // what it knows changed: start fresh
    this.startClaude();
    const first = !this.primed, text = first ? prime + "\n\n" + turn : turn;
    const res = await new Promise(done => {
      const t = setTimeout(() => { if (this.pending) { this.pending = null; this.stopClaude(); done({ is_error: true, result: "Claude took too long" }); } }, 90000);
      this.pending = e => { clearTimeout(t); done(e); };
      this.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
    });
    const out = String(res.result || "").trim();
    if (res.is_error || !out) {
      this.stopClaude();
      if (/authenticat|log ?in|sign ?in|oauth|expired/i.test(out)) { this.auth = { at: Date.now(), ok: false, installed: true }; const e = new Error("signin"); e.signin = true; throw e; }
      throw new Error(out || "Claude didn't answer");
    }
    this.primed = key; this.turns++;
    return out;
  }
  async askOllama(prime, turn, history) {
    const models = await this.ollamaModels(), model = this.ollamaModel(models); if (!model) throw new Error("No AI model is installed in Ollama");
    const messages = [{ role: "system", content: prime }];
    for (const h of history || []) messages.push({ role: "user", content: h.said }, { role: "assistant", content: JSON.stringify({ reply: h.reply }) });
    messages.push({ role: "user", content: turn });
    const j = await getJson(OLLAMA + "/api/chat", 120000, { model, messages, format: "json", stream: false, keep_alive: "15m", options: OLLAMA_OPTS });
    return String((j.message || {}).content || "").trim();
  }
}

// the plan out of whatever came back: JSON, maybe wrapped in prose or a code fence
function parsePlan(text) {
  const s = String(text || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(s.slice(a, b + 1));
      const calls = (Array.isArray(j.do) ? j.do : Array.isArray(j.actions) ? j.actions : []).filter(x => x && typeof x === "object" && typeof x.tool === "string")
        .map(({ tool, ...input }) => ({ name: tool, input })).slice(0, 6);
      if (typeof j.reply === "string" || calls.length) return { reply: String(j.reply || "").trim(), calls };
    } catch (e) {}
  }
  return { reply: s.replace(/```[\s\S]*?```/g, "").replace(/[*_#`]/g, "").trim(), calls: [] };
}

module.exports = { Brain, parsePlan, findClaude, OLLAMA };
