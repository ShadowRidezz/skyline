// The Games page: search, the AI Game Builder, My Games, your library (browser, local and web games),
// Find Games, and the player / builder workspace. Games run in a sandboxed frame with no network.
import { $, $$, esc, sky, toast, dialog, setSeg, store, debounce } from "./util.js";
import { Scene } from "./scene/scene.js";
import { FX } from "./fx.js";

const TYPES = ["Platformer", "Racing", "Horror", "Shooter", "Puzzle", "RPG", "Clicker", "Simulator", "Other"];
const STYLES = ["2D", "3D", "Pixel", "Cartoon", "Realistic", "Neon", "Custom"];
// styles mix: pick as many as you like (e.g. Pixel + Neon)
const styles = () => Array.isArray(G.opts.style) ? G.opts.style : G.opts.style ? [G.opts.style] : [];
const EXAMPLES = ["A Geometry Dash-style platformer with 3 levels", "A horror game in an abandoned school at night", "A 2D top-down racing game with drifting",
  "A Minecraft-style block building game", "A neon arena shooter with waves of enemies", "A cosy farming clicker"];
const TWEAKS = ["Make the player faster", "Add three more enemies", "Add a boss fight", "Make it harder", "Add a main menu", "Change the colours to purple", "Add sound effects"];
const KIND = { browser: ["🌐", "Browser game"], local: ["💻", "Local game"], web: ["🔗", "Web game"] };
const GENRE_ICON = { Platformer: "🏃", Racing: "🏎️", Horror: "👻", Shooter: "🎯", Puzzle: "🧩", RPG: "🗡️", Clicker: "👆", Simulator: "🏗️", Arcade: "🕹️", Other: "🎮" };

const G = {
  projects: [], library: [], found: [], ai: { configured: false }, opts: { type: "", style: "", custom: "", difficulty: "Medium" },
  job: null, stage: null, built: false,
};

/* ---------- data ---------- */
async function refresh() {
  if (!sky) return;
  const r = await sky.games.list(); G.projects = r.projects; G.library = r.library;
  renderMine(); renderLib(); renderResults();
}
const when = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };

/* ---------- cards ---------- */
function thumbHTML(src, name, genre) {
  return src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'gc-ph',textContent:'${GENRE_ICON[genre] || "🎮"}'}))">`
    : `<span class="gc-ph">${GENRE_ICON[genre] || "🎮"}</span>`;
}
function projectCard(p) {
  return `<article class="gcard" data-proj="${p.id}">
    <div class="gc-thumb" data-act="play">${thumbHTML(p.thumb, p.name, p.genre)}<span class="gc-kind" title="${KIND.browser[1]} · made with AI">${KIND.browser[0]} Browser</span>${p.saved ? "" : `<span class="gc-draft">Draft</span>`}
      <span class="gc-play">▶</span></div>
    <div class="gc-body"><b title="${esc(p.name)}">${esc(p.name)}</b><p>${esc(p.description || "")}</p>
      <div class="gc-meta"><span>${esc(p.genre || "Game")}</span><span>·</span><span title="Created ${new Date(p.created).toLocaleString()}">Edited ${when(p.modified)}</span></div>
      <div class="gc-acts"><button class="btn sm primary" data-act="play">▶ Play</button><button class="btn sm" data-act="edit">✦ Edit with AI</button><button class="ibtn" data-act="menu" title="More">⋯</button></div></div>
  </article>`;
}
function libThumb(it) {   // the real cover when Skyline found one, else the game's own big logo, with its icon in the corner
  const ic = it.logo || it.icon || (it.thumb && it.thumb.startsWith("data:") ? it.thumb : "");
  if (it.art) return { cls: "cover", html: thumbHTML(it.art, it.name, it.genre) + (ic ? `<img class="gc-icon" src="${esc(ic)}" alt="">` : "") };
  if (it.logo) return { cls: "logo", style: `--logo:url("${esc(it.logo)}")`, html: `<img class="gc-logo" src="${esc(it.logo)}" alt="">` };
  if (it.kind === "local" && ic) return { cls: "icon", html: thumbHTML(ic, it.name, it.genre) + (it.artTried ? "" : `<span class="gc-loading"></span>`) };
  return { cls: "", html: thumbHTML(it.thumb, it.name, it.genre) };
}
function libCard(it) {
  const [icon, label] = KIND[it.kind] || KIND.web, th = libThumb(it);
  return `<article class="gcard" data-lib="${it.id}">
    <div class="gc-thumb ${th.cls}" data-act="play" ${th.style ? `style='${th.style}'` : ""}>${th.html}<span class="gc-kind" title="${label}">${icon} ${label.split(" ")[0]}</span><span class="gc-play">${it.kind === "web" ? "↗" : "▶"}</span></div>
    <div class="gc-body"><b title="${esc(it.name)}">${esc(it.name)}</b><p>${esc(it.description || (it.kind === "local" ? "Installed on this PC" : ""))}</p>
      <div class="gc-meta"><span>${esc(it.source || "")}</span>${it.genre ? `<span>·</span><span>${esc(it.genre)}</span>` : ""}${it.played ? `<span>·</span><span>Played ${when(it.played)}</span>` : ""}</div>
      <div class="gc-acts"><button class="btn sm primary" data-act="play">${it.kind === "web" ? "Open ↗" : "▶ Play"}</button><button class="ibtn" data-act="libmenu" title="More">⋯</button></div></div>
  </article>`;
}
function foundCard(r, i) {
  const inLib = G.library.some(x => x.url === r.url);
  return `<article class="gcard found" data-found="${i}">
    <div class="gc-thumb" data-act="open">${thumbHTML(r.thumb, r.name, r.genre)}<span class="gc-kind" title="Opens the game's website">🔗 Web</span><span class="gc-src">${esc(r.source)}</span></div>
    <div class="gc-body"><b title="${esc(r.name)}">${esc(r.name)}</b><p>${esc(r.description || "")}</p>
      <div class="gc-meta"><span>${esc(r.platform || "")}</span>${r.genre ? `<span>·</span><span>${esc(r.genre)}</span>` : ""}</div>
      <div class="gc-acts"><button class="btn sm" data-act="open" title="Opens ${esc(host(r.url))} in your browser">Open ↗</button><button class="btn sm ${inLib ? "" : "primary"}" data-act="add" ${inLib ? "disabled" : ""}>${inLib ? "✓ In library" : "+ Library"}</button></div></div>
  </article>`;
}
function renderMine() {
  const box = $("#gMine"); if (!box) return;
  $("#gMineCount").textContent = G.projects.length ? `${G.projects.length} game${G.projects.length > 1 ? "s" : ""}` : "";
  box.innerHTML = G.projects.length ? G.projects.map(projectCard).join("")
    : `<div class="g-empty"><span>✦</span><b>Your games appear here</b><p>Describe a game above and the AI builds it for you.</p></div>`;
}
function renderLib() {
  const box = $("#gLib"); if (!box) return;
  box.innerHTML = G.library.length ? G.library.slice().sort((a, b) => (b.played || b.added) - (a.played || a.added)).map(libCard).join("")
    : `<div class="g-empty"><span>💻</span><b>Add the games you already have</b><p>Find installed Steam, Epic and desktop games, or save web games from Find Games.</p></div>`;
}

