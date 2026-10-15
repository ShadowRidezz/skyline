// Writes the step files for the two-person servers test: Shadow makes a server and invites Bella from a
// message; Bella joins from the invite card; they talk in #general (an @mention lights Bella's server icon);
// a new channel shows up live; a picture in the channel; and Shadow, an admin, makes a badge and gives it.
// node test/social/e2e-servers.mjs <outDir>   (the test server must run with SKY_TEST_ADMIN=Shadow_Ridezz)
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const H = fs.readFileSync(new URL("./e2e-steps.mjs", import.meta.url), "utf8").match(/const H = `([\s\S]*?)`;\s*\n/)[1];
const js = f => { const s = f.toString(); return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")); };
const S = (f, extra = {}) => ({ wait: 200, ...extra, js: js(f) });

const A = [
  { wait: 14000, js: H + "; return 1" },
  S(async () => { await signUp("shadow@test.local", "Shadow_Ridezz", "Shadow"); return "A"; }),
  S(async () => {
    C('[data-sx="add"]'); await W(() => document.querySelector('#sxAddQ'));
    await W(() => { if (document.querySelector('#sxAddRes [data-r^="send:"]')) return true; if (!window._t || Date.now() - window._t > 2000) { window._t = Date.now(); T('#sxAddQ', 'bella'); } return false; }, 90000);
    C('#sxAddRes [data-r^="send:"]'); await W(() => /Request sent/.test(document.querySelector('#sxAddRes').innerText)); C('#dlg [data-r=close]');
    await W(() => document.querySelector('.sx-dm'), 60000); return 'friends';
  }),
  // make a server from the + in the server bar
  S(async () => {
    C('[data-sx="newserver"]'); await W(() => document.querySelector('#sxSrvName'));
    C('[data-d="tpl:gaming"]'); T('#sxSrvName', 'Night Crew'); C('[data-d="create"]');
    await W(() => document.querySelector('.sx-chat-head.ch') && document.querySelector('.sx-inv-dlg'), 20000);
    await W(() => document.querySelector('[data-d^="send:"]:not([disabled])'), 20000);
    const code = document.querySelector('#sxInvOut').textContent;
    C('[data-d^="send:"]'); await W(() => /Sent/.test(document.querySelector('.sx-inv-friends').innerText));
    C('#dlg [data-d=close]');
    return { code, channels: [...document.querySelectorAll('.sx-chan span:not(.sx-chan-gear)')].map(s => s.textContent), rail: document.querySelectorAll('.sx-rail-i[data-srv]').length };
  }, { wait: 600, shot: "S1-server.png" }),
  // Bella joined and said hi: @mention her back
  S(async () => {
    await W(() => /hi everyone/.test(document.querySelector('#sxMsgs').innerText), 90000);
    await new Promise(r => setTimeout(r, 2500));   // (she goes back to her messages first)
    const ta = document.querySelector('#sxText'); ta.value = 'welcome @bel'; ta.setSelectionRange(12, 12); ta.dispatchEvent(new Event('input', { bubbles: true }));
    await W(() => document.querySelector('#sxMention button'));
    const pop = document.querySelector('#sxMention').innerText;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const filled = ta.value; ta.value = filled + 'glad you made it'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#sxCompose').requestSubmit();
    await W(() => !document.querySelector('.sx-msg.sending') && document.querySelector('.sx-mention'));
    return { pop, filled };
  }, { wait: 400 }),
  // a new channel
  S(async () => {
    C('[data-sx^="newchannel:"]'); await W(() => document.querySelector('#sxChName'));
    T('#sxChName', 'Homework Help'); const hint = document.querySelector('#sxChHint').textContent; C('#dlg [data-d=save]');
    await W(() => /homework-help/.test(document.querySelector('.sx-chat-head').innerText), 20000);
    return hint;
  }, { wait: 300 }),
  // the members list
  S(async () => { C('[data-sx^="members:"]'); await W(() => document.querySelectorAll('.sx-mem').length === 2, 20000); return document.querySelector('.sx-mems').innerText.replace(/\s+/g, ' '); }, { wait: 500, shot: "S2-members.png" }),
  // admin: make a badge from a starter and give it to yourself, then to Bella
  S(async () => {
    C('[data-sx="go:settings"]'); await W(() => document.querySelector('[data-sx="set:admin"]'), 20000);
    C('[data-sx="set:admin"]'); await W(() => document.querySelector('.ad-stats'), 20000);
    const stats = document.querySelector('.ad-stats').innerText.replace(/\s+/g, ' ');
    C('[data-ad="tab:badges"]'); await W(() => document.querySelector('[data-ad="newbadge"]'));
    C('[data-ad="newbadge"]'); await W(() => document.querySelector('.ad-starters'));
    C('[data-b="starter:0"]'); await W(() => document.querySelector('#adBName') && document.querySelector('#adBName').value === 'Developer');
    C('[data-b="save"]');
    await W(() => !document.querySelector('#dlg').classList.contains('hidden') && /Give Developer to yourself/.test(document.querySelector('#dlg').innerText), 20000);
    C('#dlg [data-r="1"]');
    await W(() => document.querySelector('#sxMe .sx-badge'), 20000);
    return { stats, myBadge: document.querySelector('#sxMe .sx-badge').getAttribute('aria-label') };
  }, { wait: 800, shot: "S3-admin-badges.png" }),
  S(async () => {
    C('[data-ad="tab:people"]'); await W(() => document.querySelector('[data-ad^="givepick:"]'), 20000);
    const row = [...document.querySelectorAll('.ad-people .sx-row')].find(r => /bella/.test(r.innerText));
    row.querySelector('[data-ad^="givepick:"]').click(); await W(() => document.querySelector('.ad-bmenu [data-pb]'));
    document.querySelector('.ad-bmenu [data-pb]').click();
    await W(() => [...document.querySelectorAll('.ad-people .sx-row')].find(r => /bella/.test(r.innerText) && r.querySelector('.ad-ubadges .sx-badge')), 20000);
    return 'gave Bella the badge';
  }, { wait: 600, shot: "S4-admin-people.png" }),
  S(async () => { await new Promise(r => setTimeout(r, 20000)); return 'done'; }),
];

const B = [
  { wait: 17000, js: H + "; return 1" },
  S(async () => { await signUp("bella@test.local", "bella.b", "Bella"); return "B"; }),
  S(async () => { await W(() => document.querySelector('.rbtn[data-view=social] .rcount'), 90000); C('[data-sx="go:requests"]'); await W(() => document.querySelector('[data-sx^="accept:"]')); C('[data-sx^="accept:"]'); await W(() => document.querySelector('.sx-dm')); return 'friends'; }),
  // the invite arrives as a message, with a card: join from it
  S(async () => {
    await W(() => document.querySelector('.sx-dm.unread') || document.querySelector('.sx-dm'), 60000);
    C('.sx-dm'); await W(() => document.querySelector('.sx-inv-card [data-sx^="joininv:"]'), 90000);
    const card = document.querySelector('.sx-inv-card').innerText.replace(/\s+/g, ' ');
    C('.sx-inv-card [data-sx^="joininv:"]');
    await W(() => document.querySelector('.sx-chat-head.ch'), 20000);
    return card;
  }, { wait: 600, shot: "B1-invite-card.png" }),
  S(async () => {
    const ta = document.querySelector('#sxText'); ta.value = 'hi everyone'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#sxCompose').requestSubmit(); await W(() => !document.querySelector('.sx-msg.sending') && /hi everyone/.test(document.querySelector('#sxMsgs').innerText));
    C('[data-sx="home"]'); await W(() => !document.querySelector('.sx-chat-head.ch'));
    return 'said hi, went home';
  }, { wait: 300 }),
  // Shadow @mentions her: her server icon shows it
  S(async () => {
    await W(() => document.querySelector('.sx-rail-i[data-srv] .sx-rail-n'), 60000);
    const card = document.querySelector('.sx-inv-card'), r = card && card.getBoundingClientRect();
    const px = r ? r.x + r.width * 0.6 : 0, py = r ? r.y + 12 : 0;
    const over = [...document.querySelectorAll('body *')].filter(e => { const q = e.getBoundingClientRect(); return q.width && q.left <= px && q.right >= px && q.top <= py && q.bottom >= py && !e.contains(card) && !card.contains(e); })
      .filter(e => !e.closest('#scene')).map(e => e.outerHTML.slice(0, 160) + ' @' + JSON.stringify(e.getBoundingClientRect()) + ' parent:' + (e.parentElement ? e.parentElement.className + '#' + e.parentElement.id : ''));
    return { badge: document.querySelector('.sx-rail-i[data-srv] .sx-rail-n').textContent, label: document.querySelector('.sx-rail-i[data-srv]').getAttribute('aria-label'), over };
  }, { wait: 500, shot: "B2-mention-badge.png" }),
  S(async () => {
    C('.sx-rail-i[data-srv]'); await W(() => document.querySelector('.sx-msg.mention'), 20000);
    const cleared = await W(() => !document.querySelector('.sx-rail-i[data-srv] .sx-rail-n'), 10000).then(() => true, () => false);
    return { mention: document.querySelector('.sx-msg.mention').innerText.replace(/\s+/g, ' '), cleared };
  }, { wait: 500, shot: "B3-mentioned.png" }),
  // a channel Shadow makes appears by itself
  S(async () => { await W(() => /homework-help/.test(document.querySelector('.sx-chans').innerText), 60000); return document.querySelector('.sx-chans').innerText.replace(/\s+/g, ' '); }),
  // a picture in the channel (stored in the server's folder)
  S(async () => {
    const cv = new OffscreenCanvas(480, 300), g = cv.getContext('2d'); g.fillStyle = '#312e81'; g.fillRect(0, 0, 480, 300); g.fillStyle = '#fbbf24'; g.font = 'bold 48px Segoe UI'; g.fillText('Night Crew', 100, 170);
    const file = new File([await cv.convertToBlob({ type: 'image/png' })], 'crew.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.querySelector('#sxMain').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await W(() => /crew\.png/.test(document.querySelector('#sxComposeExtra').innerText) && !document.querySelector('.sx-pf-bar'), 20000);
    document.querySelector('#sxCompose').requestSubmit();
    await W(() => document.querySelector('.sx-img img') && !document.querySelector('.sx-msg.sending'), 20000);
    return 'picture in channel';
  }, { wait: 500 }),
  // the badge Shadow gives her shows up next to her name
  S(async () => { await W(() => document.querySelector('#sxMe .sx-badge'), 90000); return document.querySelector('#sxMe .sx-badge').getAttribute('aria-label'); }, { wait: 800, shot: "B4-badge.png" }),
];
fs.writeFileSync(path.join(out, "sa.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "sb.json"), JSON.stringify(B, null, 1));
console.log("server steps written");
