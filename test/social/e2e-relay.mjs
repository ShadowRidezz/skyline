// The call relay (TURN), two people: Shadow (the admin) tries the Admin › Call relay box (junk, then a relay that
// doesn't answer: both refused with a clear message), then a relay is set on the server and a call still connects
// (a relay is only a fallback; it must never get in the way of a direct call).
// node test/social/e2e-relay.mjs <outDir>   (the test server must run with SKY_TEST_ADMIN=Shadow_Ridezz)
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
    document.querySelector('#tour')?.remove();
    await W(() => !document.querySelector('#railAdmin').classList.contains('hidden'), 30000); C('#railAdmin');
    await W(() => document.querySelector('#adRelayIn'), 30000);
    T('#adRelayIn', 'not a relay list'); C('[data-ad="relaysave"]'); await W(() => /doesn't look like/.test(document.querySelector('#adRelaySt').textContent));
    const junk = document.querySelector('#adRelaySt').textContent;
    T('#adRelayIn', 'iceServers: [{ urls: "turn:127.0.0.1:3999", username: "nobody", credential: "nothing" }]'); C('[data-ad="relaysave"]');
    await W(() => /didn't answer/.test(document.querySelector('#adRelaySt').textContent), 20000);
    return { junk, dead: document.querySelector('#adRelaySt').textContent, stillOff: /Off/.test(document.querySelector('#adRelay').innerText) };
  }, { shot: "L1-admin.png" }),
  S(async () => {
    const { api } = await import('./js/social/api.js'); const { S, } = await import('./js/social/state.js'); const { loadRelay } = await import('./js/social/social.js');
    await api.rpc('admin_set_ice', { p_servers: [{ urls: 'turn:127.0.0.1:3999', username: 'nobody', credential: 'nothing' }] }); await loadRelay();
    return { ice: S.ice.map(x => [].concat(x.urls).join(' ')) };
  }),
  S(async () => { C('[data-view=social]'); C('.sx-dm'); await W(() => document.querySelector('.sx-chat-head [data-sx^="call:"]')); C('.sx-chat-head [data-sx^="call:"]');
    await W(() => /^\d+:\d\d$/.test((document.querySelector('.sx-call-time') || {}).textContent || ''), 60000); await new Promise(r => setTimeout(r, 1500)); return 'connected with a relay set: ' + document.querySelector('.sx-call-time').textContent; }, { shot: "L2-call.png" }),
  S(async () => { C('[data-cc="end"]'); return 'ended'; }, { wait: 1500 }),
];
const B = [...B0.slice(0, 4),
  S(async () => { await W(() => document.querySelector('#sxIncoming'), 120000); C('#sxIncoming [data-in=voice]'); await W(() => /^\d+:\d\d$/.test((document.querySelector('.sx-call-time') || {}).textContent || ''), 60000); return 'B connected'; }, { wait: 300 }),
  S(async () => { await W(() => !document.querySelector('.sx-stage'), 60000); return 'B call over'; }),
];
fs.writeFileSync(path.join(out, "la.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "lb.json"), JSON.stringify(B, null, 1));
console.log("relay steps written");