/* ---------- search ---------- */
function renderResults() {
  const q = ($("#gSearch")?.value || "").trim().toLowerCase(), box = $("#gResults"); if (!box) return;
  box.classList.toggle("hidden", !q);
  if (!q) return;
  const match = x => `${x.name} ${x.description || ""} ${x.genre || ""} ${x.source || ""}`.toLowerCase().includes(q);
  const mine = G.projects.filter(match), lib = G.library.filter(match);
  box.innerHTML = `<div class="g-sec-h"><h2>Results for “${esc(q)}”</h2><span class="sp"></span><button class="btn sm" data-gfind="${esc(q)}">🔎 Find “${esc(q)}” online</button></div>
    ${mine.length || lib.length ? `<div class="g-grid">${mine.map(projectCard).join("")}${lib.map(libCard).join("")}</div>`
      : `<div class="g-empty slim"><b>Nothing saved matches.</b><p>Try Find Games to search legitimate game sites, or build it with AI.</p></div>`}`;
}
async function findGames(q) {
  const box = $("#gFound"), src = $("#gSrc").querySelector(".on")?.dataset.v || "all";
  $("#gFindQ").value = q;
  box.innerHTML = `<div class="g-loading"><i></i><i></i><i></i><span>Searching itch.io and FreeToGame…</span></div>`;
  try {
    const res = await sky.games.webSearch(q, src);
    G.found = res.filter(r => !r.error);
    const errs = res.filter(r => r.error).map(r => r.error);
    box.innerHTML = (G.found.length ? `<div class="g-grid">${G.found.map(foundCard).join("")}</div>` : `<div class="g-empty slim"><b>No games found for “${esc(q)}”.</b><p>Try a different word, like a genre.</p></div>`)
      + (errs.length ? `<p class="muted g-err">${errs.map(esc).join(" · ")}</p>` : "");
  } catch (e) { box.innerHTML = `<div class="g-empty slim"><b>Couldn't search right now.</b><p>${esc(e.message)}</p></div>`; }
}
async function openExternal(url) {
  const h = host(url);
  if (await dialog({ title: "Open an external website?", text: `This opens ${h} in your normal web browser. Skyline doesn't download or install anything.`, ok: `Open ${h}` })) {
    try { await sky.games.openWeb(url); } catch (e) { toast(e.message, true); }
  }
}

