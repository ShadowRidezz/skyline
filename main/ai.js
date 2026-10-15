// The AI Game Builder's connection to Claude. Runs only in the app's main process: the API key is
// stored encrypted (Windows DPAPI via safeStorage) and never reaches the interface.
// No key? Like the assistant (and Jarvis), it builds with the Claude account signed in on this PC (Claude Code),
// or else with an AI model running on this PC in Ollama.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { safeStorage, net } = require("electron");
const { Brain, findClaude, OLLAMA } = require("./brain");
const Anthropic = require("@anthropic-ai/sdk");
const AnthropicClient = Anthropic.default || Anthropic;

const MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 · best games (recommended)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 · faster and cheaper",
};
const DEFAULT_MODEL = "claude-opus-5-5";

const SYSTEM = `You are the engine behind Skyline's AI Game Builder. You write complete, polished, playable browser games from a player's description, and you modify existing games when asked. The bar is a polished indie game someone would happily share, not a tech demo.

# What you produce
A small web project that runs inside a sandboxed iframe with NO network access:
- index.html: the page. Link style.css with <link rel="stylesheet" href="style.css"> and load the game with <script src="script.js"></script> (or <script type="module" src="script.js"></script> when importing).
- style.css: all styling.
- script.js: all game code.
- Optional extra text files under assets/ (e.g. assets/levels.json, assets/sprites.svg). No binary files: draw graphics in code (Canvas 2D, SVG or WebGL), generate sound with the Web Audio API, and embed anything else as data: URIs.
- 3D: three.js r186 is available offline: import * as THREE from "./lib/three.module.js" at the top of script.js, loaded with type="module". Only the core library exists: no addons (no OrbitControls, GLTFLoader, EffectComposer, FontLoader...), no model or texture files, no CDNs, fonts or URLs. Build every object from three.js geometry and code-generated textures (CanvasTexture). Do not create files under lib/.
- If HTML buttons call functions (onclick="start()") and script.js is a module, put those functions on window (window.start = start).

# Make it look great
- One cohesive colour palette that matches the requested style; depth and contrast; a striking title screen with the game's name.
- 3D: renderer.outputColorSpace = THREE.SRGBColorSpace, ACESFilmic tone mapping, a hemisphere light plus a directional "sun" with soft shadows (sensible shadow camera bounds), fog for depth, MeshStandardMaterial with real roughness/metalness, procedural detail (CanvasTexture noise, stripes, panels), InstancedMesh for many repeated objects, a smooth follow camera with a little lag and shake.
- 2D: a canvas sized to window.innerWidth/innerHeight times devicePixelRatio (scale the context), layered or parallax backgrounds, gradients, glow, shapes drawn with paths rather than plain rectangles, particles.
- Readable HUD over the game (text-shadow or panels), the controls shown on the title screen.

# Make it feel great
- Responsive controls with acceleration and easing (keyboard; mouse/touch where natural).
- Juice: screen shake, hit-stop/flashes, particles on impacts and pickups, squash and stretch, animated UI numbers.
- Sound with the Web Audio API: short synthesized effects for actions, hits, pickups and game over; create the AudioContext on the first key or click.
- A real game loop: a clear goal, variety (different enemies/obstacles/pickups or level layouts), a difficulty that ramps up, score and best score (localStorage inside try/catch), lives or health, a game-over screen with the result and an instant restart. Waves or levels where it fits.

# It must work the first time
- No placeholders, no TODOs, no missing functions, no console errors. Mentally run the code before answering: every variable declared, every function defined, every element you look up exists in index.html.
- Fill the whole iframe and resize with it (the resize event). requestAnimationFrame with delta time; clamp large time steps (the player can pause the game from outside).
- Keep it fast (60 fps): reuse objects, cap particle counts, remove/dispose old objects on restart.
- Keep it self-contained (aim for under ~2000 lines of script).

# Safety
Only build games and normal interactive toys. Refuse (with a short <summary> explaining why, and no files) anything that is malware, collects passwords or personal data, tries to escape the sandbox, mines cryptocurrency, attacks other systems, imitates a real login page, or is otherwise harmful. Games about dark themes (horror, combat) are fine.

# Answer format (exactly this, nothing else)
<summary>One or two friendly sentences for the player: what you made or changed.</summary>
<meta name="Short game name" genre="Platformer|Racing|Horror|Shooter|Puzzle|RPG|Clicker|Simulator|Arcade|Other" description="One sentence describing the game."/>
<file path="index.html">
...complete file...
</file>
<file path="style.css">
...complete file...
</file>
<file path="script.js">
...complete file...
</file>

When changing an existing game: keep everything the player didn't ask to change, return every file you changed in full (never partial snippets or diffs), and omit files that didn't change. Keep the same <meta> unless the change calls for a new name.`;

