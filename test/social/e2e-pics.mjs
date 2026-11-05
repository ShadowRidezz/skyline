// Pictures and old messages, two people: Shadow sends a picture; Bella right-clicks it (Copy image / Save image /
// Copy image link) and copies it. Then an hour-old message arrives "live" again: no pop-up, no unread, in its place.
// node test/social/e2e-pics.mjs <outDir>  (reuses the sign-up and friend steps of the main Social test)
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
    C('[data-view=social]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm'); await W(() => document.querySelector('#sxText'));
    const cv = new OffscreenCanvas(640, 400), g = cv.getContext('2d'); g.fillStyle = '#1e293b'; g.fillRect(0, 0, 640, 400); g.fillStyle = '#facc15'; g.font = 'bold 64px Segoe UI'; g.fillText('Skyline', 170, 220);
    const file = new File([await cv.convertToBlob({ type: 'image/png' })], 'screenshot.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.querySelector('#sxMain').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await W(() => /screenshot\.png/.test(document.querySelector('#sxComposeExtra').innerText) && !document.querySelector('.sx-pf-bar'), 20000);
    const ta = document.querySelector('#sxText'); ta.value = 'look'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sxCompose').requestSubmit();
    await W(() => document.querySelector('.sx-img img') && !document.querySelector('.sx-msg.sending'), 20000);
    return 'picture sent';
  }, { wait: 500 }),
  { wait: 40000 },
];
const B = [...B0.slice(0, 4),
  S(async () => {
    document.querySelector('#tour')?.remove(); C('[data-sx="go:friends"]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm');
    const img = await W(() => { const i = document.querySelector('.sx-img img'); return i && i.naturalWidth && i; }, 90000);
    const r = img.getBoundingClientRect();
    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 20 }));
    const menu = await W(() => document.querySelector('.sx-menu'));
    const items = [...menu.querySelectorAll('button')].map(b => b.innerText.trim());
    [...menu.querySelectorAll('button')].find(b => /^Copy image$/.test(b.innerText.trim())).click();
    await W(() => /Image copied|Couldn't copy/.test(document.querySelector('#toast').textContent), 15000);
    // right-click on plain text: no picture items
    const txt = [...document.querySelectorAll('.sx-msg')].find(m => !m.querySelector('.sx-img'));
    let textItems = null;
    if (txt) { txt.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); textItems = [...document.querySelectorAll('.sx-menu button')].map(b => b.innerText.trim()); document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
    return { items, textItems, toast: document.querySelector('#toast').textContent };
  }, { wait: 800, shot: "P1-menu.png" }),
  S(async () => {
    const { Chat } = await import('./js/social/chat.js'); const { S: St, friend } = await import('./js/social/state.js');
    const fid = St.view.id; C('[data-sx="go:friends"]'); await new Promise(r => setTimeout(r, 600));
    const f = friend(fid), u0 = f.unread || 0, t0 = document.querySelector('#toast').textContent;
    const row = (body, ago) => ({ id: crypto.randomUUID(), sender: fid, recipient: St.me.id, body, kind: 'text', created_at: new Date(Date.now() - ago).toISOString() });
    Chat.onMessage({ table: 'messages', type: 'INSERT', row: row('an old one from an hour ago', 3600e3) });
    await new Promise(r => setTimeout(r, 800));
    const u1 = f.unread || 0, t1 = document.querySelector('#toast').textContent;
    Chat.onMessage({ table: 'messages', type: 'INSERT', row: row('a fresh one', 0) });
    await new Promise(r => setTimeout(r, 800));
    const u2 = f.unread || 0;
    C('.sx-dm'); await W(() => /a fresh one/.test(document.querySelector('#sxMsgs').innerText));
    const text = document.querySelector('#sxMsgs').innerText, iOld = text.indexOf('an old one'), iLook = text.indexOf('look'), iFresh = text.indexOf('a fresh one');
    return { oldAddsUnread: u1 - u0, oldToast: t1 !== t0 && /old one/.test(t1), freshAddsUnread: u2 - u1, oldBeforePicture: iOld >= 0 && iOld < iLook, freshLast: iFresh > iLook };
  }, { wait: 800, shot: "P2-order.png" }),
];
fs.writeFileSync(path.join(out, "pa.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "pb.json"), JSON.stringify(B, null, 1));
console.log("picture steps written");
