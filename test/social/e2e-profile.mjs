// Writes the step files for the two-person profile test: Shadow builds a rich profile (animated avatar, banner,
// About Me, games, status), Bella adds him and views it; then Shadow makes it friends-only.
// node test/social/e2e-profile.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

// a real two-frame animated GIF (16x16, red then blue), so the upload checks see true GIF bytes
function gif() {
  const W = 16, H = 16, out = [];
  const push = (...b) => out.push(...b), w16 = n => push(n & 255, n >> 8);
  push(...Buffer.from("GIF89a")); w16(W); w16(H); push(0x80, 0, 0); push(230, 40, 60, 40, 90, 230);   // 2-colour palette
  push(0x21, 0xFF, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);                                    // loop forever
  for (const colour of [0, 1]) {
    push(0x21, 0xF9, 4, 0x04, 30, 0, 0, 0);                                                            // 0.3 s per frame
    push(0x2C); w16(0); w16(0); w16(W); w16(H); push(0);
    push(2);                                                                                            // LZW minimum code size
    const codes = []; for (let i = 0; i < W * H; i++) codes.push(4, colour); codes.push(5);            // clear, pixel, ... end
    const bytes = []; let acc = 0, n = 0;
    for (const c of codes) { acc |= c << n; n += 3; while (n >= 8) { bytes.push(acc & 255); acc >>= 8; n -= 8; } }
    if (n) bytes.push(acc & 255);
    for (let i = 0; i < bytes.length; i += 255) { const chunk = bytes.slice(i, i + 255); push(chunk.length, ...chunk); }
    push(0);
  }
  push(0x3B);
  return Buffer.from(out).toString("base64");
}

