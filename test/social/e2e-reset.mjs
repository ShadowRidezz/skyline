// Forgot password, one person: sign up, sign out, "Forgot password?", the code from the test outbox (instead of an
// inbox), a wrong code first, then the right one, a new password, and signing in with it. Then the "just sign me in" way.
// node test/social/e2e-reset.mjs <outDir>   (run Skyline with SKY_SOCIAL_TEST pointing at test/social/server.mjs)
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const H0 = fs.readFileSync(new URL("./e2e-steps.mjs", import.meta.url), "utf8").match(/const H = `([\s\S]*?)`;\s*\n/)[1];
const js = f => { const s = f.toString(); return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")); };
const S = (f, extra = {}) => ({ wait: 300, ...extra, js: js(f) });
const H = H0 + `
window.outbox = async email => { const r = await sky.social.testOutbox(email); return r && r.ok ? r.data : null; };
window.signOutNow = async () => { await sky.social.signOut(); await W(() => document.querySelector('#sxAuth')); };`;
const A = [
  { wait: 9000, js: H + "; return 1" },
  S(async () => { document.querySelector('#tour')?.remove(); await signUp("reset@test.local", "reset_tester", "Reset Tester"); await signOutNow(); return "signed up, signed out"; }),
  S(async () => {
    C('[data-sx="auth:reset"]'); await W(() => document.querySelector('#sxRec [name=email]'));
    T('#sxRec [name=email]', 'reset@test.local'); document.querySelector('#sxRec').requestSubmit();
    await W(() => document.querySelector('#sxRec [name=code]'));
    return document.querySelector('#sxRec').innerText.slice(0, 160);
  }, { shot: "R1-code.png" }),
  S(async () => { T('#sxRec [name=code]', '000000'); document.querySelector('#sxRec').requestSubmit(); await W(() => document.querySelector('#sxRecErr').textContent); return document.querySelector('#sxRecErr').textContent; }, { shot: "R2-wrong.png" }),
  S(async () => {
    const code = await outbox('reset@test.local'); T('#sxRec [name=code]', code); document.querySelector('#sxRec').requestSubmit();
    await W(() => document.querySelector('#sxRec [name=password]')); return { code: code.length, screen: document.querySelector('#sxRec').innerText.slice(0, 120) };
  }, { shot: "R3-choose.png" }),
  S(async () => { T('#sxRec [name=password]', 'brandnew456'); document.querySelector('#sxRec').requestSubmit(); await W(() => document.querySelector('.sx-shell')); return document.querySelector('#toast').textContent; }, { wait: 600 }),
  S(async () => {
    await signOutNow(); T('#sxAuth [name=email]', 'reset@test.local'); T('#sxAuth [name=password]', 'testpass123'); document.querySelector('#sxAuth').requestSubmit();
    await W(() => document.querySelector('#sxAuthErr').textContent); const oldFails = document.querySelector('#sxAuthErr').textContent;
    T('#sxAuth [name=password]', 'brandnew456'); document.querySelector('#sxAuth').requestSubmit(); await W(() => document.querySelector('.sx-shell'));
    return { oldPasswordSays: oldFails, newPassword: "signed in" };
  }),
  S(async () => {
    await signOutNow(); C('[data-sx="auth:reset"]'); await W(() => document.querySelector('#sxRec [name=email]'));
    T('#sxRec [name=email]', 'reset@test.local'); document.querySelector('#sxRec').requestSubmit(); await W(() => document.querySelector('#sxRec [name=code]'));
    T('#sxRec [name=code]', await outbox('reset@test.local')); document.querySelector('#sxRec').requestSubmit(); await W(() => document.querySelector('[data-rec=skip]'));
    C('[data-rec=skip]'); await W(() => document.querySelector('.sx-shell')); return "skipped: signed in without a new password";
  }, { shot: "R4-in.png" }),
];
fs.writeFileSync(path.join(out, "ra.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "rb.json"), JSON.stringify([{ wait: 1000 }], null, 1));
console.log("reset steps written");
