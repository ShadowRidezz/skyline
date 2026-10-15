// Question extraction tests. Run:  npx electron helper-extension/test/extract.test.js   (from the Skyline folder)
// Loads each saved page in a hidden window, runs extract.js on it and checks what it found.
const { app, BrowserWindow } = require("electron");
const fs = require("fs"), path = require("path");
const DIR = __dirname, EXTRACT = fs.readFileSync(path.join(DIR, "..", "extract.js"), "utf8");
const cases = [
  { file: "ixl-choice.html", host: "www.ixl.com", check: q => [
    [q && q.site === "IXL", "site is IXL"],
    [q && q.skill === "Compare and order integers", "skill name from the breadcrumb"],
    [q && /Compare the numbers/.test(q.question) && /-12/.test(q.question) && /-7/.test(q.question), "question text with -12 and -7"],
    [q && !/-1 \? 5|number line, -1/.test(q.question), "ignores the hidden example question"],
    [q && JSON.stringify(q.choices) === JSON.stringify([">", "<", "="]), "three choices > < = (got " + JSON.stringify(q && q.choices) + ")"],
    [q && q.kind === "multiple-choice", "kind multiple-choice"],
    [q && !/SECRET|search text/.test(JSON.stringify(q)), "never reads passwords or typed text"],
    [q && !/Submit/.test(q.question), "drops the Submit button"],
  ] },
  { file: "ixl-fill.html", host: "www.ixl.com", check: q => [
    [q && /Solve for x/.test(q.question) && /3 ?x \+ 4 =/.test(q.question), "equation text (" + JSON.stringify(q && q.question) + ")"],
    [q && q.kind === "fill-in" && q.blanks === 1, "one fill-in box"],
    [q && q.needsScreen === true, "flags the drawn minus sign / graph for Read from screen"],
    [q && !/typed answer/.test(JSON.stringify(q)), "doesn't read the typed answer"],
  ] },
  { file: "sadlier.html", host: "www.sadlierconnect.com", check: q => [
    [q && q.site === "Sadlier", "site is Sadlier"],
    [q && /The coach tried to _+ the team/.test(q.question) && /Which word best completes/.test(q.question), "question stem"],
    [q && q.choices.length === 4 && q.choices[0] === "rejuvenate" && q.choices[3] === "relinquish", "four word choices (got " + JSON.stringify(q && q.choices) + ")"],
    [q && !/Privacy|Account/.test(q.question), "no header/footer text"],
  ] },
];
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true } });
  let pass = 0, fail = 0;
  for (const c of cases) {
    await w.loadFile(path.join(DIR, "fixtures", c.file));
    const q = await w.webContents.executeJavaScript(`${EXTRACT}; SkyExtract.extract(document, ${JSON.stringify(c.host)})`);
    for (const [ok, name] of c.check(q)) { console.log(`${ok ? "PASS" : "FAIL"}  ${c.file}: ${name}`); ok ? pass++ : fail++; }
  }
  // a new question appears (IXL swaps the question in place): the signature changes, so the panel updates
  await w.loadFile(path.join(DIR, "fixtures", "ixl-choice.html"));
  const sigs = await w.webContents.executeJavaScript(`${EXTRACT}; (() => { const a = SkyExtract.extract(document, "www.ixl.com").sig;
    document.querySelector(".question-and-submission-view p:nth-of-type(2)").innerHTML = "<span>4</span> ? <span>-9</span>";
    const b = SkyExtract.extract(document, "www.ixl.com"); return { changed: a !== b.sig, text: b.question }; })()`);
  const ok = sigs.changed && /4 \? -9/.test(sigs.text); console.log(`${ok ? "PASS" : "FAIL"}  next question is detected (${JSON.stringify(sigs.text.split("\n")[1])})`); ok ? pass++ : fail++;
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
