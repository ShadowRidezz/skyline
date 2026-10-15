// Writes the step files for the two-person messages test: replies, reactions, edits, stickers, a picture, pins,
// search, deleting; then a call where Shadow has no microphone and Bella's voice lights the green ring.
// node test/social/e2e-chat.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const H = fs.readFileSync(new URL("./e2e-steps.mjs", import.meta.url), "utf8").match(/const H = `([\s\S]*?)`;\s*\n/)[1];
const js = f => { const s = f.toString(); return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")); };
const S = (f, extra = {}) => ({ wait: 200, ...extra, js: js(f) });
const MSGS = "document.querySelector('#sxMsgs').innerText";

const A = [
  { wait: 14000, js: H + "; return 1" },
  S(async () => { await signUp("shadow@test.local", "Shadow_Ridezz", "Shadow"); return "A"; }),
  S(async () => {
    C('[data-sx="add"]'); await W(() => document.querySelector('#sxAddQ'));
    await W(() => { if (document.querySelector('#sxAddRes [data-r^="send:"]')) return true; if (!window._t || Date.now() - window._t > 2000) { window._t = Date.now(); T('#sxAddQ', 'bella'); } return false; }, 90000);
    C('#sxAddRes [data-r^="send:"]'); await W(() => /Request sent/.test(document.querySelector('#sxAddRes').innerText)); C('#dlg [data-r=close]');
    await W(() => document.querySelector('.sx-dm'), 60000); C('.sx-dm'); await W(() => document.querySelector('#sxText'));
    const say = t => { const ta = document.querySelector('#sxText'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sxCompose').requestSubmit(); };
    say('hello bella, check this out'); await W(() => !document.querySelector('.sx-msg.sending'));
    say('typo heer'); await W(() => !document.querySelector('.sx-msg.sending'));
    return 'sent';
  }, { wait: 500 }),
  // fix the typo with ↑
  S(async () => {
    const ta = document.querySelector('#sxText'); ta.focus(); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const box = await W(() => document.querySelector('#sxEditBox')); box.value = 'typo here (fixed)';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await W(() => /\(edited\)/.test(document.querySelector('#sxMsgs').innerText));
    return 'edited';
  }),
  // Bella's reply arrives: react to it with the quick 🔥 (hover toolbar)
  S(async () => {
    await W(() => /sounds good/.test(document.querySelector('#sxMsgs').innerText), 60000);
    const row = [...document.querySelectorAll('.sx-msg')].find(r => /sounds good/.test(r.innerText));
    row.querySelector('[data-quick]').click(); await W(() => row.querySelector('.sx-react.mine') || document.querySelector('.sx-react.mine'));
    return 'reacted';
  }, { wait: 300 }),
  // a picture, dropped onto the conversation
  S(async () => {
    const cv = new OffscreenCanvas(640, 400), g = cv.getContext('2d'); g.fillStyle = '#1e293b'; g.fillRect(0, 0, 640, 400); g.fillStyle = '#facc15'; g.font = 'bold 64px Segoe UI'; g.fillText('Skyline', 170, 220);
    const file = new File([await cv.convertToBlob({ type: 'image/png' })], 'screenshot.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.querySelector('#sxMain').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await W(() => /screenshot\.png/.test(document.querySelector('#sxComposeExtra').innerText) && !document.querySelector('.sx-pf-bar'), 20000);
    const ta = document.querySelector('#sxText'); ta.value = 'the new look'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sxCompose').requestSubmit();
    await W(() => document.querySelector('.sx-img img') && !document.querySelector('.sx-msg.sending'), 20000);
    return 'picture sent';
  }, { wait: 500, shot: "C1-shadow.png" }),
  // pin the first message
  S(async () => {
    const row = [...document.querySelectorAll('.sx-msg')].find(r => /hello bella/.test(r.innerText));
    row.querySelector('[data-sx=msgmenu]').click(); await W(() => document.querySelector('.sx-menu'));
    [...document.querySelectorAll('.sx-menu button')].find(b => /Pin message/.test(b.innerText)).click();
    await W(() => [...document.querySelectorAll('.sx-msg.pinned')].some(r => /hello bella/.test(r.innerText))); return 'pinned';
  }),
  // delete the edited message
  S(async () => {
    const row = [...document.querySelectorAll('.sx-msg')].find(r => /typo here/.test(r.innerText));
    row.querySelector('[data-sx=msgmenu]').click(); await W(() => document.querySelector('.sx-menu'));
    [...document.querySelectorAll('.sx-menu button')].find(b => /Delete message/.test(b.innerText)).click();
    await W(() => !document.querySelector('#dlg').classList.contains('hidden')); document.querySelector('#dlg [data-r="1"]').click();
    await W(() => /This message was deleted/.test(document.querySelector('#sxMsgs').innerText)); return 'deleted';
  }, { wait: 8000 }),
  // a call with no microphone: allowed, with a warning; Bella's voice rings green
  S(async () => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }));
    C('.sx-chat-head [data-sx^="call:"]');
    await W(() => /No microphone/.test(document.querySelector('#toast').textContent), 10000);
    const t = document.querySelector('#toast').textContent;
    await W(() => /^\d+:\d\d$/.test((document.querySelector('.sx-call-time') || {}).textContent || ''), 60000);
    const ring = await W(() => document.querySelector('[data-tile="them"].speaking'), 20000).then(() => true, () => false);
    return { toast: t, nomicBanner: !!document.querySelector('.sx-nomic'), muteDisabled: document.querySelector('[data-cc=mute]').disabled, theirRingWhenTalking: ring };
  }, { wait: 300, shot: "C2-call.png" }),
  S(async () => { C('[data-cc=end]'); await W(() => !document.querySelector('.sx-stage')); return 'ended'; }, { wait: 500 }),
];

