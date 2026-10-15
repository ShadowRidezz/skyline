// Writes the step files for the two-person "hang out" test: a voice channel (both connect and hear each other),
// "is typing…", a GIF, "Playing Fortnite", and watching a YouTube video together in a call (pausing on one side
// pauses the other). The two sides wait for each other with short "ack-…" messages, so timing never decides a step.
// node test/social/e2e-voice.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const H0 = fs.readFileSync(new URL("./e2e-steps.mjs", import.meta.url), "utf8").match(/const H = `([\s\S]*?)`;\s*\n/)[1];
const H = H0 + `
window.ack = async text => { const { api } = await import('./js/social/api.js'); const { S } = await import('./js/social/state.js');
  if (S.view.kind === 'channel') await api.rpc('send_channel_message', { p_channel: S.view.id, p_body: text, p_client_id: 'a' + Date.now() });
  else await api.rpc('send_message', { p_to: S.friends[0].id, p_body: text, p_client_id: 'a' + Date.now() }); };
window.heard = (text, ms = 120000) => W(() => new RegExp(text).test((document.querySelector('#sxMsgs') || {}).innerText || ''), ms);`;
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
  S(async () => {
    C('[data-sx="newserver"]'); await W(() => document.querySelector('#sxSrvName'));
    T('#sxSrvName', 'Night Crew'); C('[data-d="create"]');
    await W(() => document.querySelector('[data-d^="send:"]:not([disabled])'), 20000); C('[data-d^="send:"]');
    await W(() => /Sent/.test(document.querySelector('.sx-inv-friends').innerText)); C('#dlg [data-d=close]');
    const { api } = await import('./js/social/api.js');
    await api.rpc('heartbeat', { p_status: 'online', p_activity: { game: 'Fortnite', since: new Date(Date.now() - 25 * 60e3).toISOString() } });
    return [...document.querySelectorAll('.sx-chan.voice > span:not(.sx-chan-gear)')].map(s => s.textContent);
  }, { wait: 300 }),
  S(async () => {
    C('.sx-chan.voice'); await W(() => document.querySelector('.sx-vpanel'), 20000);
    const { VoiceChat } = await import('./js/social/vchat.js');
    await W(() => VoiceChat.state().peers.some(p => p.state === 'connected'), 120000);
    const ring = await W(() => [...document.querySelectorAll('.sx-vmem.speaking')].some(e => /Bella/.test(e.innerText)), 20000).then(() => true, () => false);
    return { panel: document.querySelector('.sx-vpanel').innerText.replace(/\s+/g, ' '), bellaRingsWhenTalking: ring };
  }, { wait: 600, shot: "V1-voice-shadow.png" }),
  S(async () => { await heard('ack-voice'); C('[data-sx="vmute"]'); return document.querySelector('[data-sx="vmute"]').getAttribute('aria-pressed'); }, { wait: 300 }),
  S(async () => {
    await heard('ack-mute');
    const ta = document.querySelector('#sxText'); ta.focus(); ta.value = 'hold on let me'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    await heard('ack-typing'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }));
    C('[data-sx="vleave"]'); await W(() => !document.querySelector('.sx-vpanel'), 10000); return 'typed, left voice';
  }),
  S(async () => {
    C('[data-sx="home"]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm'); await W(() => document.querySelector('#sxText'));
    C('[data-sx="gifs"]'); await W(() => document.querySelector('.sx-gif-pick'), 15000); document.querySelector('.sx-gif-pick').click();
    await W(() => document.querySelector('.sx-msg .sx-gif') && !document.querySelector('.sx-msg.sending'), 20000);
    await heard('ack-gif'); return 'gif sent and seen';
  }, { wait: 500 }),
  S(async () => {
    C('.sx-chat-head [data-sx^="call:"]');
    await W(() => /^\d+:\d\d$/.test((document.querySelector('.sx-call-time') || {}).textContent || ''), 60000);
    C('[data-cc=together]'); await W(() => document.querySelector('.sx-wt-menu'));
    document.querySelector('.sx-wt-menu button').click();
    await W(() => document.querySelector('#dlg .dlg-in'), 5000);
    const i = document.querySelector('#dlg .dlg-in'); i.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; document.querySelector('#dlg [data-r="1"]').click();
    const f = await W(() => document.querySelector('.sx-watch iframe'), 10000); let st = -1;
    addEventListener('message', e => { try { const d = JSON.parse(e.data); if (d.info && typeof d.info.playerState === 'number' && e.source === f.contentWindow) st = d.info.playerState; } catch (er) {} });
    await W(() => st === 1, 40000);
    await new Promise(r => setTimeout(r, 6000));
    f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [], id: 1, channel: 'widget' }), 'https://www.youtube-nocookie.com');
    await W(() => st === 2, 10000);
    return { video: f.src.split('?')[0], paused: true };
  }, { wait: 300, shot: "V2-watch-shadow.png" }),
  S(async () => { await heard('ack-paused', 60000); C('[data-cc=end]'); await W(() => !document.querySelector('.sx-stage')); return 'ended'; }),
];

