// "Connect Classroom on your PC" from the phone, the PC side: Shadow's PC Skyline signs in to Social and checks in;
// when the phone asks (the phone web app at 393x852, or the step below that asks like the phone does), the PC picks
// it up live, "signs in" (SKY_CR_FAKE=1: a stand-in for Google's window, never opens Google) and sends the phone a
// fresh school summary. Run with SKY_SOCIAL_TEST=http://127.0.0.1:PORT SKY_CR_FAKE=1.
// node test/social/e2e-classroom.mjs <outDir> [wait-for-phone]   then   npx electron . --shot=<outDir>/cr.json --out=<outDir> --profile=cr
//   wait-for-phone: the PC waits (up to 10 minutes) for a request from the real phone app instead of making one itself
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const out = process.argv[2], phone = process.argv[3] === "wait-for-phone";
const tmp = path.join(out, "_base"); fs.mkdirSync(tmp, { recursive: true });
execFileSync("node", [fileURLToPath(new URL("./e2e-steps.mjs", import.meta.url)), tmp]);
const A0 = JSON.parse(fs.readFileSync(path.join(tmp, "a.json")));
const js = f => { const s = f.toString(); return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")); };
const S = (f, extra = {}) => ({ wait: 300, ...extra, js: js(f) });
const steps = [A0[0], A0[1],
  // the PC checks in: the phone can see Skyline is running here, and Classroom isn't connected yet
  S(async () => {
    document.querySelector('#tour')?.remove();
    const { api } = await import('./js/social/api.js');
    let st; await W(() => { api.rpc('school_link_status').then(r => st = r); return st && st.pc_seen && st.pc_state === 'not_connected'; }, 30000);
    return { checkedIn: st.pc_state, seen: !!st.pc_seen };
  }),
  phone ? S(async () => {
    const { api } = await import('./js/social/api.js'); let st;
    await W(() => { api.rpc('school_link_status').then(r => st = r); return st && st.request_id > 0; }, 600000);
    return 'the phone asked: request ' + st.request_id;
  }) : S(async () => {
    const { api } = await import('./js/social/api.js');
    const r = await api.rpc('school_connect_request');   // what the phone's "Connect on your PC" does
    return 'asked like the phone: request ' + r.request_id;
  }),
  // picked up live: signing in, then connected, and the phone's summary has the assignment
  S(async () => {
    const { api } = await import('./js/social/api.js'); const seen = new Set(); let st;
    await W(() => { api.rpc('school_link_status').then(r => { st = r; if (r) seen.add(r.pc_state); }); return st && st.pc_state === 'connected' && st.handled_id === st.request_id; }, 60000);
    let snap; await W(() => { api.rpc('get_school').then(r => snap = r); return snap && snap.data && (snap.data.due || []).some(x => /density/.test(x.title)); }, 60000);
    return { states: [...seen], handled: st.handled_id, due: snap.data.due.map(x => x.title) };
  }),
  S(async () => { C('[data-view=school]'); await new Promise(r => setTimeout(r, 1200)); return document.querySelector('#view-school, [data-page=school], main')?.innerText.slice(0, 300) || 'school'; }, { shot: "cr-pc-school.png" }),
];
fs.writeFileSync(path.join(out, "cr.json"), JSON.stringify(steps, null, 1));
console.log("classroom steps written");
