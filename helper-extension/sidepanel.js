// The side panel: the question on the page, a hint and the method first, your answer checked, the full solution
// after you've tried, practice questions and your progress. The AI work is done by Skyline on this PC.
const PORTS = [47811, 47812, 47813, 47814, 47815];
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const L = i => String.fromCharCode(65 + i);
const S = { tab: "help", q: null, edit: false, text: "", hint: null, check: null, solution: null, attempt: "", chat: [], busy: {}, err: "", supported: true,
  practice: { skill: "", diff: 2, items: [], i: 0, picked: null, typed: "", result: null }, progress: null, port: 0, code: "", short: false, paused: false };

/* ---------- talking to Skyline ---------- */
async function api(path, body) {
  const tries = S.port ? [S.port, ...PORTS.filter(p => p !== S.port)] : PORTS;
  let lastErr = "Skyline isn't running. Open Skyline on this PC, then press ↻.", refused = false;
  for (const port of tries) {
    let r;
    try { r = await fetch(`http://127.0.0.1:${port}/api/${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "X-Sky-Code": S.code }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { continue; }   // nothing on this port
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 401) { refused = true; continue; }   // another Skyline (or an old code) on this port: try the next one
    S.port = port; chrome.storage.local.set({ port });
    if (!r.ok) throw new Error(j.error || `Skyline answered ${r.status}`);
    return j;
  }
  if (refused) { const e = new Error("Pair the helper with Skyline: open ⚙ Settings and enter the code from Skyline (Sky page › Study Helper)."); e.pair = true; throw e; }
  throw new Error(lastErr);
}
function status(msg, err) { const b = $("#status"); b.textContent = msg || ""; b.classList.toggle("hidden", !msg); b.classList.toggle("err", !!err); }
async function job(key, fn) {
  if (S.busy[key]) return;
  S.busy[key] = true; S.err = ""; render();
  try { await fn(); status(""); }
  catch (e) { status(e.message, true); if (e.pair) openSettings(); }
  finally { S.busy[key] = false; render(); }
}

/* ---------- the question ---------- */
const question = () => (S.edit || !S.q ? S.text : S.q.question) || "";
const qBody = () => ({ question: question(), choices: S.q ? S.q.choices : [], subject: S.hint ? S.hint.subject : "" , short: S.short });
function setQuestion(q) {
  if (!q || S.paused) return;
  if (S.q && q.sig === S.q.sig) { S.q = q; return; }
  S.q = q; S.text = q.question; S.edit = false; S.hint = null; S.check = null; S.solution = null; S.attempt = ""; S.chat = [];
  if (S.tab === "help") render();
  auto();
}
// a new question: read it from the screen if the page text is garbled, then get the hint, all by itself
let autoSig = "";
async function auto() {
  const q = S.q; if (!q || S.paused || !S.code || q.sig === autoSig) return;
  autoSig = q.sig;
  if (q.needsScreen && !q.fromScreen && S.supported) { await readScreen(); if (S.q !== q && S.q && S.q.fromScreen) autoSig = S.q.sig; }
  if (!S.hint && !S.busy.hint) getHint();
}
async function loadCurrent() {
  const r = await chrome.runtime.sendMessage({ type: "current" }).catch(() => null);
  S.supported = !!(r && r.supported);
  if (r && r.q) setQuestion(r.q); else render();
}
// read the question from a screenshot (math drawn as pictures, graphs, pages where the text can't be read)
async function readScreen() {
  await job("read", async () => {
    const shot = await chrome.runtime.sendMessage({ type: "screenshot" });
    if (!shot || shot.error) throw new Error((shot && shot.error) || "Couldn't take a screenshot");
    const image = S.q && S.q.rect && S.q.rect.w > 50 && !S.q.frame ? await crop(shot.image, S.q.rect) : shot.image;   // (a question inside a frame: the whole screen)
    const r = await api("read", { image });
    if (!r.found) throw new Error("Sky couldn't find a question in the screenshot. Scroll so the question is visible and try again.");
    const sig = "screen|" + r.question.slice(0, 200);
    S.q = { ...(S.q || {}), site: (S.q && S.q.site) || "Screen", question: r.question, choices: r.choices, sig, fromScreen: true, needsScreen: false };
    S.text = r.question; S.edit = false; S.hint = null; S.check = null; S.solution = null; S.attempt = ""; S.chat = [];
  });
}
async function crop(dataUrl, r) {   // just the question area (with a margin); the screenshot is in device pixels
  const bin = atob(dataUrl.split(",")[1]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const img = await createImageBitmap(new Blob([u8], { type: dataUrl.slice(5, dataUrl.indexOf(";")) }));
  const s = r.dpr || 1, pad = 16 * s;
  const x = Math.max(0, r.x * s - pad), y = Math.max(0, r.y * s - pad), w = Math.min(img.width - x, r.w * s + pad * 2), h = Math.min(img.height - y, r.h * s + pad * 2);
  if (w < 40 || h < 30) return dataUrl;
  const c = new OffscreenCanvas(w, h); c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
  const blob = await c.convertToBlob({ type: "image/png" });
  return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(blob); });
}

/* ---------- help: hint -> check -> solution ---------- */
const getHint = () => job("hint", async () => { S.hint = await api("hint", qBody()); });
const check = () => job("check", async () => {
  const answer = S.attempt.trim(); if (!answer) throw new Error("Type your answer first (or pick a choice), then press Check");
  // the check and the full solution together, so the right answer shows up as soon as you've tried
  S.solution = null;
  const sol = api("solve", { ...qBody(), attempt: answer }).then(r => { S.solution = r; render(); }).catch(e => status(e.message, true));
  S.check = await api("check", { ...qBody(), answer });
  render(); await sol;
  api("progress", { skill: (S.hint && S.hint.skill) || (S.q && S.q.skill) || "General", correct: S.check.correct, source: "site" }).then(p => S.progress = p).catch(() => {});
});
const solve = () => job("solve", async () => { S.solution = await api("solve", { ...qBody(), attempt: S.attempt.trim() }); });
const ask = text => job("ask", async () => { S.chat.push({ me: true, t: text }); render(); const r = await api("ask", { ...qBody(), ask: text, attempted: !!S.check }); S.chat.push({ me: false, t: r.reply }); });

/* ---------- practice ---------- */
const norm = s => String(s || "").toLowerCase().replace(/^\(?[a-d]\)\s*/, "").replace(/[\s$,]/g, "").replace(/^x=/, "").replace(/\.0+$/, "");
const genPractice = () => job("practice", async () => {
  const P = S.practice, skill = P.skill.trim() || (S.hint && S.hint.skill) || (S.q && S.q.skill); if (!skill) throw new Error("Type a skill to practise (e.g. “solve two-step equations”)");
  P.skill = skill; const r = await api("practice", { skill, difficulty: P.diff, count: 5, sample: question().slice(0, 500) });
  P.items = r.questions; P.i = 0; P.picked = null; P.typed = ""; P.result = null;
});
async function answerPractice(given) {
  const P = S.practice, it = P.items[P.i]; if (!it || P.result) return;
  let ok = norm(given) === norm(it.answer);
  if (!ok && !it.choices.length) {   // "0.5" vs "1/2": let Sky judge equivalent answers
    S.busy.pcheck = true; render();
    try { const c = await api("check", { question: it.q, choices: [], answer: given, expected: it.answer }); ok = c.correct === true; } catch (e) {}
    S.busy.pcheck = false;
  }
  P.result = { ok, given };
  api("progress", { skill: P.skill, correct: ok, source: "practice" }).then(p => S.progress = p).catch(() => {});
  render();
}

/* ---------- drawing ---------- */
const loading = t => `<div class="card"><div class="load"><span class="spin"></span>${esc(t)}</div><div class="shimmer"></div><div class="shimmer" style="width:70%"></div></div>`;
function renderHelp() {
  const q = S.q;
  if (!q && !S.edit) return `<div class="empty"><span class="big">📚</span><b>${S.supported ? "Looking for a question…" : "Open IXL or Sadlier"}</b><span>${S.supported ? "If nothing shows up, press ↻ or 📷 Read from screen." : "The helper reads the question on IXL or Sadlier Connect. You can also type or paste a question."}</span>
    <div class="row">${S.supported ? `<button class="btn" data-a="screen">📷 Read from screen</button>` : ""}<button class="btn" data-a="type">✎ Type a question</button></div></div>`;
  let h = `<div class="card"><div class="kick">${esc(q ? q.site : "Your question")}${q && (q.skill || (S.hint && S.hint.skill)) ? `<span class="badge">${esc((S.hint && S.hint.skill) || q.skill)}</span>` : ""}<span class="sp"></span>${q && q.fromScreen ? "read from screen" : ""}</div>
    ${S.edit ? `<textarea class="qedit" id="qedit" placeholder="Type or paste the question">${esc(S.text)}</textarea>` : `<div class="qtext">${esc(question())}</div>`}
    ${q && q.choices && q.choices.length && !S.edit ? `<ul class="choices">${q.choices.map((c, i) => `<li><b>${L(i)}</b>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${q && q.needsScreen && !S.edit ? `<div class="status" style="margin:0">Part of this question is drawn as a picture (math symbols or a graph). Use 📷 Read from screen for an exact copy.</div>` : ""}
    <div class="row">${S.supported ? `<button class="btn sm" data-a="screen" ${S.busy.read ? "disabled" : ""}>${S.busy.read ? "Reading…" : "📷 Read from screen"}</button>` : ""}<button class="btn sm" data-a="${S.edit ? "done" : "type"}">${S.edit ? "✓ Use this text" : "✎ Fix the text"}</button></div></div>`;
  if (S.busy.read) return h + loading("Reading the question from your screen…");
  // 1. hint + method + a worked example (never this question's answer)
  if (!S.hint && !S.busy.hint) h += `<button class="btn primary" data-a="hint">💡 Get a hint</button>`;
  if (S.busy.hint) h += loading("Sky is working out the method…");
  if (S.hint) h += `<details class="card" open><summary>💡 Hint</summary><div>${esc(S.hint.hint)}</div>
      ${S.hint.ambiguous || S.hint.note ? `<div class="status" style="margin:0">${esc(S.hint.note || "This question might be missing information (like a picture). Try 📷 Read from screen.")}</div>` : ""}</details>
    ${S.hint.method.length ? `<details class="card" ${S.short ? "" : "open"}><summary>🧭 The method</summary><ol class="steps">${S.hint.method.map(s => `<li>${esc(s)}</li>`).join("")}</ol></details>` : ""}
    ${S.hint.example && S.hint.example.problem ? `<details class="card" ${S.short ? "" : "open"}><summary>✏️ A similar example</summary><div class="ex"><b>${esc(S.hint.example.problem)}</b><ol class="steps">${S.hint.example.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol><div>Answer: <b>${esc(S.hint.example.answer)}</b></div></div></details>` : ""}`;
  // 2. your answer, checked
  const chips = q && q.choices && q.choices.length ? `<div class="row">${q.choices.map((c, i) => `<button class="btn sm" data-pick="${i}" title="${esc(c)}">${L(i)}</button>`).join("")}</div>` : "";
  h += `<div class="card"><div class="kick">✍️ Your answer</div>${chips}<div class="row"><input id="attempt" placeholder="Type your answer" value="${esc(S.attempt)}" autocomplete="off"><button class="btn primary" data-a="check" ${S.busy.check ? "disabled" : ""}>${S.busy.check ? "Checking…" : "Check"}</button></div>
    ${S.check ? `<div class="result ${S.check.correct === true ? "ok" : S.check.correct === false ? "bad" : "unsure"}"><b>${S.check.correct === true ? "✓ Correct!" : S.check.correct === false ? "✗ Not quite" : "🤔 Not sure"}</b><span>${esc(S.check.feedback)}</span>${S.check.mistake ? `<span class="muted">${esc(S.check.mistake)}</span>` : ""}</div>` : ""}</div>`;
  // 3. the full solution, after trying
  if (S.check && !S.solution) h += loading("Sky is writing out the full solution…");
  else if (!S.check) h += `<p class="muted small">📖 Type your answer and press Enter: the full solution with the right answer shows up below.</p>`;
  if (S.busy.solve) h += loading("Sky is writing out every step…");
  if (S.solution) h += `<details class="card" open><summary>📖 Full solution</summary><ol class="steps">${S.solution.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol><div class="answer-row"><div class="answer">${esc(S.solution.answer)}</div><button class="btn sm" data-copyans="1" title="Copy the answer">📋 Copy</button></div>${S.solution.note ? `<div class="muted small">${esc(S.solution.note)}</div>` : ""}</details>`;
  // follow-up questions
  h += `<div class="card"><div class="kick">💬 Ask Sky</div><div class="chat">${S.chat.map(m => `<div class="msg ${m.me ? "me" : ""}">${esc(m.t)}</div>`).join("")}${S.busy.ask ? `<div class="load"><span class="spin"></span>Thinking…</div>` : ""}</div>
    <form class="row" id="askForm"><input id="askIn" placeholder="e.g. Why do we flip the sign?" autocomplete="off"><button class="btn sm">Ask</button></form></div>`;
  return h;
}
function renderPractice() {
  const P = S.practice, it = P.items[P.i];
  let h = `<div class="card"><div class="kick">🎯 Practice a skill</div><input id="pskill" placeholder="Skill, e.g. “Pythagorean theorem”" value="${esc(P.skill || (S.hint && S.hint.skill) || (S.q && S.q.skill) || "")}">
    <div class="row"><div class="seg">${[[1, "Easy"], [2, "Medium"], [3, "Hard"]].map(([v, n]) => `<button data-diff="${v}" class="${P.diff === v ? "on" : ""}">${n}</button>`).join("")}</div><span class="sp"></span><button class="btn primary" data-a="gen" ${S.busy.practice ? "disabled" : ""}>${S.busy.practice ? "Making…" : P.items.length ? "New set" : "Start"}</button></div>
    ${S.progress && S.progress.weak.length ? `<div class="muted small">Needs work: ${S.progress.weak.slice(0, 4).map(w => `<a href="#" data-skill="${esc(w.name)}">${esc(w.name)}</a>`).join(", ")}</div>` : ""}</div>`;
  if (S.busy.practice) return h + loading("Making practice questions…");
  if (!it) return h + (P.items.length ? `<div class="card"><b>🎉 Set done!</b><span class="muted">Press “New set” for more.</span></div>` : "");
  h += `<div class="card"><div class="kick">Question ${P.i + 1} of ${P.items.length}</div><div class="qtext">${esc(it.q)}</div>`;
  if (it.choices.length) h += `<div class="opts">${it.choices.map((c, i) => `<button class="opt ${P.result ? (norm(c) === norm(it.answer) ? "right" : P.result.given === c ? "wrong" : "") : ""}" data-popt="${i}" ${P.result ? "disabled" : ""}>${L(i)}. ${esc(c)}</button>`).join("")}</div>`;
  else h += `<div class="row"><input id="ptyped" placeholder="Your answer" value="${esc(P.typed)}" ${P.result ? "disabled" : ""} autocomplete="off"><button class="btn primary" data-a="pcheck" ${P.result || S.busy.pcheck ? "disabled" : ""}>${S.busy.pcheck ? "…" : "Check"}</button></div>`;
  if (P.result) h += `<div class="result ${P.result.ok ? "ok" : "bad"}"><b>${P.result.ok ? "✓ Correct!" : "✗ The answer is " + esc(it.answer)}</b></div><details class="card" ${P.result.ok ? "" : "open"}><summary>How to solve it</summary><ol class="steps">${it.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></details><button class="btn primary" data-a="pnext">Next →</button>`;
  return h + `</div>`;
}
function renderProgress() {
  const p = S.progress;
  if (!p) return loading("Loading your progress…");
  if (!p.skills.length) return `<div class="empty"><span class="big">📈</span><b>No progress yet</b><span>Check answers and do practice sets: your skills show up here, with the ones that need work at the top.</span></div>`;
  const row = s => `<div class="skill ${s.tries >= 2 && s.pct < 70 ? "weak" : ""}"><div class="row"><b>${esc(s.name)}</b><span class="sp"></span><span class="muted small">${s.right}/${s.tries} · ${s.pct}%</span><button class="btn sm" data-skill="${esc(s.name)}">Practice</button></div><div class="bar"><i style="width:${s.pct}%"></i></div></div>`;
  return `${p.weak.length ? `<div class="card"><div class="kick">⚠️ Needs work</div>${p.weak.map(row).join("")}</div>` : ""}<div class="card"><div class="kick">All skills · ${p.total} answers</div>${p.skills.map(row).join("")}</div>`;
}
function render() {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  $("#pause").classList.toggle("on", S.paused); $("#pause").title = S.paused ? "Detection paused: click to resume" : "Pause question detection";
  const keep = document.activeElement && document.activeElement.id, val = keep && $("#" + keep) ? $("#" + keep).value : null;
  $("#view").innerHTML = S.tab === "help" ? renderHelp() : S.tab === "practice" ? renderPractice() : renderProgress();
  if (keep && $("#" + keep)) { const el = $("#" + keep); if (val != null) el.value = val; el.focus(); }
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const t = e.target, a = t.closest("[data-a]") && t.closest("[data-a]").dataset.a;
  const tab = t.closest("[data-tab]"); if (tab) { S.tab = tab.dataset.tab; if (S.tab === "progress") api("progress").then(p => { S.progress = p; render(); }).catch(er => status(er.message, true)); return render(); }
  const pick = t.closest("[data-pick]"); if (pick) { S.attempt = L(+pick.dataset.pick) + ") " + S.q.choices[+pick.dataset.pick]; return render(); }
  const sk = t.closest("[data-skill]"); if (sk) { e.preventDefault(); S.tab = "practice"; S.practice.skill = sk.dataset.skill; S.practice.items = []; render(); return genPractice(); }
  const df = t.closest("[data-diff]"); if (df) { S.practice.diff = +df.dataset.diff; return render(); }
  const po = t.closest("[data-popt]"); if (po) { const it = S.practice.items[S.practice.i]; return answerPractice(it.choices[+po.dataset.popt]); }
  if (a === "hint") getHint();
  if (a === "check") { S.attempt = $("#attempt").value; check(); }
  if (a === "solve") solve();
  if (t.closest("[data-copyans]") && S.solution) navigator.clipboard.writeText(S.solution.answer).then(() => status("📋 Answer copied")).catch(() => status("Couldn't copy", true));
  if (a === "screen") readScreen();
  if (a === "type") { S.edit = true; S.text = question(); render(); setTimeout(() => $("#qedit") && $("#qedit").focus(), 20); }
  if (a === "done") { S.text = $("#qedit").value.trim(); S.edit = false; if (S.text) { S.q = { ...(S.q || { site: "Typed", choices: [] }), question: S.text, sig: "typed|" + S.text.slice(0, 200), needsScreen: false }; S.hint = null; S.check = null; S.solution = null; S.chat = []; } render(); }
  if (a === "gen") { S.practice.skill = $("#pskill").value; genPractice(); }
  if (a === "pcheck") { S.practice.typed = $("#ptyped").value; if (S.practice.typed.trim()) answerPractice(S.practice.typed.trim()); }
  if (a === "pnext") { const P = S.practice; P.i++; P.result = null; P.typed = ""; render(); }
});
document.addEventListener("input", e => { if (e.target.id === "attempt") S.attempt = e.target.value; if (e.target.id === "qedit") S.text = e.target.value; if (e.target.id === "pskill") S.practice.skill = e.target.value; });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "attempt") { S.attempt = e.target.value; check(); } if (e.key === "Enter" && e.target.id === "ptyped") $("[data-a=pcheck]") && $("[data-a=pcheck]").click(); });
document.addEventListener("submit", e => { e.preventDefault(); if (e.target.id === "askForm") { const v = $("#askIn").value.trim(); if (v) ask(v); } });
$("#refresh").onclick = async () => { status(""); await chrome.runtime.sendMessage({ type: "rescan" }).catch(() => {}); setTimeout(loadCurrent, 900); ping(); };
$("#pause").onclick = () => { S.paused = !S.paused; chrome.storage.local.set({ paused: S.paused }); render(); };
function openSettings() { $("#settings").classList.remove("hidden"); $("#code").value = S.code; $("#theme").value = document.body.dataset.theme; $("#short").checked = S.short; }
$("#gear").onclick = openSettings;
$("#closeSettings").onclick = () => $("#settings").classList.add("hidden");
$("#theme").onchange = () => { document.body.dataset.theme = $("#theme").value; chrome.storage.local.set({ theme: $("#theme").value }); };
$("#short").onchange = () => { S.short = $("#short").checked; chrome.storage.local.set({ short: S.short }); render(); };
$("#pair").onclick = async () => {
  S.code = $("#code").value.trim().toUpperCase(); chrome.storage.local.set({ code: S.code });
  $("#pairNote").textContent = "Connecting…";
  try { const st = await api("status"); $("#pairNote").textContent = st.ai ? "✓ Connected to Skyline" : "✓ Connected, but Skyline has no AI yet: sign in to Claude on Skyline's AI page"; S.progress = st.progress; status(""); autoSig = ""; auto(); }
  catch (e) { $("#pairNote").textContent = e.message; }
};
async function ping() {
  try { const st = await api("status"); S.progress = st.progress; if (!st.ai) status("Skyline is connected, but it has no AI yet: sign in to Claude on Skyline's Sky page (or add a Claude key in Settings › AI).", true); }
  catch (e) { status(e.message, true); }
}

chrome.runtime.onMessage.addListener(m => { if (m.type === "question") chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { if (tab && m.q.tabId === tab.id) setQuestion(m.q); }); });
chrome.tabs.onActivated.addListener(() => { S.q = null; loadCurrent(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "complete") loadCurrent(); });
chrome.storage.local.get({ code: "", port: 0, theme: "night", short: false, paused: false }).then(v => {
  S.code = v.code; S.port = v.port; S.short = v.short; S.paused = v.paused; document.body.dataset.theme = v.theme;
  render(); loadCurrent();
  if (!S.code) { status("First, pair with Skyline: open ⚙ Settings and enter the code shown in Skyline (Sky page › Study Helper)."); openSettings(); } else ping();
});