function keyFile(dir) { return path.join(dir, "ai.json"); }
function readConf(dir) { try { return JSON.parse(fs.readFileSync(keyFile(dir), "utf8")); } catch (e) { return {}; } }
function writeConf(dir, c) { fs.mkdirSync(dir, { recursive: true }); const f = keyFile(dir), tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(c, null, 1), "utf8"); fs.renameSync(tmp, f); }

// extra notes for a smaller AI running on this PC: aim for games it can get right in one go
const LOCAL_NOTES = `
# Notes for this build
- Keep it focused: one polished core mechanic. script.js under about 700 lines. Canvas 2D only (no three.js, no modules).
- Build on this exact skeleton (it is known to work: a full-window canvas with the title / game-over screens in an overlay on top of it). Change the look and fill in the game, but keep the structure, the ids and the CSS layout rules:

<file path="index.html">
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>GAME NAME</title><link rel="stylesheet" href="style.css"></head>
<body><canvas id="game"></canvas><div id="ui"></div><script src="script.js"></script></body></html>
</file>
<file path="style.css">
html, body { margin: 0; height: 100%; overflow: hidden; background: #05030f; }
#game { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
#ui { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; color: #fff; font-family: system-ui, sans-serif; pointer-events: none; }
#ui.hidden { display: none; }
#ui button { pointer-events: auto; font-size: 18px; padding: 10px 24px; cursor: pointer; }
#hud { position: fixed; top: 12px; left: 16px; color: #fff; font: 600 18px system-ui, sans-serif; pointer-events: none; }
</file>
<file path="script.js">
const canvas = document.getElementById("game"), ctx = canvas.getContext("2d"), ui = document.getElementById("ui");
let W = 0, H = 0;
function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
addEventListener("resize", resize); resize();
const keys = {}; addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "Space" || e.code === "Enter") { if (state !== "playing") start(); } }); addEventListener("keyup", e => { keys[e.code] = false; });
let state = "title";
function screen(html) { ui.innerHTML = html; ui.classList.remove("hidden"); }
function start() { state = "playing"; ui.classList.add("hidden"); /* reset the game here */ }
function gameOver() { state = "over"; screen("<h1>Game over</h1><p>Score: ...</p><button onclick='start()'>Play again</button><p>or press Space</p>"); }
screen("<h1>GAME NAME</h1><p>How to play ...</p><button onclick='start()'>Start</button><p>or press Space</p>");
let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (state === "playing") update(dt); draw(); requestAnimationFrame(frame); }
function update(dt) { /* move things using dt (seconds) */ }
function draw() { ctx.fillStyle = "#05030f"; ctx.fillRect(0, 0, W, H); /* draw everything */ }
requestAnimationFrame(frame);
</file>

- Every function you call must exist and every variable must be declared. Write the three files completely, in the exact answer format.`;
const LOCAL_NOTES_3D = `
# Notes for this build (3D)
- Make it 3D with three.js, built on this exact skeleton (it is known to work). Keep the structure, the ids, the import line and the CSS; fill in the game.
- three.js is the ONLY library: import * as THREE from "./lib/three.module.js" at the very top of script.js, loaded with <script type="module">. There are no other files in lib/ (no OrbitControls, no loaders, no models): build every object from three.js shapes (BoxGeometry, CylinderGeometry, PlaneGeometry, SphereGeometry...) and MeshStandardMaterial.
- For a realistic look: fog, a hemisphere light plus a directional "sun" with shadows, a big ground plane, objects with sensible sizes and colours, a chase camera that follows the player smoothly.
- Every function you call must exist and every variable must be declared. Write all three files completely, in the exact answer format.
- Write script.js as plain top-level code: do NOT wrap it in a function, an IIFE or (async () => {...})(). Keep "window.start = start;" so the buttons can reach it.

<file path="index.html">
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>GAME NAME</title><link rel="stylesheet" href="style.css"></head>
<body><div id="ui"></div><div id="hud"></div><script type="module" src="script.js"></script></body></html>
</file>
<file path="style.css">
html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
canvas { position: fixed; inset: 0; display: block; }
#ui { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; color: #fff; font-family: system-ui, sans-serif; background: rgba(0,0,0,.35); z-index: 2; }
#ui.hidden { display: none; }
#ui button { font-size: 18px; padding: 10px 24px; cursor: pointer; }
#hud { position: fixed; top: 12px; left: 16px; color: #fff; font: 600 18px system-ui, sans-serif; z-index: 1; text-shadow: 0 1px 4px #000; }
</file>
<file path="script.js">
import * as THREE from "./lib/three.module.js";
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fc4e8); scene.fog = new THREE.Fog(0x9fc4e8, 60, 260);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(40, 80, 20); sun.castShadow = true; scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x6b8f4e })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const player = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial({ color: 0x2266ff })); player.position.y = 0.5; player.castShadow = true; scene.add(player);
const keys = {}; addEventListener("keydown", e => { keys[e.code] = true; if ((e.code === "Space" || e.code === "Enter") && state !== "playing") start(); }); addEventListener("keyup", e => { keys[e.code] = false; });
const ui = document.getElementById("ui"), hud = document.getElementById("hud");
let state = "title";
function screen(html) { ui.innerHTML = html; ui.classList.remove("hidden"); }
function start() { state = "playing"; ui.classList.add("hidden"); /* reset the game here */ }
function gameOver() { state = "over"; screen("<h1>Game over</h1><button onclick='start()'>Play again</button><p>or press Space</p>"); }
window.start = start;
screen("<h1>GAME NAME</h1><p>How to play ...</p><button onclick='start()'>Start</button><p>or press Space</p>");
let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (state === "playing") update(dt);
  camera.position.lerp(new THREE.Vector3(player.position.x, player.position.y + 5, player.position.z + 11), 0.1); camera.lookAt(player.position);
  renderer.render(scene, camera); requestAnimationFrame(frame); }
function update(dt) { /* move the player with keys (ArrowLeft/Right/Up/Down or KeyA/D/W/S) using dt, update the world, check collisions, hud.textContent = ... */ }
requestAnimationFrame(frame);
</file>`;
// which local model writes code best, most capable first
const CODERS = [/^qwen2\.5-coder/, /^qwen3/, /^gemma3:(27|12)b/, /^gemma3/, /^deepseek-coder/, /^codellama/, /^mistral-nemo/, /^llama3\.[123]/, /^qwen/, /^mistral/, /^phi/];
const pickCoder = models => { for (const re of CODERS) { const m = models.find(n => re.test(n)); if (m) return m; } return models[0] || ""; };

