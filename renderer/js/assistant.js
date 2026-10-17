// The assistant: a little glowing button that listens. Say "open Minecraft", "play Blinding Lights",
// "pause", "switch to Tokyo", "remember that I use Modrinth App for Minecraft"... It understands
// everyday commands offline, asks Claude for the rest (when connected), and remembers what you teach it.
import { $, $$, esc, sky, toast, dialog, store, fpsLoop, setSeg } from "./util.js";
import { icon } from "./social/icons.js";
import { Settings, Widgets } from "./widgets.js";
import { Themes } from "./themes.js";
import { Music } from "./music.js";
import { Songs, Player } from "./songs.js";
import { FX } from "./fx.js";
import { Voice, DEFAULT_VOICE } from "./voice.js";

export const ASST_DEFAULTS = { on: true, speak: true, engine: "neural", pvoice: DEFAULT_VOICE, vrate: 1.3, voice: "", rate: 1, chimes: true, wake: false, hotkeyOn: true, hotkey: "Alt+Shift+A", model: "claude-opus-5-5", ai: true };
const P = () => { const d = Settings.data; d.asst = { ...ASST_DEFAULTS, ...(d.asst || {}) }; return d.asst; };
const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>`;
const SUGGEST = ["Open Minecraft", "Play my songs", "What's the weather?", "Switch to Kanda Night", "Remember that I use Modrinth App for Minecraft", "Set a timer for 25 minutes"];

const A = { state: "idle", open: false, level: 0, lv: 0, heard: "", raf: 0, t0: 0, ctx: null, nav: {}, memTab: false, targets: [], speaking: false };

/* ---------- state + panel ---------- */
function duck(on) {   // Skyline's own songs get quieter while the assistant listens or talks
  const a = Player.audio; if (!a) return;
  if (on && A.ducked == null && !a.paused) { A.ducked = a.volume; a.volume = a.volume * .22; }
  else if (!on && A.ducked != null) { a.volume = A.ducked; A.ducked = null; }
}
function setState(s, label) {
  A.state = s; document.body.dataset.asst = s;
  duck(s === "listening" || s === "speaking" || s === "thinking");
  const st = $("#asState"); if (st) st.textContent = label || { idle: "Ready", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking", error: "Hmm" }[s] || "";
  $("#asstOrb")?.classList.toggle("live", s === "listening");
  if (A.sink && A.sink.onState) A.sink.onState(s);
  if (A.open) loop();
}
function openPanel(on = true) {
  A.open = on; $("#asst").classList.toggle("hidden", !on); $("#asstOrb").classList.toggle("open", on);
  if (on) { loop(); if (!A.memTab) renderChips(); }
  else { if (A.raf) A.raf(); A.raf = 0; if (A.state === "listening") sky.assistant.cancel(); Voice.stop(); setState("idle"); }
}
function showMem(on) {
  A.memTab = on; $("#asMem").classList.toggle("hidden", !on); $("#asBody").classList.toggle("hidden", on);
  $('[data-as="memory"]')?.classList.toggle("on", on);
  if (on) renderMemory($("#asMem"));
}
function renderChips() {
  const box = $("#asChips"); if (!box || A.state !== "idle" || $("#asReply").textContent) return;
  box.innerHTML = SUGGEST.map(s => `<button class="as-chip" data-say="${esc(s)}">${esc(s)}</button>`).join("");
}

/* ---------- listening ---------- */
async function listen() {
  if (!sky) return;
  if (A.state === "listening") { sky.assistant.cancel(); return; }
  Voice.stop(); clearInterval(A.typer);   // talking over it interrupts it
  openPanel(true); showMem(false);
  $("#asHeard").textContent = ""; $("#asReply").textContent = ""; $("#asChips").innerHTML = "";
  A.heard = ""; setState("listening"); if (P().chimes) Voice.chime("listen");
  if (P().speak && P().engine !== "windows") Voice.prepare(P().pvoice);
  sky.assistant.listen();
}
// The AI page listens without opening the pop-up panel: what's heard goes straight to it
function listenFor(cb, onState) {
  if (!sky) return;
  if (A.state === "listening") { sky.assistant.cancel(); return; }
  Voice.stop(); clearInterval(A.typer);
  A.sink = { cb, onState }; A.heard = ""; setState("listening"); if (P().chimes) Voice.chime("listen");
  sky.assistant.listen();
}
function deliver(text) {
  if (!A.sink) return ask(text, true);
  const s = A.sink; A.sink = null; setState("idle"); s.onState && s.onState("idle"); s.cb(text);
}
function dropSink() { if (A.sink) { const s = A.sink; A.sink = null; s.onState && s.onState("idle"); return true; } return false; }
async function converse(text) {
  if (P().speak && P().engine !== "windows") Voice.prepare(P().pvoice);
  let r;
  try { r = await sky.assistant.handle(text, context(), { model: P().model, ai: P().ai }); }
  catch (e) { r = { reply: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), actions: [] }; }
  const chips = [];
  for (const a of r.actions || []) { try { const c = await act(a); if (c) chips.push(c); } catch (e) { console.log("[asst] action failed", a.type, e.message); } }
  if (!r.quiet) say(r.reply, true);
  return { reply: r.reply, chips, needBrain: !!r.needBrain };
}
function onVoice(m) {
  if (m.t === "level") { A.level = Math.min(1, m.v / 60); return; }
  if (m.t === "wake") { if (A.state === "idle" && P().on) listen(); return; }
  if (A.state !== "listening" && m.t !== "error") return;
  if (m.t === "hear") { A.heard = m.text; $("#asHeard").textContent = m.text; $("#asHeard").classList.add("partial"); }
  else if (m.t === "heard") { A.heard = m.text; $("#asHeard").classList.remove("partial"); $("#asHeard").textContent = m.text; if (P().chimes) Voice.chime("heard"); deliver(m.text); }
  else if (m.t === "rejected" && m.text) { A.heard = m.text; }
  else if (m.t === "done" && A.state === "listening") {
    if (m.why === "silence") { if (dropSink()) { setState("idle"); if (P().chimes) Voice.chime("error"); return toast("I didn't catch anything. Try again, or type it."); } setState("idle"); if (P().chimes) Voice.chime("error"); say("I didn't catch anything. Tap me and talk, or type below.", false); }
    else if (m.why === "nomatch" || m.why === "ok") { if (A.heard) deliver(A.heard); else if (dropSink()) { setState("idle"); toast("Sorry, I didn't catch that."); } else { setState("idle"); say("Sorry, I didn't catch that.", false); } }
    else { dropSink(); setState("idle"); }
  } else if (m.t === "error") {
    const quiet = dropSink(); setState("idle");
    const msg = /microphone|audio/i.test(m.msg) ? "I can't hear you: check your microphone, and that Windows lets desktop apps use it (Settings › Privacy & security › Microphone)." : m.msg;
    if (quiet) return toast(msg, true);
    say(msg, false); if (m.fatal) toast(msg, true);
  }
}

/* ---------- understanding + acting ---------- */
function context() {
  return { name: (Settings.data.name || "").trim(), themes: Themes.all().map(t => ({ id: t.id, name: t.name })), weather: Widgets.weatherText(),
    playing: { on: !!Music.meta.on, title: Music.meta.title, artist: Music.meta.artist, playing: !!Music.meta.playing } };
}
export async function ask(text, spoken) {
  text = String(text || "").trim(); if (!text || !sky) return;
  openPanel(true); showMem(false);
  if (!spoken) { $("#asHeard").textContent = text; $("#asHeard").classList.remove("partial"); }
  $("#asReply").textContent = ""; $("#asChips").innerHTML = "";
  setState("thinking");
  if (P().speak && P().engine !== "windows") Voice.prepare(P().pvoice);
  let r;
  try { r = await sky.assistant.handle(text, context(), { model: P().model, ai: P().ai }); }
  catch (e) { r = { reply: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), actions: [] }; }
  const chips = [];
  for (const a of r.actions || []) { try { const c = await act(a); if (c) chips.push(c); } catch (e) { console.log("[asst] action failed", a.type, e.message); } }
  $("#asChips").innerHTML = chips.map(c => `<span class="as-done">${c}</span>`).join("");
  if (r.unknown) $("#asChips").innerHTML += SUGGEST.slice(0, 3).map(s => `<button class="as-chip" data-say="${esc(s)}">${esc(s)}</button>`).join("");
  say(r.reply, !r.quiet);
  if (r.quiet) setTimeout(() => openPanel(false), 700);
}
async function act(a) {
  if (a.type === "media") { Music.cmd(a.cmd === "shuffle" ? "shuffle" : a.cmd, a.cmd === "shuffle" ? 1 : undefined); return a.cmd === "pause" ? "Paused" : a.cmd === "next" ? "Next song" : a.cmd === "prev" ? "Previous" : "▶ Playing"; }
  if (a.type === "volume") {
    if (a.mute != null) { Music.cmd("mute", a.mute ? 1 : 0); return a.mute ? "Muted" : "Unmuted"; }
    const cur = Music.vol && Music.vol.vol >= 0 ? Music.vol.vol : 50, v = Math.max(0, Math.min(100, a.value != null ? a.value : cur + (a.delta || 0)));
    Music.cmd("vol", v); return `Volume ${v}%`;
  }
  if (a.type === "playLocal") { const ok = await Songs.play(a); return ok ? "Playing your songs" : ""; }
  if (a.type === "theme") { await Themes.select(a.id, { quiet: true }); Themes.persist(); A.nav.studioRefresh && A.nav.studioRefresh(); return "" + (Themes.find(a.id) || {}).name; }
  if (a.type === "go") { const [v, sec] = String(a.view).split(":"); A.nav.go(v, sec); return ""; }
  if (a.type === "ambient") { A.nav.ambient(!!a.on); return ""; }
  if (a.type === "timer") { Widgets.timer(a.minutes || 0, !!a.stop); return a.stop ? "Timer stopped" : "Focus timer"; }
  if (a.type === "task") { Widgets.addTask(a.text); return "Task added"; }
  if (a.type === "memory") { refreshMemoryViews(); return a.item ? "Remembered" : "Memory updated"; }
  if (a.type === "opened") { FX.sound("success"); return `${esc(a.name)}`; }
  if (a.type === "spotify") return `${esc(a.title)}`;
  return "";
}

/* ---------- talking back ---------- */
function voices() { try { return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); } catch (e) { return []; } }
function typeOut(text, msPerChar) {   // the reply appears as it's spoken
  const box = $("#asReply"); if (!box) return;
  box.textContent = ""; let i = 0; clearInterval(A.typer);
  const every = Math.max(12, msPerChar), step = Math.max(1, Math.round(every / msPerChar));
  A.typer = setInterval(() => { box.textContent = text.slice(0, i += step); if (i >= text.length) clearInterval(A.typer); }, every);
}
async function say(text, speak = true) {
  text = String(text || "");
  if (!speak || !P().speak) { typeOut(text, 9); if (A.state !== "listening") setState("idle"); return; }
  const p = P(), tok = (A.sayTok = (A.sayTok || 0) + 1);
  const started = msPerChar => () => { if (A.sayTok === tok) { setState("speaking"); typeOut(text, msPerChar); } };
  const done = () => { if (A.sayTok === tok && A.state === "speaking") setState("idle"); };
  if (p.engine !== "windows" && (Voice.usable() || (await Voice.refresh()).state === "ready")) {   // (asks again if the voice list wasn't in yet)
    try { await Voice.neural(text, { voice: p.pvoice, speed: p.vrate, onStart: started(58 / (p.vrate || 1)) }); return done(); }
    catch (e) { console.log("[voice] neural sound path unavailable:", e.message); if (A.sayTok !== tok) return; }
    // still Sky's voice when the normal path is blocked (Skyline hidden in the tray, no recent click); Windows only as the last resort
    try { await Voice.neuralQuiet(text, { voice: p.pvoice, speed: p.vrate, onStart: started(58 / (p.vrate || 1)) }); return done(); }
    catch (e) { console.log("[voice] Sky's voice failed, using the Windows voice:", e.message); if (A.sayTok !== tok) return; }
  }
  await Voice.windows(text, { name: p.voice, rate: p.rate, onStart: started(70 / (p.rate || 1)) });
  done();
}

/* ---------- the orb: rings of light that follow your voice ---------- */
function loop() {
  if (A.raf || !A.open) return;
  const cv = $("#asViz"); if (!cv) return;
  const frame = now => {
    if (!A.open) { if (A.raf) A.raf(); A.raf = 0; return; }
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const t = now / 1000, st = A.state, css = getComputedStyle(document.documentElement);
    const c1 = css.getPropertyValue("--a1").trim() || "#5b9cff", c2 = css.getPropertyValue("--a2").trim() || "#5b9cff";
    if (st === "speaking") A.level = Math.max(A.level, P().engine !== "windows" && Voice.speaking && Voice.usable() ? Voice.level() : Voice.windowsLevel());
    const target = st === "listening" ? A.level : st === "speaking" ? A.level * .9 : st === "thinking" ? .25 + .15 * Math.sin(t * 6) : .08 + .04 * Math.sin(t * 1.4);
    A.lv += (target - A.lv) * .18; A.level *= .9;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .26;
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = i / 96 * Math.PI * 2, wob = Math.sin(a * (3 + k) + t * (1.3 + k * .7) * (st === "thinking" ? 3 : 1)) * (4 + A.lv * 22) + Math.sin(a * 7 - t * 2.1 + k) * A.lv * 10;
        const r = R + k * 5 + wob; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      const gr = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
      g.strokeStyle = gr; g.lineWidth = 2.2 - k * .5; g.globalAlpha = .9 - k * .25; g.shadowColor = k ? c2 : c1; g.shadowBlur = 18; g.stroke();
    }
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * (1 + A.lv * .4)); core.addColorStop(0, c1 + "88"); core.addColorStop(.6, c2 + "22"); core.addColorStop(1, "transparent");
    g.globalAlpha = .6 + A.lv * .4; g.shadowBlur = 0; g.fillStyle = core; g.beginPath(); g.arc(cx, cy, R * 1.4, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    $("#asstOrb")?.style.setProperty("--lv", A.lv.toFixed(3));
  };
  A.raf = fpsLoop(40, frame);
}

/* ---------- memory ---------- */
let memCache = [];
async function refreshMemoryViews() {
  if (!sky) return; memCache = await sky.assistant.memory().catch(() => []);
  if (A.memTab) renderMemory($("#asMem"), true);
  const s = $("#asstMemSet"); if (s && s.offsetParent) renderMemory(s, true);
}
async function renderMemory(box, cached) {
  if (!box || !sky) return;
  if (!cached) memCache = await sky.assistant.memory().catch(() => []);
  if (!A.targets.length) sky.assistant.targets().then(t => { A.targets = t; fillTargets(); }).catch(() => {});
  box.innerHTML = `<div class="mem-head"><b>What Sky remembers</b><small>Teach it how you do things. Links make a phrase open the app you actually use.</small></div>
    <form class="mem-add" data-memform>
      <input name="text" placeholder="e.g. I use Modrinth instead of the normal Minecraft launcher" maxlength="300" autocomplete="off">
      <div class="mem-link"><span>When I say</span><input name="say" placeholder="minecraft" maxlength="60" autocomplete="off"><span>open</span><select name="target"><option value="">(nothing, just remember)</option></select></div>
      <div class="row"><button class="btn sm primary">Remember</button><span class="muted">Or just tell the assistant: “remember that…”</span></div></form>
    <div class="mem-list">${memCache.length ? memCache.slice().reverse().map(m => `<div class="mem" data-mem="${m.id}">
        <div class="mem-t"><span>${esc(m.text)}</span>${m.say ? `<small class="mem-chip">“${esc(m.say)}” → ${esc(m.target.name)}</small>` : ""}</div>
        ${m.say ? `<button class="btn xs ghost" data-memtry title="Open it now">Try</button>` : ""}<button class="ibtn xs" data-memdel title="Forget this">${icon("x")}</button></div>`).join("")
      : `<div class="ly-empty">Nothing yet. Try: “remember that I use Modrinth App for Minecraft”.</div>`}</div>`;
  fillTargets(box);
}
function fillTargets(scope) {
  const sels = scope ? [scope.querySelector("select[name=target]")] : $$("select[name=target]");
  for (const sel of sels) {
    if (!sel || !A.targets.length || sel.options.length > 1) continue;
    const games = A.targets.filter(t => t.kind === "game"), apps = A.targets.filter(t => t.kind === "app").sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="">(nothing, just remember)</option>` + (games.length ? `<optgroup label="Your games">${games.map(t => `<option value="game|${esc(t.id)}">${esc(t.name)}</option>`).join("")}</optgroup>` : "")
      + `<optgroup label="Apps">${apps.map(t => `<option value="app|${esc(t.id)}">${esc(t.name)}</option>`).join("")}</optgroup>`;
  }
}
function memoryEvents(root) {
  root.addEventListener("submit", async e => {
    const f = e.target.closest("[data-memform]"); if (!f) return; e.preventDefault();
    const text = f.text.value.trim(), say = f.say.value.trim(), tv = f.target.value;
    if (!text && !(say && tv)) return toast("Write something to remember", true);
    try {
      if (say && tv) { const [kind, ...rest] = tv.split("|"), id = rest.join("|"), t = A.targets.find(x => x.kind === kind && x.id === id);
        await sky.assistant.remember({ text: text || `When I say “${say}”, open ${t.name}`, say, target: t }); toast(`Got it: “${say}” opens ${t.name}`); }
      else { const r = await sky.assistant.handle("remember that " + text, context(), { ai: false }); toast(r.reply); }
      FX.sound("success"); refreshMemoryViews();
    } catch (er) { toast(er.message, true); }
  });
  root.addEventListener("click", async e => {
    const row = e.target.closest("[data-mem]"); if (!row) return;
    const m = memCache.find(x => x.id === row.dataset.mem); if (!m) return;
    if (e.target.closest("[data-memdel]")) { await sky.assistant.forget(m.id); refreshMemoryViews(); toast("Forgotten"); }
    if (e.target.closest("[data-memtry]")) { try { await sky.assistant.open(m.target); toast(`Opening ${m.target.name}…`); } catch (er) { toast(er.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); } }
  });
}

