// Theme sharing, two people: Shadow sends "Osaka Blue Hour" from Theme Studio; Bella gets a card and uses it.
// node test/social/e2e-theme-share.mjs <outDir>  (reuses the sign-up and friend steps of the main Social test)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const out = process.argv[2];
const tmp = path.join(out, "_base"); fs.mkdirSync(tmp, { recursive: true });
execFileSync("node", [fileURLToPath(new URL("./e2e-steps.mjs", import.meta.url)), tmp]);
const A0 = JSON.parse(fs.readFileSync(path.join(tmp, "a.json"))), B0 = JSON.parse(fs.readFileSync(path.join(tmp, "b.json")));
const js = f => { const s = f.toString(); return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")); };
const S = (f, extra = {}) => ({ wait: 300, ...extra, js: js(f) });
const A = [...A0.slice(0, 6),
  S(async () => {
    C('[data-view=settings]'); await W(() => document.querySelector('#thGallery .th-card'));
    const card = [...document.querySelectorAll('#thGallery .th-card')].find(c => /Osaka Blue Hour/.test(c.innerText)); card.click();
    await new Promise(r => setTimeout(r, 800));
    C('[data-th="send"]'); await W(() => document.querySelector('#dlg input[name="thf"]'));
    const who = document.querySelector('#dlg .th-send').innerText;
    C('#dlg [data-r="1"]'); await W(() => /Sent/.test(document.querySelector('#toast').textContent));
    return { who, toast: document.querySelector('#toast').textContent };
  }, { shot: "T1-sent.png" }),
  S(async () => { C('[data-view=social]'); C('.sx-dm'); await W(() => document.querySelector('#sxMsgs .sx-theme')); return document.querySelector('#sxMsgs .sx-theme').innerText; }, { wait: 800, shot: "T2-mine.png" }),
  { wait: 25000 },
];
const B = [...B0.slice(0, 4),
  S(async () => {
    document.querySelector('#tour')?.remove(); C('[data-sx="go:friends"]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm');
    await W(() => document.querySelector('#sxMsgs .sx-theme button'), 90000);
    const text = document.querySelector('#sxMsgs').innerText.slice(-200);
    return { card: document.querySelector('#sxMsgs .sx-theme').innerText, visibleCode: /sky:theme\//.test(text) };
  }, { wait: 800, shot: "T3-card.png" }),
  S(async () => {
    const before = getComputedStyle(document.documentElement).getPropertyValue('--a1').trim();
    document.querySelector('#sxMsgs .sx-theme button').click();
    await W(() => /Now using/.test(document.querySelector('#toast').textContent));
    const { Themes } = await import('./js/themes.js');
    return { toast: document.querySelector('#toast').textContent, active: (Themes.find(Themes.doc.active) || {}).name, photo: ((Themes.find(Themes.doc.active) || {}).photo || {}).src, custom: Themes.doc.custom.length, before };
  }, { wait: 1500, shot: "T4-used.png" }),
];
fs.writeFileSync(path.join(out, "ta.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "tb.json"), JSON.stringify(B, null, 1));
console.log("theme steps written");
