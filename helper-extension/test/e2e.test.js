// End-to-end test of the Study Helper: Skyline's helper server (with the real Study AI code) and the real side panel.
// Needs a Claude to talk to; for tests, a stand-in:  set SKYLINE_TEST_CLAUDE=path\to\fake\claude.cmd
// Run from the Skyline folder:  npx electron helper-extension/test/e2e.test.js
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, "..", "..");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "sh-test-")));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, name) => { console.log(`${c ? "PASS" : "FAIL"}  ${name}`); c ? pass++ : fail++; };
function req(port, p, { method = "GET", headers = {}, body } = {}) {
  return new Promise(res => { const r = http.request({ host: "127.0.0.1", port, path: p, method, headers: { "Content-Type": "application/json", ...headers } }, x => { let b = ""; x.on("data", d => b += d); x.on("end", () => { let j = {}; try { j = JSON.parse(b); } catch (e) {} res({ status: x.statusCode, j }); }); }); r.on("error", e => res({ status: 0, j: { error: e.message } })); if (body) r.end(JSON.stringify(body)); else r.end(); });
}
ipcMain.handle("test:http", async (e, url, method, headers, body) => {   // the panel's requests, made from Node
  const u = new URL(url); return new Promise(res => { const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, x => { let b = ""; x.on("data", d => b += d); x.on("end", () => res({ status: x.statusCode, body: b })); }); r.on("error", () => res({ status: 0, body: "" })); if (body) r.end(body); else r.end(); }).then(r => { if (!r.status) throw new Error("offline"); return r; });
});
app.whenReady().then(async () => {
  const { Study } = require(path.join(ROOT, "main", "study"));
  const { Brain } = require(path.join(ROOT, "main", "brain"));
  const { StudyHelper } = require(path.join(ROOT, "main", "studyhelper"));
  const study = new Study({ ai: { key: () => ({}) }, brain: new Brain() });
  const sh = new StudyHelper(app.getPath("userData"), study); sh.install();
  await sleep(500);
  const port = sh.port, code = sh.data.token, H = { "X-Sky-Code": code };
  ok(port >= 47811 && port <= 47815, `server listens on 127.0.0.1:${port}`);

  // ---- the server ----
  ok((await req(port, "/api/status")).status === 401, "no pairing code: refused");
  ok((await req(port, "/api/status", { headers: { ...H, Origin: "https://evil.example.com" } })).status === 403, "a web page can't use it, even with the code");
  const st = await req(port, "/api/status", { headers: { ...H, Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" } });
  ok(st.status === 200 && st.j.ai === "claude", "the extension (with the code) is let in, AI ready: " + st.j.ai);
  const Q = { question: "Solve for x: 3x + 4 = -11", choices: [] };
  const hint = await req(port, "/api/hint", { method: "POST", headers: H, body: Q });
  ok(hint.status === 200 && hint.j.skill && hint.j.hint && hint.j.method.length >= 2 && hint.j.example && hint.j.example.answer, "hint: skill, hint, method, worked example");
  ok(!/-5/.test(JSON.stringify(hint.j)), "hint doesn't contain this question's answer");
  ok((await req(port, "/api/solve", { method: "POST", headers: H, body: Q })).status === 400, "full solution is locked until you've tried");
  const wrong = await req(port, "/api/check", { method: "POST", headers: H, body: { ...Q, answer: "x = -2" } });
  ok(wrong.status === 200 && wrong.j.correct === false && wrong.j.mistake, "check: a wrong answer is marked wrong, with the mistake");
  const right = await req(port, "/api/check", { method: "POST", headers: H, body: { ...Q, answer: "x = -5" } });
  ok(right.j.correct === true, "check: the right answer is marked right");
  const sol = await req(port, "/api/solve", { method: "POST", headers: H, body: { ...Q, attempt: "x = -2" } });
  ok(sol.status === 200 && sol.j.steps.length >= 3 && /-5/.test(sol.j.answer), "full solution after an attempt (JSON after other text is still read)");
  const pr = await req(port, "/api/practice", { method: "POST", headers: H, body: { skill: "Two-step equations", difficulty: 2, count: 3 } });
  ok(pr.status === 200 && pr.j.questions.length === 3 && pr.j.questions.every(q => q.q && q.answer), "practice: 3 questions with answers");
  const rd = await req(port, "/api/read", { method: "POST", headers: H, body: { image: "data:image/png;base64,iVBORw0KGgo=" } });
  ok(rd.status === 200 && rd.j.found && /3x \+ 4/.test(rd.j.question), "read from screen: the screenshot is sent and the question comes back");
  ok((await req(port, "/api/read", { method: "POST", headers: H, body: {} })).status === 400, "read without a screenshot: clear error");
  const askR = await req(port, "/api/ask", { method: "POST", headers: H, body: { ...Q, ask: "why subtract 4?", attempted: false } });
  ok(askR.j.reply && /No spoilers/.test(askR.j.reply), "follow-up question answered (no spoilers before trying)");
  await req(port, "/api/progress", { method: "POST", headers: H, body: { skill: "Two-step equations", correct: true } });
  await req(port, "/api/progress", { method: "POST", headers: H, body: { skill: "Two-step equations", correct: false } });
  await req(port, "/api/progress", { method: "POST", headers: H, body: { skill: "Two-step equations", correct: false } });
  const pg = await req(port, "/api/progress", { headers: H });
  ok(pg.j.skills[0].tries === 3 && pg.j.weak.length === 1 && fs.existsSync(path.join(app.getPath("userData"), "studyhelper.json")), "progress is saved and weak skills are found");

  // ---- the side panel ----
  const w = new BrowserWindow({ show: false, width: 420, height: 900, webPreferences: { preload: path.join(__dirname, "panel-preload.js"), contextIsolation: false, sandbox: false } });
  await w.loadFile(path.join(__dirname, "..", "sidepanel.html"));
  const js = s => w.webContents.executeJavaScript(s);
  const shot = async n => fs.writeFileSync(path.join(os.tmpdir(), "sh-" + n + ".png"), (await w.webContents.capturePage()).toPNG());
  await sleep(600);
  ok(await js(`!document.querySelector("#settings").classList.contains("hidden")`), "panel: asks to pair first (settings open)");
  await js(`document.querySelector("#code").value = ${JSON.stringify(code)}; document.querySelector("#pair").click()`); await sleep(1500); console.log("pairNote:", await js(`document.querySelector("#pairNote").textContent + " / status: " + document.querySelector("#status").textContent`));
  ok(/Connected/.test(await js(`document.querySelector("#pairNote").textContent`)), "panel: pairs with the code");
  await js(`document.querySelector("#closeSettings").click()`); await sleep(9000);
  // automatic: the garbled question (a drawn minus sign) is read from the screen, then the hint arrives, with no clicks
  ok(await js(`/3x \\+ 4 = -11/.test(document.querySelector(".qtext").textContent) && /read from screen/i.test(document.querySelector("#view").innerText)`), "auto: garbled question read from the screen by itself");
  ok(await js(`/Undo the \\+ 4/.test(document.querySelector("#view").innerText) && /similar example/i.test(document.querySelector("#view").innerText)`), "auto: hint, method and example arrive by themselves");
  ok(await js(`!document.querySelector(".answer")`), "the answer isn't shown before you try");
  await js(`const a = document.querySelector("#attempt"); a.value = "x = -2"; a.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-a=check]").click()`); await sleep(7000);
  ok(await js(`/Not quite/.test(document.querySelector(".result").innerText)`), "check: wrong answer marked wrong");
  ok(await js(`/x = -5/.test(document.querySelector(".answer").innerText) && !!document.querySelector("[data-copyans]")`), "check also brings the full solution, with a copy button"); await shot("help");
  await js(`document.querySelector("#askIn").value = "why subtract 4?"; document.querySelector("#askForm").requestSubmit()`); await sleep(4000);
  ok(await js(`document.querySelectorAll(".msg").length === 2`), "panel: follow-up chat");
  await js(`__push({ site: "IXL", question: "Compare: -12 ? -7", choices: [">", "<", "="], sig: "t2" })`); await sleep(300);
  ok(await js(`/-12 \\? -7/.test(document.querySelector(".qtext").textContent) && !document.querySelector(".result")`), "panel: next question replaces the old one (fresh start)");
  await sleep(4500); ok(await js(`/Undo the/.test(document.querySelector("#view").innerText)`), "auto: the next question gets its hint by itself");
  await js(`document.querySelector("#pause").click()`); await sleep(200);
  await js(`__push({ site: "IXL", question: "Should be ignored while paused", choices: [], sig: "t3" })`); await sleep(300);
  ok(await js(`!/ignored/.test(document.querySelector(".qtext").textContent) && __store.paused === true`), "panel: pause stops updates");
  await js(`document.querySelector("#pause").click()`);
  await js(`document.querySelector("[data-a=screen]").click()`); await sleep(4500);
  ok(await js(`/3x \\+ 4 = -11/.test(document.querySelector(".qtext").textContent)`), "panel: read from screen (button) replaces the question");
  // practice
  await js(`document.querySelector("[data-tab=practice]").click()`); await sleep(200);
  await js(`document.querySelector("#pskill").value = "Two-step equations"; document.querySelector("[data-a=gen]").click()`); await sleep(4500);
  ok(await js(`/Question 1 of 3/i.test(document.querySelector("#view").innerText)`), "practice: a set of questions");
  await js(`document.querySelector("#ptyped").value = "4"; document.querySelector("[data-a=pcheck]").click()`); await sleep(500);
  ok(await js(`/Correct/.test(document.querySelector(".result").innerText)`), "practice: typed answer checked");
  await js(`document.querySelector("[data-a=pnext]").click()`); await sleep(200);
  await js(`[...document.querySelectorAll("[data-popt]")].find(b => /5$/.test(b.textContent.trim())).click()`); await sleep(500);
  ok(await js(`!!document.querySelector(".opt.right") && /Correct/.test(document.querySelector(".result").innerText)`), "practice: multiple choice checked");
  await js(`document.querySelector("[data-a=pnext]").click()`); await sleep(200);
  await js(`document.querySelector("#ptyped").value = "1/2"; document.querySelector("[data-a=pcheck]").click()`); await sleep(4500);
  ok(await js(`/Correct/.test(document.querySelector(".result").innerText)`), "practice: equivalent answer (1/2 = 0.5) accepted by Sky"); await shot("practice");
  // progress
  await js(`document.querySelector("[data-tab=progress]").click()`); await sleep(1500);
  ok(await js(`/Two-step equations/.test(document.querySelector("#view").innerText) && /Needs work/i.test(document.querySelector("#view").innerText)`), "progress: skills and what needs work"); await shot("progress");
  // themes
  await js(`document.querySelector("#theme").value = "light"; document.querySelector("#theme").dispatchEvent(new Event("change"))`);
  ok(await js(`document.body.dataset.theme === "light" && __store.theme === "light"`), "settings: theme changes and is saved");
  // Skyline not running
  sh.srv.close(); await sleep(300);
  await js(`document.querySelector("[data-tab=help]").click(); document.querySelector("[data-a=hint]") && document.querySelector("[data-a=hint]").click()`); await sleep(1500);
  ok(await js(`/Skyline isn't running|Pair the helper/.test(document.querySelector("#status").textContent)`), "clear error when Skyline isn't running");
  console.log(`\n${pass} passed, ${fail} failed  (screenshots: ${path.join(os.tmpdir(), "sh-*.png")})`);
  app.exit(fail ? 1 : 0);
});