/* ---------- the AI Game Builder card ---------- */
function renderBuilder() {
  const box = $("#gBuilder"); if (!box) return;
  if (G.job && G.job.mode === "create") return renderProgress(box);
  if (!G.ai.canBuild && G.ai.claudeInstalled) {   // the builder runs on Claude: sign in once with your Claude account
    box.innerHTML = `<div class="gb-head"><span class="gb-badge">✦ AI GAME BUILDER · CLAUDE</span><h2>Sign in with Claude to build games</h2>
      <p>The builder uses Claude (Opus 5.5) through your Claude account: no API key, nothing to pay extra. Claude writes the game, Skyline test-plays it, and Claude looks at screenshots of its own game to fix and polish it before you play.</p></div>
      <div class="gb-claude"><button class="btn primary lg" data-gb="signin" ${G.signingIn ? "disabled" : ""}>${G.signingIn ? "Waiting for you to sign in…" : "✦ Sign in with Claude"}</button>
        <span class="muted">${G.signingIn ? "Finish signing in in the window that opened (it opens your browser). Skyline switches over by itself." : "Opens Claude's own sign-in. You sign in yourself; Skyline never sees your password."}</span></div>
      <details class="gb-more"><summary>Other ways</summary>
        <p>Use an Anthropic API key instead (Settings › AI builder)${G.ai.localAvailable ? `, or <button class="link" data-gb="local">use the free AI on this PC</button> (much weaker: simple games only)` : ""}.</p></details>`;
    return;
  }
  if (!G.ai.canBuild) {
    box.innerHTML = `<div class="gb-head"><span class="gb-badge">✦ AI GAME BUILDER</span><h2>Turn an idea into a game you can play</h2>
      <p>The builder uses Claude. Install Claude Code and sign in with your Claude account (no key needed), or connect your own API key:</p></div>
      <ol class="gb-steps"><li>Open <button class="link" data-gb="console">console.anthropic.com</button>, sign in, and create an API key (you pay Anthropic directly for what you use).</li>
        <li>Paste the key here. It's stored encrypted on this PC and only Skyline's background process ever sees it.</li></ol>
      <div class="gb-key"><input type="password" id="gbKey" placeholder="sk-ant-…" autocomplete="off" spellcheck="false"><button class="btn primary" data-gb="key">Connect</button></div>
      <p class="muted">You can change the key and the model later in Settings › AI builder.</p>`;
    return;
  }
  const chip = (list, sel, attr) => list.map(v => `<button class="gchip ${(Array.isArray(sel) ? sel.includes(v) : sel === v) ? "on" : ""}" data-${attr}="${v}">${attr === "gtype" ? (GENRE_ICON[v] || "") + " " : ""}${v}</button>`).join("");
  box.innerHTML = `<div class="gb-head"><span class="gb-badge">✦ AI GAME BUILDER</span><h2>What game do you want to create?</h2></div>
    <div class="gb-idea"><textarea id="gbIdea" rows="3" placeholder="Describe your game… what you do, the setting, the vibe. The more detail, the better." maxlength="2000">${esc(store.local("idea") || "")}</textarea>
      <div class="gb-ex">${EXAMPLES.map(e => `<button class="gex" data-gex="${esc(e)}">${esc(e)}</button>`).join("")}</div></div>
    <div class="gb-opts">
      <div class="gb-opt"><span>Game type</span><div class="gchips">${chip(TYPES, G.opts.type, "gtype")}</div></div>
      <div class="gb-opt"><span>Style <small class="gb-hint">mix any</small></span><div class="gchips">${chip(STYLES, styles(), "gstyle")}</div>
        <input id="gbCustom" class="gb-custom ${styles().includes("Custom") ? "" : "hidden"}" placeholder="Describe the look, e.g. watercolour, retro CRT, low-poly…" value="${esc(G.opts.custom)}" maxlength="120"></div>
      <div class="gb-opt"><span>Difficulty</span><div class="seg" id="gbDiff"><button data-v="Easy">Easy</button><button data-v="Medium">Medium</button><button data-v="Hard">Hard</button></div></div>
    </div>
    <div class="gb-warn hidden" id="gbWarn">⚠ The free AI on your PC isn't good at 3D or realistic games. <b>Sign in to Claude</b> (free with your Claude account, no key) and the builder uses Claude instead: far better games. <button class="btn xs" data-gb="signin">Sign in with Claude</button></div>
    <div class="gb-go"><button class="btn primary lg" data-gb="create">✦ CREATE GAME</button><span class="muted" id="gbModel"></span></div>`;
  setSeg($("#gbDiff"), G.opts.difficulty);
  const hard = styles().some(v => /3D|Realistic/.test(v));
  $("#gbWarn") && $("#gbWarn").classList.toggle("hidden", !(G.ai.via === "ollama" && hard));
  $("#gbModel").textContent = G.ai.via === "claude" ? "Claude Opus 5.5 (your Claude account) · writes, test-plays and polishes · usually 5–10 minutes"
    : G.ai.via === "key" ? `${(G.ai.models || {})[G.ai.model]?.split(" · ")[0] || "Claude"} · writes, test-plays and polishes · usually 5–10 minutes`
    : G.ai.via === "ollama" ? `${G.ai.localModel || "AI"} on your PC (free, no key) · usually 1–4 minutes; best with simpler ideas`
    : `${(G.ai.models || {})[G.ai.model]?.split(" · ")[0] || "Claude"} · usually 1–4 minutes`;
}
function renderProgress(box) {
  const j = G.job, secs = Math.round((Date.now() - j.started) / 1000);
  const phase = j.phase === "writing" ? `${j.file === "the polish" ? "Polishing the game" : j.file === "the fix" ? "Fixing a bug" : "Writing " + (j.file || "the game")}${j.chars ? ` · ${(j.chars / 1024).toFixed(1)} KB` : ""}` : j.stage || (j.phase === "thinking" ? "Designing the game…" : "Starting…");
  const html = `<div class="gb-progress"><div class="gb-orb"><i></i><i></i><i></i></div>
    <div class="gb-pt"><b>${esc(phase)}</b><span class="muted">${esc(j.request).slice(0, 140)} · ${secs}s</span>
      <p class="gb-think">${esc((j.thinking || "").slice(-320))}</p></div>
    <button class="btn sm ghost" data-gb="cancel">Stop</button></div>`;
  if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
}