/* ---------- Settings › Assistant ---------- */
export function renderAssistantSettings() {
  const p = P(), box = $("#asstSet"); if (!box) return;
  if (!box.dataset.built) {
    box.dataset.built = "1";
    box.innerHTML = `
      <div class="glass sbox"><h3>Assistant</h3>
        <label class="toggle"><input type="checkbox" data-ap="on"><span class="sw"></span><span class="t"><b>Show the assistant button</b><small>The glowing mic in the side bar. Click it and talk (right-click to type).</small></span></label>
        <label class="toggle"><input type="checkbox" data-ap="hotkeyOn"><span class="sw"></span><span class="t"><b>Talk from anywhere</b><small>A shortcut that opens Skyline and starts listening</small></span></label>
        <label class="field">Shortcut (click, then press the keys)<input id="asHotkey" readonly></label>
        <label class="toggle"><input type="checkbox" data-ap="wake"><span class="sw"></span><span class="t"><b>Say “Hey Sky”</b><small>Listens for its name while Skyline runs. Off by default.</small></span></label>
        <p class="muted">Speech is understood by Windows' own speech recognizer, right on this PC: your voice never leaves it. If it can't hear you, allow desktop apps to use the microphone in Windows Settings › Privacy & security › Microphone.</p>
        <div class="row"><button class="btn sm" id="asTry">Try it now</button></div>
      </div>
      <div class="glass sbox wide vbox"><h3>Sky's voice <span class="badge" id="vStatus"></span></h3>
        <div class="row"><label class="toggle"><input type="checkbox" data-ap="speak"><span class="sw"></span><span class="t"><b>Speak replies out loud</b></span></label>
          <label class="toggle"><input type="checkbox" data-ap="chimes"><span class="sw"></span><span class="t"><b>Listening chimes</b></span></label>
          <span class="sp"></span><div class="seg" id="vEngine"><button data-v="neural">Natural voices</button><button data-v="windows">Windows voice</button></div></div>
        <div class="vgrid" id="vGrid"></div>
        <div class="el-box" id="vEleven"></div>
        <label class="field hidden" id="vWinRow">Windows voice<select id="asVoice"></select></label>
        <div class="row"><label class="sl"><span>Speed</span><input type="range" class="rg" min="80" max="170" step="5" id="asRate"><output id="asRateV"></output></label>
          <button class="btn sm primary" id="asHello">Say hello</button></div>
        <p class="muted">Sky's natural voices (Kokoro) are made right on this PC: free, no limits, no internet needed. Heart is the most natural. Add an ElevenLabs key for the most human voices of all. The &ldquo;classic&rdquo; ones at the bottom are the older, flatter voices.</p>
      </div>
      <div class="glass sbox"><h3>Smarter answers</h3>
        <label class="toggle"><input type="checkbox" data-ap="ai"><span class="sw"></span><span class="t"><b>Ask Claude when I don't know</b><small>Everyday commands work offline. Anything else (questions, “put on something chill”, multi-step requests) goes to the AI: your Claude account on this PC, a Claude key, or Ollama.</small></span></label>
        <label class="field">Model<select id="asModel"></select></label>
        <p class="muted" id="asAiNote"></p>
      </div>
      <div class="glass sbox wide" id="asstMemSet"></div>`;
    box.addEventListener("change", e => {
      const k = e.target.dataset.ap; if (k) { P()[k] = e.target.checked; Settings.save(); applyPrefs(); }
      if (e.target.id === "asVoice") { P().voice = e.target.value; Settings.save(); }
      if (e.target.id === "asModel") { P().model = e.target.value; Settings.save(); toast("Assistant model changed"); }
    });
    box.addEventListener("input", e => { if (e.target.id === "asRate") { const v = +e.target.value / 100; if (P().engine === "windows") P().rate = v; else P().vrate = v; $("#asRateV").textContent = e.target.value + "%"; e.target.style.setProperty("--v", ((e.target.value - 80) / 90 * 100) + "%"); Settings.save(); } });
    $("#asHotkey").addEventListener("keydown", e => {
      e.preventDefault(); if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
      if (!mods.length) return toast("Use at least one of Ctrl, Alt or Shift", true);
      P().hotkey = [...mods, e.key.length === 1 ? e.key.toUpperCase() : e.key].join("+"); e.target.value = P().hotkey; Settings.save(); toast("Assistant shortcut: " + P().hotkey);
    });
    $("#asTry").onclick = () => listen();
    $("#asHello").onclick = () => { openPanel(true); say(hello()); };
    $("#vEngine").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; P().engine = b.dataset.v; Settings.save(); if (b.dataset.v === "neural") Voice.warm(); renderVoiceBox(); });
    $("#vGrid").addEventListener("click", e => {
      const card = e.target.closest("[data-vid]"); if (!card) return;
      P().pvoice = card.dataset.vid; P().engine = "neural"; Settings.save(); renderVoiceBox();
      openPanel(true); say(sample(card.dataset.vid));
    });
    Voice.on(() => renderVoiceBox());
    $("#vEleven").addEventListener("click", async e => {
      const b = e.target.closest("[data-el]"); if (!b) return;
      if (b.dataset.el === "site") sky.openUrl("https://elevenlabs.io/app/settings/api-keys");
      if (b.dataset.el === "save") {
        const k = $("#vElKey").value.trim(); if (!k) return; b.disabled = true;
        try { const st = await sky.voice.elevenKey(k); $("#vElKey").value = "";
          const pick = st.voices.filter(v => v.eleven), best = pick.find(v => /^(jessica|sarah|alice|lily|matilda|charlotte|laura)$/i.test(v.name)) || pick.find(v => v.gender === "female") || pick[0];
          if (best) { P().pvoice = best.id; P().engine = "neural"; Settings.save(); }
          await Voice.refresh(); toast("ElevenLabs connected" + (best ? `: ${best.name} is your voice now` : ""));
          if (best) { openPanel(true); say(sample(best.id)); }
        } catch (er) { toast(String(er.message || er).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
        b.disabled = false;
      }
      if (b.dataset.el === "clear") { await sky.voice.elevenClear(); if (/^eleven:/.test(P().pvoice || "")) { P().pvoice = DEFAULT_VOICE; Settings.save(); } await Voice.refresh(); toast("ElevenLabs removed"); }
    });
    memoryEvents($("#asstMemSet"));
  }
  box.querySelectorAll("[data-ap]").forEach(i => i.checked = !!p[i.dataset.ap]);
  $("#asHotkey").value = p.hotkey; $("#asHotkey").disabled = !p.hotkeyOn;
  renderVoiceBox();
  const fillVoices = () => { const vs = voices(); $("#asVoice").innerHTML = (vs.length ? vs : [{ name: "" }]).map(v => `<option value="${esc(v.name)}">${esc(v.name || "Windows default")}</option>`).join(""); $("#asVoice").value = p.voice || (vs.find(v => /aria|jenny|natural/i.test(v.name)) || vs.find(v => /zira/i.test(v.name)) || vs[0] || {}).name || ""; };
  fillVoices(); try { speechSynthesis.onvoiceschanged = fillVoices; } catch (e) {}
  const rv = p.engine === "windows" ? p.rate : p.vrate;
  $("#asRate").value = Math.round((rv || 1) * 100); $("#asRateV").textContent = $("#asRate").value + "%"; $("#asRate").style.setProperty("--v", (($("#asRate").value - 80) / 90 * 100) + "%");
  sky.assistant.models().then(ms => { $("#asModel").innerHTML = Object.entries(ms).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(""); $("#asModel").value = p.model; });
  Promise.all([sky.ai.status(), sky.ai.brain().catch(() => ({}))]).then(([a, b]) => {
    $("#asAiNote").textContent = a.configured ? "Claude is connected with your API key." : b.which === "claude" ? "Thinking with the Claude account signed in on this PC (no key needed)." : b.which === "ollama" ? `Thinking with ${b.ollama} on this PC (Ollama, no key needed). Sign in to Claude on the AI page for smarter answers.` : "No AI yet: sign in to Claude on the AI page, or add an API key in Settings › AI.";
    $("#asModel").disabled = !a.configured && b.which !== "claude"; });
  renderMemory($("#asstMemSet"));
}
const hello = () => `Hi${Settings.data.name ? " " + Settings.data.name : ""}! I'm Sky. Ask me to open a game, play a song, or remember something for you.`;
function sample(id) {
  const v = Voice.voices().find(x => x.id === id) || { name: "Sky" }, n = Settings.data.name;
  return `Hey${n ? " " + n : ""}. ${v.name} here. The city's lit up tonight, and I'm right here whenever you need me.`;
}
function renderVoiceBox() {
  const p = P(), st = Voice.status(), grid = $("#vGrid"); if (!grid) return;
  setSeg($("#vEngine"), p.engine);
  const neural = p.engine !== "windows";
  grid.classList.toggle("hidden", !neural); $("#vWinRow").classList.toggle("hidden", neural);
  const vs = Voice.voices(), sig = vs.map(v => v.id).join();
  if (grid.dataset.sig !== sig) { grid.dataset.sig = sig; grid.innerHTML = vs.map(v => `<button class="vcard" data-vid="${esc(v.id)}" title="Choose ${esc(v.name)} and hear it">
      <span class="vav ${/woman|female/i.test(v.desc) || v.gender === "female" ? "f" : "m"}${v.eleven ? " el" : ""}">${esc(v.name[0])}</span><span class="vt"><b>${esc(v.name)} <small>${esc(v.accent)}</small></b><small>${esc(v.desc)}</small></span><span class="vplay">▶</span></button>`).join("")
      || `<p class="muted">No voices found.</p>`; }
  grid.querySelectorAll("[data-vid]").forEach(b => b.classList.toggle("on", b.dataset.vid === p.pvoice));
  const el = $("#vEleven");
  if (el) el.innerHTML = st.eleven
    ? `<div class="row"><b>ElevenLabs is connected</b><span class="muted">${st.elevenError ? esc(st.elevenError) : "The ElevenLabs voices at the top are the most human ones. If its characters run out, Skyline uses Ava until they reset."}</span><span class="sp"></span><button class="btn xs ghost" data-el="clear">Remove key</button></div>`
    : `<div class="el-pitch"><b>Want a voice that sounds like a real person?</b><p class="muted">ElevenLabs voices breathe, laugh and sound like they mean it (the top engine Jarvis supports). Make a free account, copy your API key, and paste it here. Free includes about 10,000 characters a month.</p>
       <div class="row"><input id="vElKey" type="password" placeholder="Paste your ElevenLabs API key" autocomplete="off" spellcheck="false"><button class="btn sm primary" data-el="save">Connect</button><button class="btn sm ghost" data-el="site">Get a key ↗</button></div></div>`;
  const badge = $("#vStatus"); badge.textContent = p.engine === "windows" ? "Windows voice" : st.state === "ready" ? (vs.find(v => v.id === p.pvoice) || vs[0] || {}).name + " · ready" : "Unavailable"; badge.className = "badge" + (st.state === "ready" && neural ? " ok" : st.state === "error" ? " warn" : "");
}
function applyPrefs() {
  const p = P();
  document.body.classList.toggle("asst-off", !p.on);
  if (sky) sky.assistant.wake(!!p.wake && p.on);
  renderAssistantSettings();
}