class AI {
  constructor(dataDir) { this.dir = dataDir; this.jobs = new Map(); this.brain = new Brain(); }
  // everything the Games page needs: can it build, and with what (Claude only, unless you allowed the AI on this PC)
  async fullStatus(force) {
    const s = this.status();
    if (s.configured) return { ...s, canBuild: true, via: "key", allowLocal: this.allowLocal() };
    const b = await this.brain.status(force).catch(() => ({}));
    const via = b.claude ? "claude" : this.allowLocal() && b.ollama ? "ollama" : "";
    return { ...s, canBuild: !!via, via, claudeInstalled: !!b.claudeInstalled, localModel: pickCoder(this.brain.oll.models || []), localAvailable: !!b.ollama, allowLocal: this.allowLocal() };
  }
  allowLocal() { return !!readConf(this.dir).allowLocal; }
  setAllowLocal(on) { const c = readConf(this.dir); c.allowLocal = !!on; writeConf(this.dir, c); return true; }

  key() {
    const c = readConf(this.dir);
    if (c.key && safeStorage.isEncryptionAvailable()) { try { return { key: safeStorage.decryptString(Buffer.from(c.key, "base64")), source: "saved" }; } catch (e) {} }
    if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "env" };
    return { key: null, source: null };
  }
  status() {
    const c = readConf(this.dir), k = this.key();
    return { configured: !!k.key, source: k.source, model: MODELS[c.model] ? c.model : DEFAULT_MODEL, models: MODELS,
      hint: k.key ? k.key.slice(0, 7) + "…" + k.key.slice(-4) : "" };
  }
  setKey(key) {
    key = String(key || "").trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new Error("That doesn't look like an Anthropic API key (it starts with sk-ant-)");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't encrypt the key on this PC");
    const c = readConf(this.dir); c.key = safeStorage.encryptString(key).toString("base64"); writeConf(this.dir, c);
    return this.status();
  }
  clearKey() { const c = readConf(this.dir); delete c.key; writeConf(this.dir, c); return this.status(); }
  setModel(m) { if (!MODELS[m]) throw new Error("Unknown model"); const c = readConf(this.dir); c.model = m; writeConf(this.dir, c); return this.status(); }

  async test() {
    const k = this.key(); if (!k.key) throw new Error("No API key yet");
    const client = new AnthropicClient({ apiKey: k.key, maxRetries: 1 });
    try { await client.models.retrieve(this.status().model); return { ok: true }; }
    catch (e) { throw new Error(explain(e)); }
  }

  cancel(jobId) { const j = this.jobs.get(jobId); if (j) j.abort.abort(); }

  // Build or change a game. onProgress({ phase, stage, thinking, file, chars }) streams what's happening.
  // Claude (your API key, or the Claude account signed in on this PC) writes it; Skyline test-plays it, sends any errors
  // back to be fixed, then shows Claude screenshots of its own game for a polish pass, and checks that again.
  async build({ jobId, request, files, history, options, error }, onProgress) {
    const k = this.key(), model = this.status().model, abort = new AbortController();
    this.jobs.set(jobId, { abort });
    try {
      const opt = options || {}, lines = [];
      if (history && history.length) lines.push("Earlier requests for this game, oldest first:\n" + history.slice(-12).map((h, i) => `${i + 1}. ${h}`).join("\n"));
      if (error) lines.push(`The game currently fails with this error in the player:\n${error}\nFind the cause and fix it.`);
      if (!files) {
        lines.push(`Create a new game.\nGame idea: ${request}`);
        const bits = [opt.type && opt.type !== "Any" && `Game type: ${opt.type}`, opt.style && opt.style !== "Any" && `Visual style: ${opt.style}`, opt.difficulty && `Difficulty: ${opt.difficulty}`].filter(Boolean);
        if (bits.length) lines.push(bits.join("\n"));
      } else if (request) lines.push(`Change the game: ${request}`);
      else if (!error) lines.push("Make a fresh, better version of this game: same idea, rebuilt from scratch with better visuals, feel and design.");
      const project = files && Object.keys(files).length ? "<current_project>\n" + Object.entries(files).map(([p, t]) => `<file path="${p}">\n${t}\n</file>`).join("\n") + "\n</current_project>" : "";
      const prompt = [project, lines.join("\n\n")].filter(Boolean).join("\n\n");

      let engine;
      if (k.key) engine = this.engineKey(k.key, model, abort, onProgress);
      else {
        const st = await this.brain.status(true).catch(() => ({}));
        if (st.claude) engine = this.engineCli(model, abort, onProgress);
        else if (this.allowLocal() && st.ollama) engine = this.engineOllama(prompt, files, abort, onProgress);
        else throw Object.assign(new Error(st.claudeInstalled ? "Sign in with Claude first (the button on the Games page). The builder uses your Claude account." : "Connect Claude first: add an API key in Settings › AI builder."), { code: "nokey" });
      }
      const polish = engine.claude && (!files || (!request && !error));   // new games and fresh versions get the playtest-and-polish pass
      return await runBuild(engine, prompt, files || null, polish, abort, onProgress);
    } catch (e) {
      if (abort.signal.aborted) throw Object.assign(new Error("Stopped"), { code: "cancelled" });
      if (e.code) throw e;
      throw new Error(explain(e));
    } finally { this.jobs.delete(jobId); }
  }

  /* ---------- the ways to reach a model: each is ask(text, images, label) -> parsed answer ---------- */
  engineKey(key, model, abort, onProgress) {
    const client = new AnthropicClient({ apiKey: key, maxRetries: 2, timeout: 20 * 60 * 1000 });
    return { claude: true, name: MODELS[model] ? MODELS[model].split(" · ")[0] : "Claude", ask: async (text, images = [], label = "") => {
      const content = [...images.map(b64 => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })), { type: "text", text }];
      let out = "", thinking = "", lastFile = "", tick = 0;
      const stream = client.beta.messages.stream({ model, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content }] }, { signal: abort.signal });
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "thinking_delta") { thinking += ev.delta.thinking; onProgress({ phase: "thinking", thinking: thinking.slice(-600) }); }
        else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          out += ev.delta.text; const m = out.match(/<file path="([^"]+)">(?![\s\S]*<file path=)/); if (m) lastFile = m[1];
          if (++tick % 8 === 0) onProgress({ phase: "writing", file: label || lastFile, chars: out.length });
        }
      }
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw Object.assign(new Error("Claude declined to build this. Try describing a different game."), { code: "refusal" });
      if (msg.stop_reason === "max_tokens") throw Object.assign(new Error("The game got too big to finish in one go. Try a simpler idea or ask for one change at a time."), { code: "toolong" });
      return parse(out);
    } };
  }
  engineCli(model, abort, onProgress) {
    const brain = this.brain;
    return { claude: true, name: (MODELS[model] ? MODELS[model].split(" · ")[0] : "Claude") + " (your Claude account)", ask: async (text, images = [], label = "") => {
      const cli = findClaude(); if (!cli) throw new Error("Claude Code isn't installed on this PC");
      const mcp = path.join(os.tmpdir(), "skyline-mcp-empty.json"); if (!fs.existsSync(mcp)) fs.writeFileSync(mcp, '{"mcpServers":{}}');
      const shell = /\.cmd$/i.test(cli), q = a => !shell ? a : a === "" ? '""' : /[\s&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;   // a .cmd runs through the shell: quote what it would split
      const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "", "--strict-mcp-config", "--mcp-config", mcp,
        "--disable-slash-commands", "--no-session-persistence", "--effort", "high", "--model", model, "--fallback-model", "claude-sonnet-5-5",
        "--system-prompt", "You are the engine behind Skyline's AI Game Builder. Follow the instructions in the message exactly and answer only in the format it asks for."];
      const p = spawn(cli, args.map(q), { cwd: os.tmpdir(), windowsHide: true, shell, stdio: ["pipe", "pipe", "ignore"] });
      const kill = () => { try { p.kill(); } catch (e) {} }; abort.signal.addEventListener("abort", kill);
      const guard = setTimeout(kill, 25 * 60e3);
      let out = "", lastFile = "", tick = 0;
      try {
        const result = await new Promise((done, fail) => {
          let final = null, thinking = "";
          readline.createInterface({ input: p.stdout }).on("line", line => {
            let e; try { e = JSON.parse(line); } catch (er) { return; }
            if (e.type === "stream_event" && e.event && e.event.type === "content_block_delta") {
              const d = e.event.delta || {};
              if (d.type === "text_delta" && d.text) { out += d.text; const m = out.match(/<file path="([^"]+)">(?![\s\S]*<file path=)/); if (m) lastFile = m[1]; if (++tick % 8 === 0) onProgress({ phase: "writing", file: label || lastFile, chars: out.length }); }
              if (d.type === "thinking_delta" && d.thinking) { thinking += d.thinking; onProgress({ phase: "thinking", thinking: thinking.slice(-600) }); }
            }
            if (e.type === "result") final = e;
          });
          p.on("error", fail);
          p.on("close", () => final ? done(final) : fail(abort.signal.aborted ? Object.assign(new Error("Stopped"), { code: "cancelled" }) : new Error("Claude stopped before finishing")));
          p.stdin.on("error", () => {});
          const content = [...images.map(b64 => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })), { type: "text", text: SYSTEM + "\n\n---\n\n" + text }];
          p.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
        });
        if (result.is_error) {
          const msg = String(result.result || "");
          if (/authenticat|log ?in|sign ?in|oauth|expired/i.test(msg)) { brain.auth.at = 0; throw Object.assign(new Error("Your Claude sign-in on this PC ran out. Sign in with Claude again (the button on the Games page)."), { code: "nokey" }); }
          if (/usage limit|rate limit|limit reached|quota/i.test(msg)) throw Object.assign(new Error("Your Claude plan's usage limit is reached for now. Try again later, or add an API key in Settings › AI builder."), { code: "limit" });
          throw new Error(msg.slice(0, 200) || "Claude couldn't finish the game");
        }
        if (!out) out = String(result.result || "");
        return parse(out.replace(/```[a-z]*\n?/gi, ""));
      } finally { clearTimeout(guard); abort.signal.removeEventListener("abort", kill); }
    } };
  }
  engineOllama(prompt, existing, abort, onProgress) {   // only when you've allowed it: far weaker than Claude
    const want3d = /visual style:[^\n]*\b(3d|realistic)\b|\b3d\b/i.test(prompt) || Object.values(existing || {}).some(t => /three\.module\.js/.test(t));
    const local = pickCoder(this.brain.oll.models || []);
    return { claude: false, name: local + " on this PC", ask: async (text, images = [], label = "") => {
      let out = "", lastFile = "", tick = 0;
      if (!label) onProgress({ phase: "thinking", thinking: `Loading ${local} on your graphics card…` });
      const r = await net.fetch(OLLAMA + "/api/chat", { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: local, stream: true, keep_alive: "1m", options: { temperature: 0.5, num_ctx: 16384, num_predict: 13000 },
          messages: [{ role: "system", content: SYSTEM + (want3d ? LOCAL_NOTES_3D : LOCAL_NOTES) }, { role: "user", content: text }] }) });
      if (!r.ok) throw new Error("The AI on your PC didn't answer (" + r.status + ")");
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
          let j; try { j = JSON.parse(line); } catch (e) { continue; }
          if (j.error) throw new Error("The AI on your PC: " + j.error);
          if (j.message && j.message.content) { out += j.message.content; const m = out.match(/<file path="([^"]+)">(?![\s\S]*<file path=)/); if (m) lastFile = m[1]; if (++tick % 8 === 0) onProgress({ phase: "writing", file: label || lastFile, chars: out.length }); } }
      }
      if (/<file path="[^"]+">/.test(out) && !/<\/file>\s*$/.test(out.trim())) out = out.trimEnd() + "\n</file>";
      return parse(out.replace(/```[a-z]*\n?/gi, ""));
    } };
  }
}