let jobSeq = 0;
async function runJob(mode, { id, request, error } = {}) {
  if (G.job) return toast("The AI is still working on a game", true);
  if (!G.ai.canBuild) { G.ai = await sky.ai.status(true).catch(() => G.ai); if (!G.ai.canBuild) { go("games"); return toast("Sign in to Claude on the AI page, or connect a key", true); } }
  const jobId = "j" + Date.now() + (jobSeq++);
  const style = styles().map(v => v === "Custom" ? (G.opts.custom || "Custom") : v).join(" + ");   // e.g. "Pixel + Neon"
  G.job = { jobId, mode, id, request: request || (mode === "fix" ? "Fixing the error…" : "A fresh version of this game"), started: Date.now(), phase: "start" };
  document.body.classList.add("ai-busy");
  const tick = setInterval(() => { if (G.job) { if (mode === "create") renderBuilder(); else renderChatProgress(); } }, 1000);
  if (mode === "create") renderBuilder(); else renderChatProgress();
  try {
    const r = await sky.games.build({ jobId, mode, id, request, error, options: { type: G.opts.type, style, difficulty: G.opts.difficulty } });
    G.job = null; clearInterval(tick); document.body.classList.remove("ai-busy");
    await refresh();
    if (mode === "create") { store.local("idea", ""); renderBuilder(); openStage(r.id, "build", true); toast("Your game is ready ✦"); FX.confetti(); }
    else if (G.stage && G.stage.id === r.id) { await loadStage(r.unchanged ? false : true); if (!r.unchanged) toast("Updated ✦"); }
  } catch (e) {
    G.job = null; clearInterval(tick); document.body.classList.remove("ai-busy");
    if (mode === "create") renderBuilder(); else if (G.stage) renderChat();
    if (!/Stopped/.test(e.message)) dialog({ title: "The AI couldn't finish", text: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), ok: "OK", cancel: "" });
  }
}