const B = [
  { wait: 17000, js: H + "; return 1" },
  S(async () => { await signUp("bella@test.local", "bella.b", "Bella"); return "B"; }),
  S(async () => { await W(() => document.querySelector('.rbtn[data-view=social] .rcount'), 90000); C('[data-sx="go:requests"]'); await W(() => document.querySelector('[data-sx^="accept:"]')); C('[data-sx^="accept:"]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm'); return 'friends'; }),
  // reply to "hello bella"
  S(async () => {
    const row = await W(() => [...document.querySelectorAll('.sx-msg')].find(r => /hello bella/.test(r.innerText)), 60000);
    row.querySelector('[data-sx=reply]').click(); await W(() => /Replying to/.test(document.querySelector('#sxComposeExtra').innerText));
    const ta = document.querySelector('#sxText'); ta.value = 'sounds good!'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sxCompose').requestSubmit();
    await W(() => document.querySelector('.sx-quote') && !document.querySelector('.sx-msg.sending'));
    return document.querySelector('.sx-quote').innerText;
  }, { wait: 500 }),
  // a sticker
  S(async () => {
    C('[data-sx=stickers]'); await W(() => document.querySelector('.sx-stk [data-tab=sky]')); C('.sx-stk [data-tab=sky]');
    await W(() => document.querySelector('.sx-stk-pick')); document.querySelector('.sx-stk-pick').click();
    await W(() => document.querySelector('.sx-sticker img') && !document.querySelector('.sx-msg.sending')); return 'sticker sent';
  }, { wait: 500 }),
  // see the edit, the reaction, the picture
  S(async () => {
    await W(() => /\(edited\)/.test(document.querySelector('#sxMsgs').innerText), 30000);
    await W(() => document.querySelector('.sx-react'), 30000);
    await W(() => document.querySelector('.sx-img img'), 40000);
    return { reaction: document.querySelector('.sx-react').innerText.replace(/\s+/g, ' '), picture: document.querySelector('.sx-img img').naturalWidth };
  }, { wait: 600 }),
  // pins and search
  S(async () => {
    await W(() => document.querySelector('.sx-msg.pinned'), 30000);
    C('[data-sx=pins]'); await W(() => /hello bella/.test((document.querySelector('#sxFloatList') || {}).innerText || ''));
    C('[data-f=close]'); C('[data-sx=msgsearch]'); await W(() => document.querySelector('#sxMsgQ'));
    T('#sxMsgQ', 'new look'); await W(() => /new look/.test(document.querySelector('#sxFloatList').innerText)); const r = document.querySelector('#sxFloatList').innerText;
    C('[data-f=close]'); return r;
  }, { wait: 800, shot: "C3-bella.png" }),
  S(async () => { await W(() => /This message was deleted/.test(document.querySelector('#sxMsgs').innerText), 40000); return 'saw the delete'; }),
  S(async () => { await W(() => document.querySelector('#sxIncoming'), 90000); C('#sxIncoming [data-in=voice]'); await W(() => /^\d+:\d\d$/.test((document.querySelector('.sx-call-time') || {}).textContent || ''), 60000); return 'in call'; }, { wait: 14000 }),
];
fs.writeFileSync(path.join(out, "ca.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "cb.json"), JSON.stringify(B, null, 1));
console.log("chat steps written");