// write -> test-play -> fix -> (Claude looks at its game and polishes it) -> test-play -> fix
async function runBuild(engine, prompt, existing, polish, abort, onProgress) {
  const stopped = () => Object.assign(new Error("Stopped"), { code: "cancelled" });
  const stage = s => onProgress({ phase: "thinking", stage: s, thinking: "" });
  stage(existing ? "Claude is working on your change…" : "Claude is designing and writing your game…");
  const result = await engine.ask(prompt);
  if (!Object.keys(result.files).length && !existing) throw Object.assign(new Error(result.summary || "Claude didn't return a game this time. Try again, or describe the idea differently."), { code: "nofiles" });
  if (!Object.keys(result.files).length) return { ...result, model: engine.name, usage: null };
  const all = { ...(existing || {}), ...result.files };
  const tidy = () => { for (const f of fixModules(all)) result.files[f] = all[f]; if (exposeHandlers(all)) result.files["script.js"] = all["script.js"]; if (addMissingElements(all)) result.files["index.html"] = all["index.html"]; };
  const project = () => "<current_project>\n" + Object.entries(all).map(([p, t]) => `<file path="${p}">\n${t}\n</file>`).join("\n") + "\n</current_project>";
  // play it; while it errors, send the errors back (returns the last test: { errs, shots })
  const qa = async rounds => {
    let t = { errs: [], shots: [] };
    for (let round = 0; round <= rounds; round++) {
      if (abort.signal.aborted) throw stopped();
      stage(round ? "Test-playing the fixed version…" : "Test-playing the game…");
      tidy();
      t = await trial(all).catch(() => ({ errs: [], shots: [] }));
      t.errs = t.errs.map(e => { const m = e.match(/(\w+) is not defined/), code = Object.values(all).join("\n");
        return m && new RegExp(`on\\w+\\s*=\\s*["'][^"']*\\b${m[1]}\\(`).test(code) ? `${e} (a button's onclick calls ${m[1]}(), but script.js is a module or wraps its code in a function, so ${m[1]} isn't reachable: add "window.${m[1]} = ${m[1]};")` : e; });
      if (!t.errs.length || round === rounds) break;
      stage(`Found a bug while test-playing (${t.errs[0].slice(0, 120)}). Fixing it…`);
      const fix = await engine.ask(project() + `\n\nThe game currently fails with these errors in the player:\n${t.errs.slice(0, 4).join("\n")}\nFind the causes and fix them. Keep everything else the same. Return every file you change in full, in the answer format.`, [], "the fix");
      if (!Object.keys(fix.files).length) break;
      Object.assign(all, fix.files); Object.assign(result.files, fix.files);
    }
    return t;
  };
  let test = await qa(3);
  if (polish && !test.errs.length && test.shots.length) {
    // Claude playtests its own game: it sees the title screen and the game a few seconds in, and makes it better
    const before = { ...all }, beforeFiles = { ...result.files }, beforeSummary = result.summary;
    stage("Claude is playtesting its game from screenshots and polishing it…");
    const p = await engine.ask(project() + `\n\nAttached are screenshots of this game running in the player: first the title screen, then about three seconds after pressing Start while holding the arrow keys / WASD.
Act as a demanding game designer and playtester. Look closely at the screenshots and make the game dramatically better while keeping its idea:
- Fix anything that looks broken, empty, cut off, misaligned, too dark, too bright, unreadable or cheap.
- Richer visuals: lighting, colour, depth, detail, effects (particles, glows, trails), a striking title screen.
- Better feel: responsive controls, screen shake, impacts, sound effects, animated UI, satisfying feedback.
- Better game: clear goal, variety, a difficulty that ramps up, score and best score, a proper game over and restart.
Return every file you change in full, in the answer format. Keep the summary to one or two sentences about what you improved.`, test.shots, "the polish");
    if (Object.keys(p.files).length) {
      Object.assign(all, p.files); Object.assign(result.files, p.files);
      if (p.summary) result.summary = p.summary;
      test = await qa(2);
      if (test.errs.length) { for (const f of Object.keys(all)) delete all[f]; Object.assign(all, before); for (const f of Object.keys(result.files)) delete result.files[f]; Object.assign(result.files, beforeFiles); result.summary = beforeSummary; }   // the polish broke it: keep the working version
    }
  }
  return { ...result, model: engine.name, usage: null };
}