/* ---------- the stage: play a game, or build it with the AI ---------- */
async function openStage(id, mode = "play", fresh) {
  G.stage = { id, mode, errors: [], thumbed: 0, expanded: false, code: false };
  document.body.classList.add("staging");
  Scene.pause("gamestage", true);
  $("#gStage").classList.remove("hidden");
  $("#gStage").dataset.mode = mode;
  await loadStage(true);
  if (fresh) G.stage.fresh = true;
}
function closeStage() {
  if (!G.stage) return;
  $("#gFrame").src = "about:blank"; $("#gStage").classList.add("hidden");
  document.body.classList.remove("staging", "stage-expanded");
  Scene.pause("gamestage", false);
  G.stage = null; refresh();
}
async function loadStage(reload) {
  const s = G.stage; if (!s) return;
  const p = await sky.games.project(s.id); s.meta = p.meta; s.files = p.files;
  $("#gsName").textContent = p.meta.name; $("#gsGenre").textContent = `${GENRE_ICON[p.meta.genre] || "🎮"} ${p.meta.genre || "Game"}`;
  $("#gsSaved").textContent = p.meta.saved ? "✓ Saved" : "Draft"; $("#gsSaved").className = "badge " + (p.meta.saved ? "ok" : "warn");
  $("#gsUndo").disabled = !(p.meta.undo > 0);
  renderChat(); renderCode();
  if (reload) restart();
}
function restart() {
  const s = G.stage; if (!s) return;
  s.errors = []; s.paused = false; renderError(); setPauseBtn();
  $("#gFrame").src = `sky://play/${s.id}/index.html?r=${Date.now()}`;
}
function cmd(c) { try { $("#gFrame").contentWindow.postMessage({ skyline: "player", cmd: c }, "*"); } catch (e) {} }
function setPauseBtn() { const p = G.stage && G.stage.paused; $("#gsPause").innerHTML = p ? "▶ Play" : "⏸ Pause"; $("#gStage").classList.toggle("paused", !!p); }
function renderError() {
  const s = G.stage, box = $("#gsError"); if (!s) return;
  const e = s.errors[0];
  box.classList.toggle("hidden", !e);
  if (e) box.innerHTML = `<span>⚠ The game hit an error: <b>${esc(e.message)}</b>${e.file ? ` <span class="muted">(${esc(e.file)}${e.line ? ":" + e.line : ""})</span>` : ""}${s.errors.length > 1 ? ` <span class="muted">+${s.errors.length - 1} more</span>` : ""}</span>
    <span class="sp"></span><button class="btn sm primary" data-gs="fix">✦ Fix with AI</button><button class="ibtn" data-gs="dismiss" title="Dismiss">✕</button>`;
}
function renderChat() {
  const s = G.stage, box = $("#gsChat"); if (!s || !box) return;
  const chat = (s.meta && s.meta.chat) || [];
  box.innerHTML = chat.map(m => m.role === "note" ? `<div class="cm note">${esc(m.text)}</div>`
    : `<div class="cm ${m.role}"><div class="cm-b">${esc(m.text || "").replace(/\n/g, "<br>")}</div><span class="cm-t">${when(m.at)}</span></div>`).join("")
    + (G.job && G.job.id === s.id ? `<div class="cm ai working" id="gsWorking"></div>` : "");
  renderChatProgress();
  box.scrollTop = box.scrollHeight;
  $("#gsSend").disabled = !!G.job;
}
function renderChatProgress() {
  const el = $("#gsWorking"); if (!el || !G.job) return;
  const j = G.job, secs = Math.round((Date.now() - j.started) / 1000);
  el.innerHTML = `<div class="cm-b"><div class="gb-orb sm"><i></i><i></i><i></i></div><b>${j.phase === "writing" ? (j.file === "the fix" ? "Fixing a bug…" : `Updating ${esc(j.file || "the game")}…`) : esc(j.stage || "Thinking about your change…")}</b>
    <span class="muted"> ${secs}s</span><p class="gb-think">${esc((j.thinking || "").slice(-240))}</p><button class="btn xs ghost" data-gb="cancel">Stop</button></div>`;
}
function renderCode() {
  const s = G.stage; if (!s || !s.files) return;
  const names = Object.keys(s.files).sort((a, b) => ["index.html", "style.css", "script.js"].indexOf(a) - ["index.html", "style.css", "script.js"].indexOf(b));
  s.file = names.includes(s.file) ? s.file : names.includes("script.js") ? "script.js" : names[0];
  $("#gsTabs").innerHTML = names.map(n => `<button class="${n === s.file ? "on" : ""}" data-file="${esc(n)}">${esc(n)}</button>`).join("");
  $("#gsCode").textContent = s.files[s.file] || "";
  $("#gsLines").textContent = `${(s.files[s.file] || "").split("\n").length} lines`;
}
async function maybeThumb() {
  const s = G.stage; if (!s || s.expanded || s.code || !s.meta || s.thumbed === s.meta.modified) return;
  s.thumbed = s.meta.modified;
  await new Promise(r => setTimeout(r, 2200));
  if (!G.stage || G.stage !== s || s.code) return;
  const r = $("#gFrame").getBoundingClientRect();
  if (r.width > 100) try { await sky.games.thumb(s.id, { x: r.x, y: r.y, width: r.width, height: r.height }); } catch (e) {}
}