const out = process.argv[2];
const H = fs.readFileSync(new URL("./e2e-steps.mjs", import.meta.url), "utf8").match(/const H = `([\s\S]*?)`;\s*\n/)[1];
const js = f => { const s = f.toString(); return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")); };
const S = (f, extra = {}) => ({ wait: 200, ...extra, js: js(f) });
const GIF = gif();

const A = [
  { wait: 14000, js: H + `; window.GIF = "${GIF}"; return 1` },
  S(async () => { await signUp("shadow@test.local", "Shadow_Ridezz", "Shadow"); return "A signed up"; }),
  // a custom status, from the profile menu
  S(async () => {
    C('[data-sx=me]'); await W(() => document.querySelector('.sx-menu'));
    [...document.querySelectorAll('.sx-menu button')].find(b => /custom status/i.test(b.innerText)).click();
    await W(() => document.querySelector('#sxStText')); T('#sxStText', 'building skyline');
    C('[data-st=emoji]'); await W(() => document.querySelector('.sx-emoji [data-e]')); T('.sx-emoji input', 'tools'); await new Promise(r => setTimeout(r, 200)); C('.sx-emoji [data-e]');
    C('[data-st=save]'); await W(() => document.querySelector('#dlg').classList.contains('hidden'));
    return 'status set';
  }, { wait: 800 }),
  // the profile editor
  S(async () => {
    C('[data-sx="go:settings"]'); await W(() => document.querySelector('#peForm'));
    T('[data-pe-k=pronouns]', 'he/him'); T('[data-pe-k=bio]', 'Builder of **Skyline**.\nFortnite after school. https://github.com');
    const gi = document.querySelector('[data-tag-in=games]'); gi.value = 'Fortnite'; gi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const gi2 = document.querySelector('[data-tag-in=games]'); gi2.value = 'Minecraft'; gi2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const ii = document.querySelector('[data-tag-in=interests]'); ii.value = 'music'; ii.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const ed = await import('./js/social/editor.js');
    const bytes = Uint8Array.from(atob(window.GIF), c => c.charCodeAt(0));
    await ed.uploadFile('avatar', new File([bytes], 'me.gif', { type: 'image/gif' }));
    const cv = new OffscreenCanvas(900, 300), g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 900, 0); gr.addColorStop(0, '#1d4ed8'); gr.addColorStop(1, '#9333ea'); g.fillStyle = gr; g.fillRect(0, 0, 900, 300);
    await ed.uploadFile('banner', new File([await cv.convertToBlob({ type: 'image/png' })], 'b.png', { type: 'image/png' }));
    C('[data-pe="theme:aurora"]'); C('[data-pe="deco:neon"]');
    return { dirty: document.querySelector('#peState').textContent, preview: document.querySelector('#pePrev').innerText.slice(0, 200), animated: !!document.querySelector('#pePrev img[data-anim]') };
  }, { wait: 800, shot: "P1-editor.png" }),
  // a wrong file type is refused
  S(async () => { const ed = await import('./js/social/editor.js'); await ed.uploadFile('avatar', new File(['MZ fake'], 'evil.exe', { type: 'application/x-msdownload' })); return document.querySelector('#toast').textContent; }, { wait: 300 }),
  S(async () => { C('[data-pe=save]'); await W(() => /Profile saved/.test(document.querySelector('#toast').textContent)); return { state: document.querySelector('#peState').textContent }; }, { wait: 500 }),
  // Bella asks to be friends; accept
  S(async () => { await W(() => document.querySelector('.rbtn[data-view=social] .rcount'), 90000); C('[data-sx="go:requests"]'); await W(() => document.querySelector('[data-sx^="accept:"]')); C('[data-sx^="accept:"]'); await W(() => document.querySelector('.sx-dm')); return 'accepted'; }, { wait: 500 }),
  // later: friends-only profile
  S(async () => { await new Promise(r => setTimeout(r, 15000)); C('[data-sx="go:settings"]'); await W(() => document.querySelector('[data-pe-k=visibility]')); const s = document.querySelector('[data-pe-k=visibility]'); s.value = 'friends'; s.dispatchEvent(new Event('input', { bubbles: true })); C('[data-pe=save]'); await W(() => /Profile saved/.test(document.querySelector('#toast').textContent)); return 'friends only'; }, { wait: 12000 }),
];
const B = [
  { wait: 17000, js: H + "; return 1" },
  S(async () => { await signUp("bella@test.local", "bella.b", "Bella"); return "B signed up"; }),
  // before being friends: an 'everyone' profile is visible to anyone signed in
  S(async () => {
    await new Promise(r => setTimeout(r, 14000));
    C('[data-sx="add"]'); await W(() => document.querySelector('#sxAddQ'));
    await W(() => { if (document.querySelector('#sxAddRes [data-r^="send:"]')) return true; if (!window._t || Date.now() - window._t > 2000) { window._t = Date.now(); T('#sxAddQ', 'shadow'); } return false; }, 60000);
    C('#sxAddRes [data-r^="send:"]'); await W(() => /Request sent/.test(document.querySelector('#sxAddRes').innerText)); C('#dlg [data-r=close]');
    return 'request sent';
  }),
  S(async () => { await W(() => document.querySelector('.sx-dm'), 60000); C('[data-sx="go:friends"]'); await W(() => /building skyline/.test(document.querySelector('#sx').innerText), 30000); return document.querySelector('.sx-list').innerText; }, { wait: 500, shot: "P2-friends.png" }),
  S(async () => { C('.sx-row [data-sx^="profile:"]'); await W(() => /About me/i.test((document.querySelector('#sxPanel') || {}).innerText || '')); await new Promise(r => setTimeout(r, 800)); const p = document.querySelector('#sxPanel'); return { text: p.innerText, animated: !!p.querySelector('img[data-anim]'), banner: !!p.querySelector('.pc-banner-img'), frame: !!p.querySelector('.sx-av.deco-neon') }; }, { wait: 600, shot: "P3-profile.png" }),
  // friends still see a friends-only profile
  S(async () => { await new Promise(r => setTimeout(r, 30000)); C('[data-sx=closepanel]'); C('.sx-row [data-sx^="profile:"]'); await W(() => /About me/i.test((document.querySelector('#sxPanel') || {}).innerText || ''), 15000); return 'friend still sees it'; }, { wait: 300 }),
];
fs.writeFileSync(path.join(out, "pa.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "pb.json"), JSON.stringify(B, null, 1));
console.log("profile steps written");