// Imports inside functions, imports of files that don't exist, a module loaded as a plain script: fix them.
function fixModules(files) {
  const changed = [];
  for (const [p, t0] of Object.entries(files)) {   // HTML script tags written into a .js file: drop them (and anything repeated after a stray </script>)
    if (!/\.js$/.test(p)) continue;
    let t = t0.replace(/^\s*<script[^>]*>\s*\n/i, ""); const cut = t.search(/^\s*<\/script>/im); if (cut >= 0) t = t.slice(0, cut);
    if (t !== t0) { files[p] = t.trimEnd() + "\n"; changed.push(p); }
  }
  for (const [p, t] of Object.entries(files)) {
    if (!/\.js$/.test(p) || !/^\s*import\s/m.test(t)) continue;
    const lines = t.split("\n"), imports = [], rest = [];
    for (const l of lines) {
      const m = l.match(/^\s*import\s.*?from\s+["']([^"']+)["'];?\s*$/) || l.match(/^\s*import\s+["']([^"']+)["'];?\s*$/);
      if (m) { const target = m[1].replace(/^\.\//, ""); if (target === "lib/three.module.js" || files[target]) imports.push(l.trim()); continue; }   // keep only files that exist
      rest.push(l);
    }
    const out = [...new Set(imports)].join("\n") + "\n" + rest.join("\n");
    if (out !== t) { files[p] = out; changed.push(p); }
    const html = files["index.html"];
    if (html) { const fixed = html.replace(new RegExp(`<script(?![^>]*type=["']module["'])([^>]*src=["'](?:\\./)?${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'])`, "i"), '<script type="module"$1');
      if (fixed !== html) { files["index.html"] = fixed; if (!changed.includes("index.html")) changed.push("index.html"); } }
  }
  return changed;
}

// Buttons call functions with onclick="start()", but a module's functions aren't global: expose the ones that are top-level.
function exposeHandlers(files) {
  const js = files["script.js"], html = files["index.html"] || "";
  if (!js || !/type=["']module["'][^>]*script\.js|script\.js["'][^>]*type=["']module/i.test(html)) return false;
  const names = [...new Set([...(js + html).matchAll(/on\w+\s*=\s*["'\\]+\s*(\w+)\(/g)].map(m => m[1]))].filter(n => new RegExp(`^(async\\s+)?function\\s+${n}\\s*\\(|^(const|let|var)\\s+${n}\\s*=`, "m").test(js) && !new RegExp(`window\\.${n}\\s*=`).test(js));
  if (!names.length) return false;
  files["script.js"] = js.trimEnd() + "\n// the buttons call these\n" + names.map(n => `window.${n} = ${n};`).join("\n") + "\n";
  return true;
}

// The script looks up elements by id that the page never made (e.g. the game's <canvas>): add them.
function addMissingElements(files) {
  const html = files["index.html"]; if (!html) return false;
  const js = Object.entries(files).filter(([p]) => /\.js$/.test(p)).map(([, t]) => t).join("\n");
  const wanted = new Set([...js.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g), ...js.matchAll(/querySelector\(\s*['"]#([\w-]+)['"]\s*\)/g)].map(m => m[1]));
  const missing = [...wanted].filter(id => !new RegExp(`id\\s*=\\s*["']?${id}["'\\s>]`).test(html) && !new RegExp(`\\.id\\s*=\\s*['"]${id}['"]`).test(js) && !new RegExp(`id=["'\`]${id}["'\`]`).test(js));
  if (!missing.length) return false;
  const tag = id => (/canvas/i.test(id) || new RegExp(`(\\w+)\\s*=\\s*document\\.(?:getElementById\\(\\s*['"]${id}['"]|querySelector\\(\\s*['"]#${id}['"])\\s*\\)[\\s\\S]{0,300}?\\1\\.getContext`).test(js)) ? `<canvas id="${id}"></canvas>` : `<div id="${id}"></div>`;
  const add = missing.map(tag).join("\n");
  files["index.html"] = /<script[\s>]/i.test(html) ? html.replace(/<script[\s>]/i, m => add + "\n" + m) : /<\/body>/i.test(html) ? html.replace(/<\/body>/i, add + "\n</body>") : html + "\n" + add;
  return true;
}

// Run the game for a few seconds in a hidden, offline window, press the usual keys, and collect its errors.
let trialSession = null, trialDir = "";
async function trial(files) {
  const { BrowserWindow, session } = require("electron");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skyline-trial-"));
  for (const [p, t] of Object.entries(files)) { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); }
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  for (const f of ["three.module.js", "three.core.js"]) { try { fs.copyFileSync(path.join(__dirname, "vendor", f), path.join(dir, "lib", f)); } catch (e) {} }
  if (!trialSession) {
    trialSession = session.fromPartition("skyline-trial");
    trialSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (d, cb) => cb({ cancel: true }));   // no internet for games
    // served like the real player (sky://), since 3D games load three.js as a module and modules don't load from plain files
    const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
    trialSession.protocol.handle("sky", req => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, ""), f = path.normalize(path.join(trialDir || "", rel || "index.html"));
      if (!trialDir || !f.startsWith(trialDir) || !fs.existsSync(f)) return new Response("", { status: 404 });
      return new Response(fs.readFileSync(f), { headers: { "content-type": (MIME[path.extname(f).toLowerCase()] || "application/octet-stream") + "; charset=utf-8" } });
    });
  }
  trialDir = dir;
  const w = new BrowserWindow({ show: false, width: 960, height: 600, webPreferences: { offscreen: true, session: trialSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errs = [], shots = [];
  const wc = w.webContents; wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", e => e.preventDefault());
  wc.on("console-message", (...a) => {
    const e = a[0], msg = e && e.message !== undefined ? e.message : a[2], level = e && e.level !== undefined ? e.level : a[1];
    if ((level === "error" || level === 3) && !/favicon|ERR_BLOCKED|net::ERR_FAILED/i.test(msg)) errs.push(String(msg).slice(0, 300));
  });
  wc.on("render-process-gone", () => errs.push("The game crashed"));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await Promise.race([w.loadURL("sky://trial/index.html"), sleep(8000)]).catch(e => errs.push("The page didn't load: " + e.message));
    await sleep(1200);
    const snap = async () => { try { const img = await wc.capturePage(); if (!img.isEmpty()) shots.push(img.toJPEG(74).toString("base64")); } catch (e) {} };
    await snap();   // the title screen
    // is the game using the window? (a squeezed canvas is the most common broken layout)
    const look = await wc.executeJavaScript(`(() => {
      const cs = [...document.querySelectorAll("canvas")].map(c => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height), big = cs[0];
      const over = [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 40 || r.left < -40); }).length;
      const b = [...document.querySelectorAll("button, [role=button]")].find(x => /start|play|begin|go/i.test(x.textContent || "") && x.getBoundingClientRect().width > 0); if (b) b.click();
      return { vw: innerWidth, vh: innerHeight, cw: big ? Math.round(big.width) : 0, ch: big ? Math.round(big.height) : 0, canvases: cs.length, over, clicked: !!b };
    })()`, true).catch(() => null);
    if (look && look.canvases && look.cw * look.ch < 0.45 * look.vw * look.vh && /innerWidth|clientWidth|100vw/.test(Object.values(files).join("\n")))
      errs.push(`Layout bug: the game's canvas is only ${look.cw}x${look.ch} in a ${look.vw}x${look.vh} window, so the game is squeezed. Make the canvas fill the whole window (position: fixed; inset: 0; width: 100vw; height: 100vh) and put the title and game-over screens in an overlay on top of it.`);
    if (look && look.over > 2) errs.push("Layout bug: parts of the page stick out past the edge of the window. Keep everything inside the window.");
    const key = k => { wc.sendInputEvent({ type: "keyDown", keyCode: k }); wc.sendInputEvent({ type: "char", keyCode: k === "Space" ? " " : k }); wc.sendInputEvent({ type: "keyUp", keyCode: k }); };
    wc.sendInputEvent({ type: "mouseDown", x: 480, y: 300, button: "left", clickCount: 1 }); wc.sendInputEvent({ type: "mouseUp", x: 480, y: 300, button: "left", clickCount: 1 });
    key("Space"); key("Enter"); await sleep(500);
    for (const k of ["Left", "Right", "Up", "Down", "A", "D", "W", "S", "Space"]) { wc.sendInputEvent({ type: "keyDown", keyCode: k }); await sleep(140); wc.sendInputEvent({ type: "keyUp", keyCode: k }); }
    wc.sendInputEvent({ type: "keyDown", keyCode: "Right" }); wc.sendInputEvent({ type: "keyDown", keyCode: "Up" }); await sleep(1200);   // hold a direction, like a player would
    await snap();   // a few seconds into the game
    wc.sendInputEvent({ type: "keyUp", keyCode: "Right" }); wc.sendInputEvent({ type: "keyUp", keyCode: "Up" });
    wc.sendInputEvent({ type: "mouseMove", x: 300, y: 200 }); await sleep(800);
  } finally {
    if (!w.isDestroyed()) w.destroy();
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
  return { errs: [...new Set(errs)], shots };
}

function explain(e) {
  if (e instanceof AnthropicClient.AuthenticationError) return "Your Anthropic API key was rejected. Check it in Settings › AI builder.";
  if (e instanceof AnthropicClient.PermissionDeniedError) return "Your Anthropic account doesn't have access to this model.";
  if (e instanceof AnthropicClient.RateLimitError) return "Anthropic says you're sending too many requests right now. Wait a minute and try again.";
  if (e instanceof AnthropicClient.BadRequestError) return "Anthropic couldn't take this request: " + (e.message || "").slice(0, 200);
  if (e instanceof AnthropicClient.APIConnectionError) return "Couldn't reach Anthropic. Check your internet connection.";
  if (e instanceof AnthropicClient.APIError) return `Anthropic had a problem (${e.status || "error"}). Try again in a moment.`;
  return e.message || String(e);
}

const ALLOWED = /^(index\.html|style\.css|script\.js|assets\/[\w.-]{1,60}\.(js|json|css|svg|txt|glsl|md|csv))$/;
function parse(text) {
  const files = {};
  for (const m of text.matchAll(/<file path="([^"]+)">\r?\n?([\s\S]*?)\r?\n?<\/file>/g)) {
    const p = m[1].replace(/^\.?\//, "");
    if (ALLOWED.test(p) && m[2].length < 1.5e6) files[p] = m[2];
  }
  const summary = (text.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.trim() || "";
  const meta = {};
  const mt = text.match(/<meta\s+([^>]*?)\/?>/);
  if (mt) for (const a of mt[1].matchAll(/(\w+)="([^"]*)"/g)) meta[a[1]] = a[2].slice(0, 200);
  return { files, summary, meta };
}

module.exports = { AI, MODELS };
