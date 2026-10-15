// ChatGPT as Sky's brain, with no API key: OpenAI's own Codex CLI, signed in with your ChatGPT account ("codex login",
// done by you in your browser). Skyline asks it questions with `codex exec` (read-only, nothing saved).
// If Codex isn't on this PC, "Connect ChatGPT" downloads OpenAI's official Windows build from their GitHub releases.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, execFile } = require("child_process");
const { net } = require("electron");

const isFile = f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };
const shellFor = f => /\.cmd$/i.test(f);

class ChatGPT {
  constructor(dataDir) { this.dir = path.join(dataDir, "codex"); this.auth = { at: 0, ok: false }; this.installing = null; }
  find() {
    if (process.env.SKYLINE_TEST_CODEX && isFile(process.env.SKYLINE_TEST_CODEX)) return process.env.SKYLINE_TEST_CODEX;   // tests only
    const c = [this.bundled(), path.join(process.env.APPDATA || "", "npm", "codex.cmd")].filter(Boolean);
    for (const d of (process.env.PATH || "").split(";").filter(Boolean)) c.push(path.join(d, "codex.exe"), path.join(d, "codex.cmd"));
    return c.find(isFile) || null;
  }
  // the copy Skyline downloaded (codex.exe somewhere inside its folder)
  bundled() {
    const walk = (d, depth) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return null; }
      for (const f of l) if (f.isFile() && /^codex\.exe$/i.test(f.name)) return path.join(d, f.name);
      if (depth > 0) for (const f of l) if (f.isDirectory()) { const r = walk(path.join(d, f.name), depth - 1); if (r) return r; }
      return null; };
    return walk(this.dir, 3);
  }
  run(args, ms = 20000) {
    const exe = this.find(); if (!exe) return Promise.reject(new Error("ChatGPT (Codex) isn't installed"));
    return new Promise(res => execFile(exe, args, { windowsHide: true, timeout: ms, shell: shellFor(exe), cwd: os.tmpdir() }, (e, out, err) => res({ code: e ? e.code || 1 : 0, out: String(out || "") + String(err || "") })));
  }
  // signed in? (checked at most every few minutes; the check runs a program)
  async ok(force) {
    if (!force && this.auth.at && Date.now() - this.auth.at < (this.auth.ok ? 10 : 2) * 60e3) return this.auth.ok;
    if (!this.find()) { this.auth = { at: Date.now(), ok: false }; return false; }
    const r = await this.run(["login", "status"]).catch(() => ({ code: 1, out: "" }));
    const ok = r.code === 0 && /logged in/i.test(r.out) && !/not logged in/i.test(r.out);
    this.auth = { at: Date.now(), ok, how: /chatgpt/i.test(r.out) ? "ChatGPT" : /api key/i.test(r.out) ? "API key" : "" };
    return ok;
  }
  // download OpenAI's official Codex for Windows (only when you click Connect ChatGPT)
  install() {
    if (this.find()) return Promise.resolve(this.find());
    if (this.installing) return this.installing;
    this.installing = (async () => {
      const rel = await (await net.fetch("https://api.github.com/repos/openai/codex/releases/latest", { headers: { "User-Agent": "Skyline" } })).json();
      const asset = pickAsset(rel.assets || []);
      if (!asset) throw new Error("Couldn't find OpenAI's Windows download for Codex");
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = path.join(this.dir, asset.name);
      const buf = Buffer.from(await (await net.fetch(asset.browser_download_url)).arrayBuffer());
      if (buf.length < 1e6) throw new Error("The download didn't finish");
      fs.writeFileSync(tmp, buf);
      // Windows' own tar unpacks .tar.gz and .zip
      await new Promise((res, rej) => execFile("tar.exe", ["-xf", tmp, "-C", this.dir], { windowsHide: true, timeout: 300000 }, e => e ? rej(e) : res()));
      fs.unlinkSync(tmp);
      if (!this.bundled()) { const exe = fs.readdirSync(this.dir).find(f => /^codex-x86_64.*\.exe$/i.test(f)); if (exe) fs.renameSync(path.join(this.dir, exe), path.join(this.dir, "codex.exe")); }
      if (!this.bundled()) throw new Error("Codex didn't install");
      return this.bundled();
    })().finally(() => { this.installing = null; });
    return this.installing;
  }
  // you sign in yourself, in your browser (OpenAI's own sign-in page)
  async signIn() {
    const exe = this.find() || await this.install();
    if (process.env.SKYLINE_TEST_CODEX) { this.auth.at = 0; return true; }   // tests never open windows
    spawn("cmd.exe", ["/c", "start", '"Sign in with ChatGPT"', "cmd", "/k", `""${exe}" login"`], { detached: true, windowsHide: true, stdio: "ignore", shell: false, windowsVerbatimArguments: true }).unref();
    this.auth.at = 0;
    return true;
  }
  // one question -> the reply text
  ask(prompt, ms = 150000) {
    const exe = this.find(); if (!exe) return Promise.reject(new Error("ChatGPT (Codex) isn't installed"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sky-gpt-"));
    return new Promise((res, rej) => {
      const p = spawn(exe, ["exec", "--skip-git-repo-check", "--ephemeral", "--json", "-"], { cwd, windowsHide: true, shell: shellFor(exe), stdio: ["pipe", "pipe", "pipe"] });
      let last = "", err = "";
      const t = setTimeout(() => { try { p.kill(); } catch (e) {} rej(new Error("ChatGPT took too long. Try again.")); }, ms);
      readline.createInterface({ input: p.stdout }).on("line", line => {
        let e; try { e = JSON.parse(line); } catch (er) { return; }
        if (e.type === "item.completed" && e.item && e.item.type === "agent_message" && e.item.text) last = e.item.text;
        if ((e.type === "error" || e.type === "turn.failed") && !last) err = (e.message || (e.error && e.error.message) || err || "").toString();
      });
      p.stderr.on("data", d => { err = (err + d).slice(-600); });
      p.on("error", e => { clearTimeout(t); rej(e); });
      p.on("exit", () => {
        clearTimeout(t); fs.rm(cwd, { recursive: true, force: true }, () => {});
        if (last.trim()) return res(last.trim());
        if (/log ?in|auth|unauthori[sz]ed|401|sign in/i.test(err)) { this.auth.at = 0; const e = new Error("Your ChatGPT sign-in ran out. Connect ChatGPT again on the Sky page."); e.code = "nobrain"; return rej(e); }
        rej(new Error(/limit|429|quota/i.test(err) ? "You've hit your ChatGPT usage limit for now. Try again later." : (err.trim().split("\n").pop() || "ChatGPT didn't answer").slice(0, 160)));
      });
      p.stdin.on("error", () => {});
      p.stdin.end(prompt);
    });
  }
}

// OpenAI's full Windows (x64) package of Codex (the CLI and its sandbox helpers); else the plain zip
function pickAsset(assets) {
  return assets.find(a => /^codex-package-x86_64-pc-windows-msvc\.tar\.gz$/i.test(a.name)) || assets.find(a => /^codex-x86_64-pc-windows-msvc\.exe\.zip$/i.test(a.name)) || null;
}

module.exports = { ChatGPT, pickAsset };
