// Writes the step files for the two-person Social test (two Skylines, "Shadow" and "Bella", one local server).
// node test/social/e2e-steps.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const H = `window.W = (f, ms = 30000) => new Promise((ok, no) => { const t0 = Date.now(), k = () => { let v; try { v = f(); } catch (e) {} if (v) return ok(v); if (Date.now() - t0 > ms) return no(new Error('timeout ' + String(f).slice(0, 90))); setTimeout(k, 150); }; k(); });
window.T = (sel, v) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
window.C = sel => { const e = document.querySelector(sel); if (!e) throw new Error('missing ' + sel); e.click(); return e; };
window.TXT = () => document.querySelector('#sx').innerText;
window.signUp = async (email, user, display) => {
  C('[data-view=social]'); await W(() => document.querySelector('#sxAuth'));
  C('[data-sx="auth:up"]'); await W(() => /Create your/.test(TXT()));
  T('#sxAuth [name=email]', email); T('#sxAuth [name=password]', 'testpass123'); document.querySelector('#sxAuth').requestSubmit();
  await W(() => document.querySelector('#sxPick')); T('#sxPick [name=username]', user); T('#sxPick [name=display]', display);
  await new Promise(r => setTimeout(r, 700)); document.querySelector('#sxPick').requestSubmit(); await W(() => document.querySelector('.sx-shell'));
};`;
const step = (fn, extra = {}) => ({ wait: 200, ...extra, js: `${fn}` .replace(/^async \(\) => \{|\}$/g, "").replace(/^\(\) => \{|\}$/g, "") });
const js = f => { const s = f.toString(); return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")); };
const S = (f, extra = {}) => ({ wait: 200, ...extra, js: js(f) });

const A = [
  { wait: 14000, js: H + "; return 1" },
  S(async () => { await signUp("shadow@test.local", "Shadow_Ridezz", "Shadow"); return "A signed up"; }),
  // find Bella by username and send a request
  S(async () => {
    C('[data-sx="add"]'); await W(() => document.querySelector('#sxAddQ'));
    await W(() => { if (document.querySelector('#sxAddRes [data-r^="send:"]')) return true; if (!window._t || Date.now() - window._t > 2000) { window._t = Date.now(); T('#sxAddQ', 'bella'); } return false; }, 90000);
    return document.querySelector('#sxAddRes').innerText;
  }, { shot: "A1-search.png" }),
  S(async () => { C('#sxAddRes [data-r^="send:"]'); await W(() => /Request sent/.test(document.querySelector('#sxAddRes').innerText)); return document.querySelector('#sxAddRes').innerText; }, { wait: 400, shot: "A2-sent.png" }),
  S(async () => { C('#dlg [data-r=close]'); C('[data-sx="go:requests"]'); await W(() => /Sent/i.test(TXT())); return TXT().slice(0, 300); }, { wait: 300, shot: "A3-outgoing.png" }),
  // Bella accepts: she becomes a friend
  S(async () => { await W(() => document.querySelector('.sx-dm'), 60000); C('[data-sx="go:friends"]'); await W(() => /Bella/.test(TXT())); return TXT().slice(0, 400); }, { wait: 800, shot: "A4-friends.png" }),
  // chat
  S(async () => {
    C('.sx-dm'); await W(() => document.querySelector('#sxText'));
    const ta = document.querySelector('#sxText'); ta.value = "hey bella, it's shadow\nsecond line"; ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#sxCompose').requestSubmit();
    await W(() => !document.querySelector('.sx-msg.sending') && /second line/.test(document.querySelector('#sxMsgs').innerText));
    await W(() => /hi shadow/.test(document.querySelector('#sxMsgs').innerText), 60000);
    await W(() => /Seen/.test(document.querySelector('#sxMsgs').innerText), 20000).catch(() => 0);
    return document.querySelector('#sxMsgs').innerText;
  }, { wait: 600, shot: "A5-chat.png" }),
  // call
  S(async () => { C('.sx-chat-head [data-sx^="call:"]'); await W(() => document.querySelector('.sx-stage')); await new Promise(r => setTimeout(r, 400)); return document.querySelector('.sx-stage').innerText; }, { shot: "A6-calling.png" }),
  S(async () => { await W(() => /^\d+:\d\d$/.test((document.querySelector('.sx-call-time') || {}).textContent || ''), 60000); await new Promise(r => setTimeout(r, 1500)); return document.querySelector('.sx-call-time').textContent; }, { shot: "A7-connected.png" }),
  S(async () => { C('[data-cc=cam]'); await W(() => document.querySelector('video[data-stream=mycam]')); await new Promise(r => setTimeout(r, 2500)); return 'cam on'; }, { shot: "A8-cam.png" }),
  S(async () => { C('[data-cc=share]'); await W(() => document.querySelector('.sx-pick')); return [...document.querySelectorAll('.sx-pick')].map(x => x.innerText).join(' | '); }, { wait: 500, shot: "A9-picker.png" }),
  S(async () => { C('[data-p=go]'); await W(() => document.querySelector('.sx-share video[data-stream=myscreen]')); await new Promise(r => setTimeout(r, 6000)); return document.querySelector('.sx-share').innerText; }, { shot: "A10-sharing.png" }),
  S(async () => { C('[data-cc=stopshare]'); await W(() => !document.querySelector('.sx-share')); await new Promise(r => setTimeout(r, 3000)); C('[data-view=home]'); await W(() => document.querySelector('#sxDock')); return document.querySelector('#sxDock').innerText; }, { wait: 300, shot: "A11-dock.png" }),
  S(async () => { C('#sxDock [data-dk=end]'); await W(() => !document.querySelector('#sxDock')); C('[data-view=social]'); return 'ended'; }, { wait: 3000 }),
  // a second call that Bella declines
  S(async () => { await W(() => document.querySelector('.sx-chat-head')); C('.sx-chat-head [data-sx^="video:"]'); await W(() => document.querySelector('.sx-stage')); await W(() => !document.querySelector('.sx-stage'), 60000); return document.querySelector('#toast').textContent; }, { wait: 500 }),
  S(async () => { const n = document.querySelectorAll('.sx-msg').length; return 'messages shown ' + n + ' · seen: ' + /Seen/.test(document.querySelector('#sxMsgs').innerText); }, { wait: 300, shot: "A12b-after-calls.png" }),
  // personal look + badges + status
  S(async () => {
    C('[data-sx="go:settings"]'); await W(() => document.querySelector('.sx-set'));
    C('[data-sx="set:appearance"]'); await W(() => document.querySelector('[data-sx="preset:Mint"]')); C('[data-sx="preset:Mint"]');
    return getComputedStyle(document.documentElement).getPropertyValue('--a1').trim();
  }, { wait: 1200, shot: "A12-appearance.png" }),
  S(async () => {
    C('[data-sx="set:profile"]'); await W(() => document.querySelector('[data-sx="badgeedit:new"]')); C('[data-sx="badgeedit:new"]');
    await W(() => document.querySelector('#sxBName')); T('#sxBName', 'Founder'); C('[data-b="icon:crown"]'); C('[data-b=save]');
    await W(() => document.querySelector('.sx-badge-row')); return document.querySelector('.sx-badges-list').innerText;
  }, { wait: 1500, shot: "A13-badges.png" }),
  S(async () => { C('[data-sx=me]'); await W(() => document.querySelector('.sx-menu')); [...document.querySelectorAll('.sx-menu button')].find(b => /Do not disturb/.test(b.innerText)).click(); await new Promise(r => setTimeout(r, 1500)); return document.querySelector('.sx-me .sx-dot').className; }, { wait: 12000 }),
];

const B = [
  { wait: 17000, js: H + "; return 1" },
  S(async () => { await signUp("bella@test.local", "bella.b", "Bella"); return "B signed up"; }),
  S(async () => { await W(() => document.querySelector('.rbtn[data-view=social] .rcount'), 90000); C('[data-sx="go:requests"]'); await W(() => /Received/i.test(TXT())); return TXT().slice(0, 300); }, { wait: 500, shot: "B1-request.png" }),
  S(async () => { C('[data-sx^="accept:"]'); await W(() => document.querySelector('.sx-dm')); return 'accepted'; }, { wait: 500 }),
  S(async () => { C('[data-sx="go:friends"]'); await W(() => document.querySelector('.sx-dm.unread'), 60000); return document.querySelector('.sx-dms').innerText + ' / rail ' + (document.querySelector('.rbtn[data-view=social] .rcount') || {}).textContent; }, { wait: 600, shot: "B2-unread.png" }),
  S(async () => {
    C('.sx-dm'); await W(() => /second line/.test((document.querySelector('#sxMsgs') || {}).innerText || ''));
    const ta = document.querySelector('#sxText'); ta.value = 'hi shadow! 👋 check https://example.com'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#sxCompose').requestSubmit(); await W(() => !document.querySelector('.sx-msg.sending'));
    return document.querySelector('#sxMsgs').innerText;
  }, { wait: 600, shot: "B3-chat.png" }),
  S(async () => { await W(() => document.querySelector('#sxIncoming'), 90000); return document.querySelector('#sxIncoming').innerText; }, { wait: 600, shot: "B4-incoming.png" }),
  S(async () => { C('#sxIncoming [data-in=voice]'); await W(() => /^\d+:\d\d$/.test((document.querySelector('.sx-call-time') || {}).textContent || ''), 60000); return 'connected'; }, { wait: 1500, shot: "B5-connected.png" }),
  S(async () => { const v = await W(() => { const x = document.querySelector('video[data-stream=cam]'); return x && x.videoWidth > 0 && x; }, 60000); return 'their camera ' + v.videoWidth + 'x' + v.videoHeight; }, { wait: 1500, shot: "B6-video.png" }),
  S(async () => { const v = await W(() => { const x = document.querySelector('.sx-share video[data-stream=screen]'); return x && x.videoWidth > 0 && x; }, 60000); await new Promise(r => setTimeout(r, 4000));
    const q = document.querySelector('[data-shareq]').textContent; C('.sx-share-full'); await new Promise(r => setTimeout(r, 800)); const full = document.fullscreenElement && document.fullscreenElement.className;
    if (document.fullscreenElement) await document.exitFullscreen();
    return 'their screen ' + v.videoWidth + 'x' + v.videoHeight + ' · ' + document.querySelector('.sx-share-tag').innerText + ' · shown as ' + q + ' · full screen: ' + full; }, { wait: 300, shot: "B7-share.png" }),
  S(async () => { await W(() => !document.querySelector('.sx-share'), 60000); return 'share ended → ' + document.querySelector('#sxStageSlot').className; }, { wait: 300 }),
  S(async () => { await W(() => !document.querySelector('.sx-stage'), 60000); return 'call ended'; }, { wait: 300 }),
  S(async () => { const card = await W(() => document.querySelector('#sxIncoming'), 90000); const t = card.innerText; C('#sxIncoming [data-in=decline]'); await W(() => !document.querySelector('#sxIncoming')); return 'declined: ' + t; }, { wait: 500 }),
  S(async () => { C('[data-sx="go:friends"]'); await W(() => /Do not disturb/.test(TXT()), 60000); return TXT().slice(0, 300); }, { wait: 600, shot: "B8-dnd.png" }),
  S(async () => { const p = document.querySelector('.sx-row [data-sx^="profile:"]'); p.click(); await W(() => /Friends since/i.test((document.querySelector('#sxPanel') || {}).innerText || '')); return document.querySelector('#sxPanel').innerText; }, { wait: 800, shot: "B9-profile.png" }),
];

fs.writeFileSync(path.join(out, "a.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "b.json"), JSON.stringify(B, null, 1));
// later, Shadow alone again: still signed in, colours and history kept, and Bella (gone) is offline
const A2 = [
  { wait: 15000, js: H + "; return 1" },
  S(async () => { C('[data-view=social]'); await W(() => document.querySelector('.sx-shell')); await W(() => document.querySelector('.sx-dm')); return { a1: getComputedStyle(document.documentElement).getPropertyValue('--a1').trim(), me: document.querySelector('.sx-me').innerText, dm: document.querySelector('.sx-dms').innerText }; }, { wait: 500 }),
  S(async () => { C('.sx-dm'); await W(() => /hi shadow/.test((document.querySelector('#sxMsgs') || {}).innerText || '')); return document.querySelector('#sxMsgs').innerText; }, { wait: 800, shot: "C1-restored.png" }),
  S(async () => { C('.sx-chat-head [data-sx^="call:"]'); await new Promise(r => setTimeout(r, 800)); return { toast: document.querySelector('#toast').textContent, stage: !!document.querySelector('.sx-stage') }; }, { wait: 300 }),
];
fs.writeFileSync(path.join(out, "a2.json"), JSON.stringify(A2, null, 1));
console.log("steps written");