export const Assistant = {
  speak(text) { return say(text, true); },   // read something out loud (the daily briefing)
  init(nav) {
    A.nav = nav || {};
    if (!sky) return;
    $("#asstOrb").innerHTML = `<span class="ao-ring"></span><span class="ao-core">${MIC}</span><span class="ao-label">Ask Sky</span>`;
    $("#asstOrb").onclick = () => listen();
    $("#asstOrb").oncontextmenu = e => { e.preventDefault(); if (A.open) openPanel(false); else { openPanel(true); showMem(false); setTimeout(() => $("#asText").focus(), 30); } };
    const panel = $("#asst");
    panel.addEventListener("click", e => {
      const b = e.target.closest("[data-as]"), chip = e.target.closest("[data-say]");
      if (chip) return ask(chip.dataset.say);
      if (!b) return;
      if (b.dataset.as === "close") openPanel(false);
      if (b.dataset.as === "mic") listen();
      if (b.dataset.as === "memory") showMem(!A.memTab);
    });
    $("#asForm").addEventListener("submit", e => { e.preventDefault(); const t = $("#asText").value.trim(); if (!t) return; $("#asText").value = ""; ask(t); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && A.open && !/INPUT|TEXTAREA/.test(e.target.tagName)) { openPanel(false); e.stopPropagation(); } }, true);
    document.addEventListener("pointerdown", e => { if (A.open && !e.target.closest("#asst, #asstOrb, #gMenu, #dlg") && A.state !== "listening" && A.state !== "thinking") openPanel(false); });
    memoryEvents($("#asMem"));
    sky.assistant.onVoice(onVoice);
    sky.assistant.onHotkey(() => { if (P().on) listen(); });
    // warm up the ears in the background so the first "open Minecraft" is instant, then the voice
    setTimeout(() => sky.assistant.warm(), 2500);
    // 1.9.4: Microsoft's natural voices (Sonia by default) replace the Piper ones that sounded off; move the old defaults over, once
    if (!P().v194) { if (/^en_GB-(alan|jenny_dioco)-medium$/.test(P().pvoice || "")) P().pvoice = DEFAULT_VOICE; P().v194 = true; P().v192 = true; Settings.save(); }
    // 1.9.6: Sonia sounded robotic; Ava (Microsoft's most natural voice) takes over, once
    // Microsoft closed its Edge voices to apps (Oct 2026), so Sky had been falling back to a flat old voice: switch to Kokoro
    { const p = P(); if (!p.v200) { if (/^edge:|^en_/.test(p.pvoice || "") || !p.pvoice) p.pvoice = DEFAULT_VOICE; p.v200 = true; p.v196 = true; Settings.save(); } }   // (one object: P() makes a new one each call)
    if (!P().v196) { if (/^edge:en-(GB-Sonia|US-Ava|US-Emma|US-Jenny)Neural$/.test(P().pvoice || "") || !P().pvoice) P().pvoice = DEFAULT_VOICE; P().v196 = true; Settings.save(); }
    Voice.init().then(() => setTimeout(() => { if (P().speak && P().engine !== "windows") Voice.warm(); }, 9000));
    setTimeout(() => sky.ai.prime(context()).catch(() => {}), 6000);   // wake the AI up early (with what it needs to know) so the first question is quick
    applyPrefs();
    try { speechSynthesis.getVoices(); } catch (e) {}
  },
  listen, ask, listenFor, converse,
  openMemory() { openPanel(true); showMem(true); },
  render: renderAssistantSettings,
};
