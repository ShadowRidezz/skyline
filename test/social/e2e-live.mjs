// Writes the step files for the two-person Go Live + GIF favorites test: both in a voice channel, Shadow goes
// live, Bella clicks LIVE and sees his screen, Shadow stops and her viewer closes; then GIF favorites and recents.
// node test/social/e2e-live.mjs <outDir>
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
    await W(() => document.querySelector('.sx-dm'), 60000);
    C('[data-sx="newserver"]'); await W(() => document.querySelector('#sxSrvName')); T('#sxSrvName', 'Night Crew'); C('[data-d="create"]');
    await W(() => document.querySelector('[data-d^="send:"]:not([disabled])'), 20000); C('[data-d^="send:"]'); await W(() => /Sent/.test(document.querySelector('.sx-inv-friends').innerText)); C('#dlg [data-d=close]');
    C('.sx-chan.voice'); await W(() => document.querySelector('.sx-vpanel'), 20000);
    const { VoiceChat } = await import('./js/social/vchat.js');
    await W(() => VoiceChat.state().peers.some(p => p.state === 'connected'), 120000);
    return 'in voice with Bella';
  }),
  // Go Live: the picker, the screen, the LIVE pill
  S(async () => {
    C('[data-sx="vlive"]'); await W(() => document.querySelector('.sx-pick'), 10000); C('.sx-pick'); C('[data-p=go]');
    await W(() => document.querySelector('.sx-vlive-t'), 15000);
    await heard('ack-watching');
    const { VoiceChat } = await import('./js/social/vchat.js');
    return { panel: document.querySelector('.sx-vpanel').innerText.replace(/\s+/g, ' '), viewers: VoiceChat.state().viewers };
  }, { wait: 500, shot: "L1-live-shadow.png" }),
  S(async () => { C('[data-sx="vlive"]'); await W(() => !document.querySelector('.sx-vlive-t'), 10000); await heard('ack-closed'); return 'stopped streaming'; }),
  // GIFs: star one in the picker, find it under Favorites, send it from there; Recent remembers it
  S(async () => {
    C('[data-sx="vleave"]'); await W(() => !document.querySelector('.sx-vpanel'), 10000);
    C('[data-sx="home"]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm'); await W(() => document.querySelector('#sxText'));
    C('[data-sx="gifs"]'); await W(() => document.querySelector('.sx-gif-pick'), 15000);
    C('[data-gt="trending"]'); await W(() => document.querySelector('[data-gstar]'), 15000);
    document.querySelector('[data-gstar="2"]').click();
    C('[data-gt="favs"]'); await W(() => document.querySelectorAll('.sx-gif-pick').length === 1, 5000);
    const favTitle = document.querySelector('.sx-gif-pick').title;
    C('.sx-gif-pick'); await W(() => document.querySelector('.sx-msg .sx-gif') && !document.querySelector('.sx-msg.sending'), 20000);
    C('[data-sx="gifs"]'); await W(() => document.querySelector('[data-gt="recent"]')); C('[data-gt="recent"]');
    await W(() => document.querySelectorAll('.sx-gif-pick').length >= 1, 5000);
    const recent = document.querySelector('.sx-gif-pick').title; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await heard('ack-gif');
    return { favorite: favTitle, recent };
  }, { wait: 400, shot: "L3-gifs.png" }),
];

const B = [
  { wait: 17000, js: H + "; return 1" },
  S(async () => { await signUp("bella@test.local", "bella.b", "Bella"); return "B"; }),
  S(async () => {
    await W(() => document.querySelector('.rbtn[data-view=social] .rcount'), 90000); C('[data-sx="go:requests"]'); await W(() => document.querySelector('[data-sx^="accept:"]')); C('[data-sx^="accept:"]'); await W(() => document.querySelector('.sx-dm'));
    C('.sx-dm'); await W(() => document.querySelector('.sx-inv-card [data-sx^="joininv:"]'), 90000); C('.sx-inv-card [data-sx^="joininv:"]');
    await W(() => document.querySelector('.sx-chat-head.ch'), 20000); await W(() => document.querySelector('.sx-vmem'), 60000);
    C('.sx-chan.voice'); await W(() => document.querySelector('.sx-vpanel'), 20000);
    const { VoiceChat } = await import('./js/social/vchat.js');
    await W(() => VoiceChat.state().peers.some(p => p.state === 'connected'), 60000); return 'in voice';
  }),
  // Shadow's LIVE: watch it
  S(async () => {
    await W(() => document.querySelector('button.sx-live-pill'), 60000); C('button.sx-live-pill');
    const v = await W(() => { const x = document.querySelector('#sxLiveView video'); return x && x.videoWidth > 0 && x; }, 40000);
    const size = v.videoWidth + 'x' + v.videoHeight; return { watching: document.querySelector('#sxLiveView b').textContent, size };
  }, { wait: 1500, shot: "L2-watching-bella.png" }),
  S(async () => { await ack('ack-watching'); return 'told Shadow'; }),
  S(async () => { await W(() => !document.querySelector('#sxLiveView'), 30000); await ack('ack-closed'); return 'viewer closed when he stopped'; }),
  // the GIF arrives; star it in the chat
  S(async () => {
    C('[data-sx="vleave"]'); await W(() => !document.querySelector('.sx-vpanel'), 10000);
    C('[data-sx="home"]'); await W(() => document.querySelector('.sx-dm')); C('.sx-dm');
    await W(() => document.querySelector('.sx-msg .sx-gif'), 60000);
    document.querySelector('.sx-msg .sx-gif [data-gfav]').click();
    const { S: St } = await import('./js/social/state.js');
    await ack('ack-gif');
    return { starredInChat: (St.settings.favGifs || []).length === 1 };
  }),
];
fs.writeFileSync(path.join(out, "la.json"), JSON.stringify(A, null, 1));
fs.writeFileSync(path.join(out, "lb.json"), JSON.stringify(B, null, 1));
console.log("live steps written");