function stageEvents() {
  addEventListener("message", e => {
    const s = G.stage; if (!s || e.source !== $("#gFrame").contentWindow) return;
    const m = e.data; if (!m || m.skyline !== "game") return;
    if (m.type === "error" || m.type === "console") { if (s.errors.length < 10 && !s.errors.some(x => x.message === m.message)) { s.errors.push(m); renderError(); } }
    if (m.type === "loaded") { cmd("focus"); maybeThumb(); }
    if (m.type === "paused") { s.paused = true; setPauseBtn(); }
    if (m.type === "resumed") { s.paused = false; setPauseBtn(); }
  });
  $("#gStage").addEventListener("click", async e => {
    const b = e.target.closest("[data-gs]"); if (!b || !G.stage) return;
    const s = G.stage, a = b.dataset.gs;
    if (a === "back" || a === "exit") return closeStage();
    if (a === "pause") { if (s.paused) { cmd("resume"); $("#gFrame").focus(); cmd("focus"); } else cmd("pause"); }
    if (a === "play") { if (s.paused) cmd("resume"); $("#gFrame").focus(); cmd("focus"); if (s.code) toggleCode(false); }
    if (a === "restart") restart();
    if (a === "expand") toggleExpand();
    if (a === "code") toggleCode(!s.code);
    if (a === "save") { await sky.games.update(s.id, { saved: true }); await loadStage(false); toast("Saved to My Games"); refresh(); }
    if (a === "rename") renameProject(s.id).then(() => loadStage(false));
    if (a === "edit") { $("#gStage").dataset.mode = "build"; s.mode = "build"; renderChat(); }
    if (a === "undo") { try { await sky.games.undo(s.id); await loadStage(true); toast("Went back one change"); } catch (er) { toast(er.message, true); } }
    if (a === "regen") { if (await dialog({ title: "Make a fresh version?", text: "The AI rebuilds this game from scratch with the same idea. You can undo it.", ok: "Regenerate" })) runJob("regenerate", { id: s.id }); }
    if (a === "fix") { const er = s.errors.map(x => `${x.message}${x.file ? ` (${x.file}:${x.line || "?"}:${x.col || "?"})` : ""}${x.stack ? "\n" + x.stack : ""}`).join("\n\n"); s.errors = []; renderError(); runJob("fix", { id: s.id, error: er }); }
    if (a === "dismiss") { s.errors = []; renderError(); }
    if (a === "export") exportMenu(b, s.id);
    if (a === "copy") { navigator.clipboard.writeText(s.files[s.file] || "").then(() => toast("Copied " + s.file)); }
  });
  $("#gsTabs").addEventListener("click", e => { const b = e.target.closest("[data-file]"); if (!b) return; G.stage.file = b.dataset.file; renderCode(); });
  const send = () => { const t = $("#gsInput"), v = t.value.trim(); if (!v || !G.stage) return; t.value = ""; G.stage.meta.chat.push({ role: "user", text: v, at: Date.now() }); runJob("edit", { id: G.stage.id, request: v }); renderChat(); };
  $("#gsSend").onclick = send;
  $("#gsInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $("#gsTweaks").innerHTML = TWEAKS.map(t => `<button class="gex" data-tweak="${esc(t)}">${esc(t)}</button>`).join("");
  $("#gsTweaks").addEventListener("click", e => { const b = e.target.closest("[data-tweak]"); if (b) { $("#gsInput").value = b.dataset.tweak; $("#gsInput").focus(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && G.stage && G.stage.expanded) { e.preventDefault(); toggleExpand(); } });
}
function toggleExpand() {
  const s = G.stage; s.expanded = !s.expanded;
  document.body.classList.toggle("stage-expanded", s.expanded);
  $("[data-gs=expand]").innerHTML = s.expanded ? "⤡ Shrink" : "⛶ Expand";
  setTimeout(() => { $("#gFrame").focus(); cmd("focus"); }, 50);
  if (s.expanded) toast("Expanded · Esc or ⤡ to shrink");
}
function toggleCode(on) { G.stage.code = on; $("#gStage").classList.toggle("code", on); $("[data-gs=code]").classList.toggle("on", on); }

/* ---------- project actions ---------- */
async function renameProject(id) {
  const p = G.projects.find(x => x.id === id) || (G.stage && G.stage.meta);
  const name = await dialog({ title: "Rename game", input: p ? p.name : "", ok: "Rename" }); if (!name) return;
  await sky.games.update(id, { name }); await refresh();
}
function exportMenu(anchor, id) {
  menu(anchor, [["📁 Download project (index.html, style.css, script.js, assets/)", () => doExport(id, "folder")], ["📄 Download as one HTML file", () => doExport(id, "html")]]);
}
async function doExport(id, mode) {
  try { const r = await sky.games.exportGame(id, mode); if (r) toast("Exported to " + r); } catch (e) { toast(e.message, true); }
}
function menu(anchor, items) {
  const m = $("#gMenu"); m.innerHTML = items.map((it, i) => it ? `<button data-mi="${i}" class="${it[2] || ""}">${esc(it[0])}</button>` : `<hr>`).join("");
  const r = anchor.getBoundingClientRect(); m.classList.remove("hidden");
  m.style.left = Math.min(innerWidth - m.offsetWidth - 10, r.right - m.offsetWidth) + "px";
  m.style.top = (r.bottom + m.offsetHeight + 8 > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + "px";
  const close = () => { m.classList.add("hidden"); document.removeEventListener("pointerdown", out, true); };
  const out = e => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("pointerdown", out, true));
  m.onclick = e => { const b = e.target.closest("[data-mi]"); if (!b) return; close(); items[+b.dataset.mi][1](); };
}

async function scanPC() {
  toast("Looking for games on this PC…");
  let list = [];
  try { list = await sky.games.scanLocal(); } catch (e) { return toast(e.message, true); }
  const fresh = list.filter(x => !x.inLibrary);
  if (!fresh.length) return dialog({ title: "No new games found", text: list.length ? "Everything Skyline found is already in your library." : "Skyline looked in Steam, Epic Games and your desktop and Start menu shortcuts. Use “Add game…” to pick one yourself.", ok: "OK", cancel: "" });
  const html = `<div class="scan">${fresh.map((g, i) => `<label class="scan-row"><input type="checkbox" data-si="${i}" checked><span class="scan-ic">${g.thumb ? `<img src="${esc(g.thumb)}" alt="">` : "🎮"}</span>
    <span class="scan-t"><b>${esc(g.name)}</b><small>${esc(g.source)}</small></span></label>`).join("")}</div>`;
  if (!(await dialog({ title: `Found ${fresh.length} game${fresh.length > 1 ? "s" : ""} on this PC`, text: "Choose which to add to your library. They launch through Steam, Epic or their own shortcut.", html, ok: "Add selected" }))) return;
  const picked = $$("#dlg [data-si]").filter(c => c.checked).map(c => fresh[+c.dataset.si]);
  if (!picked.length) return;
  const added = await sky.games.libAdd(picked); toast(`Added ${added.length} game${added.length !== 1 ? "s" : ""}`); refresh();
}

async function playLib(it) {
  if (it.kind === "web") return openExternal(it.url);
  try { await sky.games.launch(it.id); toast(`Starting ${it.name}…`); refresh(); } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
}

/* ---------- events ---------- */
function events() {
  const page = $("#view-games");
  page.addEventListener("click", async e => {
    const gb = e.target.closest("[data-gb]");
    if (gb) {
      const a = gb.dataset.gb;
      if (a === "console") sky.openUrl("https://console.anthropic.com/settings/keys");
      if (a === "signin") {
        try { await sky.ai.signIn(); } catch (er) { return toast(er.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
        G.signingIn = true; renderBuilder(); clearInterval(G.signPoll); let n = 0;
        G.signPoll = setInterval(async () => {
          G.ai = await sky.ai.status(true).catch(() => G.ai);
          if (G.ai.canBuild || ++n > 60) { clearInterval(G.signPoll); G.signingIn = false; renderBuilder(); if (G.ai.via === "claude") toast("✦ Signed in. The builder now uses Claude"); }
        }, 5000);
      }
      if (a === "local") { await sky.ai.allowLocal(true); G.ai = await sky.ai.status(true); renderBuilder(); toast("Using the AI on this PC (simple games only). Sign in with Claude any time for real ones."); }
      if (a === "key") {
        gb.disabled = true; gb.textContent = "Checking…";
        try { await sky.ai.setKey($("#gbKey").value); G.ai = await sky.ai.status(); renderBuilder();
          sky.ai.test().then(() => toast("Claude is connected and saved ✦"), er => toast("Key saved, but Claude didn't answer the test: " + er.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true)); }
        catch (er) { gb.disabled = false; gb.textContent = "Connect"; toast(er.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
      }
      if (a === "create") {
        const idea = $("#gbIdea").value.trim();
        if (idea.length < 4) { $("#gbIdea").focus(); return toast("Describe your game first", true); }
        runJob("create", { request: idea });
      }
      if (a === "cancel" && G.job) sky.games.cancel(G.job.jobId);
      return;
    }
    const ex = e.target.closest("[data-gex]"); if (ex) { $("#gbIdea").value = ex.dataset.gex; store.local("idea", ex.dataset.gex); $("#gbIdea").focus(); return; }
    const ty = e.target.closest("[data-gtype]"); if (ty) { G.opts.type = G.opts.type === ty.dataset.gtype ? "" : ty.dataset.gtype; renderBuilderKeep(); return; }
    const st = e.target.closest("[data-gstyle]"); if (st) { const v = st.dataset.gstyle, cur = styles(); G.opts.style = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
      renderBuilderKeep(); if (v === "Custom" && G.opts.style.includes("Custom")) $("#gbCustom").focus(); return; }
    const df = e.target.closest("#gbDiff button"); if (df) { G.opts.difficulty = df.dataset.v; setSeg($("#gbDiff"), df.dataset.v); return; }
    const gf = e.target.closest("[data-gfind]"); if (gf) { findGames(gf.dataset.gfind); $("#gFindSec").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const pc = e.target.closest("[data-proj]");
    if (pc) {
      const id = pc.dataset.proj, b = e.target.closest("[data-act]"); if (!b) return;
      if (b.dataset.act === "play") return openStage(id, "play");
      if (b.dataset.act === "edit") return openStage(id, "build");
      if (b.dataset.act === "menu") return menu(b, [["▶ Open", () => openStage(id, "play")], ["✦ Edit with AI", () => openStage(id, "build")], ["✎ Rename", () => renameProject(id)],
        ["⧉ Duplicate", async () => { await sky.games.duplicate(id); refresh(); toast("Duplicated"); }], ["⬇ Export project", () => doExport(id, "folder")], ["⬇ Export as one HTML file", () => doExport(id, "html")], null,
        ["🗑 Delete", async () => { const p = G.projects.find(x => x.id === id); if (await dialog({ title: `Delete “${p.name}”?`, text: "The game and its history are removed. This can't be undone.", ok: "Delete", danger: true })) { await sky.games.remove(id); refresh(); toast("Deleted"); } }, "danger"]]);
    }
    const lc = e.target.closest("[data-lib]");
    if (lc) {
      const it = G.library.find(x => x.id === lc.dataset.lib), b = e.target.closest("[data-act]"); if (!it || !b) return;
      if (b.dataset.act === "play") return playLib(it);
      if (b.dataset.act === "remove") { await sky.games.libRemove(it.id); refresh(); toast(`Removed ${it.name}`); }
      if (b.dataset.act === "libmenu") return menu(b, [[it.kind === "web" ? "↗ Open" : "▶ Play", () => playLib(it)],
        ["🖼 Change picture…", async () => { try { const r = await sky.games.setArt(it.id, "pick"); if (r) { toast("Picture changed"); refresh(); } } catch (er) { toast(er.message, true); } }],
        ...(it.kind === "local" ? [["✨ Find the real cover again", async () => { toast(`Looking for ${it.name}'s cover…`); await sky.games.setArt(it.id, "reset").catch(() => {}); refresh(); }]] : []),
        ["✎ Rename", async () => { const n = await dialog({ title: "Rename", input: it.name, ok: "Rename" }); if (n) { await sky.games.rename(it.id, n); refresh(); } }],
        null, ["✕ Remove from library", async () => { await sky.games.libRemove(it.id); refresh(); toast(`Removed ${it.name}`); }, "danger"]]);
    }
    const fc = e.target.closest("[data-found]");
    if (fc) {
      const r = G.found[+fc.dataset.found], b = e.target.closest("[data-act]"); if (!r || !b) return;
      if (b.dataset.act === "open") return openExternal(r.url);
      if (b.dataset.act === "add") { await sky.games.libAdd([r]); await refresh(); $("#gFound .g-grid").outerHTML = `<div class="g-grid">${G.found.map(foundCard).join("")}</div>`; toast(`Added ${r.name} to your library`); }
    }
  });
  page.addEventListener("input", e => {
    if (e.target.id === "gbIdea") store.local("idea", e.target.value);
    if (e.target.id === "gbCustom") G.opts.custom = e.target.value;
  });
  $("#gSearch").addEventListener("input", debounce(renderResults, 120));
  $("#gSearch").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.value.trim()) { findGames(e.target.value.trim()); $("#gFindSec").scrollIntoView({ behavior: "smooth" }); } if (e.key === "Escape") { e.target.value = ""; renderResults(); } });
  $("#gFindForm").addEventListener("submit", e => { e.preventDefault(); const q = $("#gFindQ").value.trim(); if (q) findGames(q); });
  $("#gSrc").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; setSeg($("#gSrc"), b.dataset.v); const q = $("#gFindQ").value.trim(); if (q) findGames(q); });
  $("#gAddLocal").onclick = async () => { const a = await sky.games.pickLocal(); if (a.length) { toast(`Added ${a.length} game${a.length > 1 ? "s" : ""}`); refresh(); } };
  $("#gScan").onclick = scanPC;
  sky.games.onProgress(p => { if (G.job && p.jobId === G.job.jobId) { if (p.stage === undefined) delete p.stage; Object.assign(G.job, p); if (p.stage) G.job.phase = "thinking"; if (G.job.mode === "create") renderBuilder(); else renderChatProgress(); } });
  stageEvents();
}
function renderBuilderKeep() {   // re-render the options without losing what's typed
  const idea = $("#gbIdea")?.value; renderBuilder(); if (idea != null) $("#gbIdea").value = idea;
}

let go = () => {};
export const Games = {
  async init(goFn) {
    if (!sky) return;
    go = goFn;
    G.ai = await sky.ai.status().catch(() => ({ configured: false }));
    events(); renderBuilder(); renderMine(); renderLib();
    await refresh();
    sky.games.onLibChanged(it => { if (!it) return; const i = G.library.findIndex(x => x.id === it.id); if (i >= 0) { G.library[i] = it; const card = $(`[data-lib="${it.id}"]`); if (card) card.outerHTML = libCard(it); } });
    const missing = G.library.filter(x => x.kind === "local" && !x.artOwn && (!x.artTried || x.artV !== 2 || (!x.art && !x.logo))).map(x => x.id);
    if (missing.length) sky.games.art(missing);   // real covers for games added before Skyline could find them
  },
  async show() { if (!sky) return; G.ai = await sky.ai.status().catch(() => G.ai); if (!G.job) renderBuilder(); refresh(); },
  staging: () => !!G.stage,
  aiChanged(st) { G.ai = st; if (!G.job) renderBuilder(); },
  search() { go("games"); setTimeout(() => $("#gSearch").focus(), 30); },
  // for the command bar: everything you can play
  items: () => G.projects.map(p => ({ kind: "made", id: p.id, name: p.name || "My game" })).concat(G.library.map(x => ({ kind: x.kind, id: x.id, name: x.name }))),
  play(kind, id) { if (kind === "made") { go("games"); return openStage(id, "play"); } const it = G.library.find(x => x.id === id); if (it) return playLib(it); },
};