const B = [
  { wait: 17000, js: H + "; return 1" },
  S(async () => { await signUp("bella@test.local", "bella.b", "Bella"); return "B"; }),
  S(async () => { await W(() => document.querySelector('.rbtn[data-view=social] .rcount'), 90000); C('[data-sx="go:requests"]'); await W(() => document.querySelector('[data-sx^="accept:"]')); C('[data-sx^="accept:"]'); await W(() => document.querySelector('.sx-dm')); return 'friends'; }),
  S(async () => { await W(() => /Playing Fortnite/.test(document.querySelector('.sx-dms').innerText), 60000); return document.querySelector('.sx-dm small').textContent; }),
  S(async () => {
    C('.sx-dm'); await W(() => document.querySelector('.sx-inv-card [data-sx^="joininv:"]'), 90000); C('.sx-inv-card [data-sx^="joininv:"]');
    await W(() => document.querySelector('.sx-chat-head.ch'), 20000);
    await W(() => document.querySelector('.sx-vmem'), 60000);
    C('.sx-chan.voice'); await W(() => document.querySelector('.sx-vpanel'), 20000);
    const { VoiceChat } = await import('./js/social/vchat.js');
    await W(() => VoiceChat.state().peers.some(p => p.state === 'connected'), 60000);
    const ring = await W(() => [...document.querySelectorAll('.sx-vmem.speaking')].some(e => /Shadow/.test(e.innerText)), 20000).then(() => true, () => false);
    await ack('ack-voice');
    return { connected: true, shadowRingsWhenTalking: ring };
  }, { wait: 600, shot: "V3-voice-bella.png" }),
  S(async () => { await W(() => [...document.querySelectorAll('.sx-vmem')].some(e => /Shadow/.test(e.innerText) && e.querySelector('svg')), 30000); await ack('ack-mute'); return 'sees Shadow muted'; }),
  S(async () => { await W(() => /typing/.test(document.querySelector('#sxTyping').innerText), 30000); const t = document.querySelector('#sxTyping').innerText; await ack('ack-typing'); return t; }, { wait: 300, shot: "V4-typing.png" }),
  S(async () => { await W(() => ![...document.querySelectorAll('.sx-vmem')].some(e => /Shadow/.test(e.innerText)), 30000); C('[data-sx="vleave"]'); await W(() => !document.querySelector('.sx-vpanel'), 10000);
    C('[data-sx="home"]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm'); await W(() => document.querySelector('.sx-msg .sx-gif'), 60000); await ack('ack-gif'); return 'got the GIF'; }),
  S(async () => {
    await W(() => document.querySelector('#sxIncoming'), 90000); C('#sxIncoming [data-in=voice]');
    const f = await W(() => document.querySelector('.sx-watch iframe'), 60000); let st = -1;
    addEventListener('message', e => { try { const d = JSON.parse(e.data); if (d.info && typeof d.info.playerState === 'number' && e.source === f.contentWindow) st = d.info.playerState; } catch (er) {} });
    await W(() => st === 1, 40000);
    await W(() => st === 2, 40000);
    await ack('ack-paused');
    return { video: f.src.split('?')[0], pausedBecauseShadowPaused: true };
  }, { wait: 300, shot: "V5-watch-bella.png" }),
  S(async () => { await W(() => !document.querySelector('.sx-stage'), 60000); return 'call over'; }),
];
fs.writeFileSync(path.join(out, "va.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "vb.json"), JSON.stringify(B, null, 1));
console.log("voice steps written");
