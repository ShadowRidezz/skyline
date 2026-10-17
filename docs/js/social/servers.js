// Servers: a place for a group of friends, with text channels. The bar of server icons, a server's channel
// list, its members, invites (codes you share, and cards in messages), and the owner's / admins' settings.
import { $, esc, sky, toast, dialog } from "../util.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { VoiceChat } from "./vchat.js";
import { S, emit, avatar, badgesHtml, statusOf, STATUS, initials, friend, playingText } from "./state.js";

const members = new Map();        // server id -> [member]
const memberLoads = new Map();    // server id -> promise
const invites = new Map();        // code -> invite preview | null (no good) | "loading"
let loadT = 0;
const TEMPLATES = [["friends", "Friends", "general, memes, music", "heart"], ["gaming", "Gaming", "general, clips, looking-for-group", "gamepad"],
  ["study", "Study group", "general, homework-help, resources", "book"], ["blank", "Start from scratch", "just #general", "plus"]];

const server = id => (S.servers || []).find(s => s.id === id) || null;
function channel(id) { for (const s of S.servers || []) { const c = s.channels.find(x => x.id === id); if (c) return { ...c, server_id: s.id }; } return null; }
const rawChannel = id => { for (const s of S.servers || []) { const c = s.channels.find(x => x.id === id); if (c) return c; } return null; };
const isAdmin = sid => { const s = server(sid); return !!s && (s.role === "owner" || s.role === "admin"); };
const unreadOf = cid => (rawChannel(cid) || {}).unread || 0;
const serverUnread = s => s.channels.reduce((n, c) => n + (c.unread || 0), 0);
const serverMentions = s => s.channels.reduce((n, c) => n + (c.mentions || 0), 0);
export const mentionTotal = () => (S.servers || []).reduce((n, s) => n + serverMentions(s), 0);

async function load() {
  try { S.servers = (await api.rpc("get_servers")) || []; } catch (e) { S.servers = S.servers || []; return; }
  // a server you left (or were removed from) while looking at it
  if (S.view.kind === "channel" && !channel(S.view.id)) { const sv = server(S.view.server); S.view = sv ? { kind: "channel", id: firstChannel(sv), server: sv.id } : { kind: "friends" }; }
  emit("servers");
  const v = VoiceChat.state(); if (v.channel) { const c = rawChannel(v.channel); VoiceChat.sync(c ? c.voice : []); if (!c) VoiceChat.leave(true); }
}
const loadSoon = () => { clearTimeout(loadT); loadT = setTimeout(load, 400); };
function firstChannel(sv) { const text = sv.channels.filter(c => c.kind !== "voice"), last = (S.settings.lastChannel || {})[sv.id]; return (text.find(c => c.id === last) || text[0] || {}).id; }
async function loadMembers(sid, force) {
  if (!force && members.has(sid)) return members.get(sid);
  if (!force && memberLoads.has(sid)) return memberLoads.get(sid);
  const p = api.rpc("get_members", { p_server: sid }).then(list => { members.set(sid, list || []); memberLoads.delete(sid); emit("members"); return list; }).catch(() => { memberLoads.delete(sid); return members.get(sid) || []; });
  memberLoads.set(sid, p); return p;
}
const memberList = sid => members.get(sid) || [];
const member = (sid, uid) => memberList(sid).find(m => m.id === uid) || null;
const memberByName = (sid, low) => memberList(sid).some(m => m.username.toLowerCase() === low);
const roleOf = (sid, uid) => (member(sid, uid) || {}).role || "";

// read: the counts clear (the server remembers how far you read)
function markRead(cid) {
  const c = rawChannel(cid); if (!c) return;
  if (c.unread || c.mentions || c._dirty) { c.unread = 0; c.mentions = 0; c._dirty = false; emit("servers"); api.rpc("mark_channel_read", { p_channel: cid }).catch(() => {}); }
}
function bump(cid, you) { const c = rawChannel(cid); if (!c) return; c.unread = Math.min(100, (c.unread || 0) + 1); if (you) c.mentions = Math.min(100, (c.mentions || 0) + 1); c._dirty = true; emit("servers"); }
const notifyLevel = sid => ((S.settings.serverNotify || {})[sid]) || "all";

/* ================= the bar of servers (far left) ================= */
function iconHtml(s, size = 44) {
  return s.icon ? `<img src="${esc(s.icon)}" alt="" draggable="false"${/\.gif$|-anim\./.test(s.icon) ? " data-anim" : ""}>`
    : `<span style="font-size:${Math.round(size * .36)}px">${esc(initials(s.name))}</span>`;
}
function renderRail() {
  const el = $("#sxRail"); if (!el || !S.me) return;
  const v = S.view, home = v.kind !== "channel", dmUnread = S.friends.reduce((n, f) => n + (f.unread || 0), 0);
  el.innerHTML = `<button class="sx-rail-i sx-rail-dms${home ? " on" : ""}" data-sx="home" title="Direct messages" aria-label="Direct messages">${icon("message")}${dmUnread ? `<b class="sx-rail-n">${dmUnread > 99 ? "99+" : dmUnread}</b>` : ""}</button>
    <i class="sx-rail-sep"></i>
    ${(S.servers || []).map(s => { const on = v.kind === "channel" && v.server === s.id, un = serverUnread(s), me = serverMentions(s);
      return `<button class="sx-rail-i${on ? " on" : ""}${un && !on ? " unread" : ""}" data-sx="server:${s.id}" data-srv="${s.id}" title="${esc(s.name)}" aria-label="${esc(s.name)}${me ? `, ${me} mentions` : un ? ", unread messages" : ""}">${iconHtml(s)}${me ? `<b class="sx-rail-n">${me > 99 ? "99+" : me}</b>` : ""}</button>`; }).join("")}
    <button class="sx-rail-i add" data-sx="newserver" title="Add a server" aria-label="Add a server">${icon("plus")}</button>`;
}

/* ================= a server's sidebar: its name, its channels ================= */
function renderSide(el) {
  const sv = server(S.view.server); if (!sv) return false;
  const admin = isAdmin(sv.id);
  el.innerHTML = `<button class="sx-srv-head" data-sx="srvmenu:${sv.id}" aria-haspopup="menu" title="Server options"><b>${esc(sv.name)}</b>${icon("chevron")}</button>
    <div class="sx-sec"><span>Text channels</span><span class="sp"></span>${admin ? `<button class="ibtn xs" data-sx="newchannel:${sv.id}" title="Create channel" aria-label="Create channel">${icon("plus")}</button>` : ""}</div>
    <div class="sx-chans">${sv.channels.filter(c => c.kind !== "voice").map(c => { const on = S.view.id === c.id;
      return `<button class="sx-chan${on ? " on" : ""}${c.unread && !on ? " unread" : ""}" data-sx="channel:${c.id}" data-cid="${c.id}" title="${esc(c.topic || "#" + c.name)}">${icon("hash")}<span>${esc(c.name)}</span>${c.mentions && !on ? `<b class="sx-pill">${c.mentions > 99 ? "99+" : c.mentions}</b>` : ""}${admin ? `<span class="sx-chan-gear" data-sx="editchannel:${c.id}" title="Edit channel" role="button" aria-label="Edit channel">${icon("settings")}</span>` : ""}</button>`; }).join("")}</div>
    ${voiceList(sv, admin)}
    <div class="sx-voiceslot" id="sxVoiceSlot">${voicePanel()}</div>
    <div class="sx-callslot" id="sxCallSlot"></div>
    <div class="sx-me" id="sxMe"></div>`;
  return true;
}
// voice channels, with who's in each (a green ring while they talk)
function voiceList(sv, admin) {
  const vs = sv.channels.filter(c => c.kind === "voice"); if (!vs.length && !admin) return "";
  const mine = VoiceChat.state().channel;
  return `<div class="sx-sec"><span>Voice channels</span><span class="sp"></span>${admin ? `<button class="ibtn xs" data-sx="newvoice:${sv.id}" title="Create voice channel" aria-label="Create voice channel">${icon("plus")}</button>` : ""}</div>
    <div class="sx-vchans">${vs.map(c => { const people = c.voice || [], here = mine === c.id;
      return `<button class="sx-chan voice${here ? " on" : ""}" data-sx="vjoin:${c.id}" data-cid="${c.id}" title="${here ? "You're here" : "Join " + esc(c.name)}">${icon("speaker")}<span>${esc(c.name)}</span>${people.length ? `<em>${people.length}</em>` : ""}${admin ? `<span class="sx-chan-gear" data-sx="editchannel:${c.id}" title="Edit channel" role="button" aria-label="Edit channel">${icon("settings")}</span>` : ""}</button>
        ${people.length ? `<div class="sx-vmems">${people.map(p => `<div class="sx-vmem" data-vu="${p.id}">${avatar(p, 22)}<span>${esc(p.display_name)}</span>${p.live ? (here && p.id !== S.me.id ? `<button class="sx-live-pill" data-sx="vwatch:${p.id}" title="Watch ${esc(p.display_name)}'s screen">LIVE</button>` : `<b class="sx-live-pill" title="${p.id === S.me.id ? "You're live" : "Join the channel to watch"}">LIVE</b>`) : ""}${p.deafened ? icon("headphonesOff") : p.muted ? icon("micOff") : ""}</div>`).join("")}</div>` : ""}`; }).join("")
      || `<p class="sx-side-empty">No voice channels yet.</p>`}</div>`;
}
// you're in voice: where, and mute / deafen / leave (shown on every Social page)
export function voicePanel() {
  const v = VoiceChat.state(); if (!v.channel) return "";
  const c = channel(v.channel), sv = server(v.server), ok = v.peers.filter(p => p.state === "connected").length, all = v.peers.length;
  return `<div class="sx-vpanel"><div class="sx-vpanel-t"><b><i class="sx-live-dot"></i>Voice connected</b><small>${c ? esc(c.name) : "Voice"} · ${sv ? esc(sv.name) : ""}${all ? ` · ${ok}/${all} connected` : " · just you"}</small>${v.noMic ? `<small class="bad">No microphone: they can't hear you</small>` : ""}</div>
    <div class="sx-vpanel-b"><button class="sx-cbtn sm${v.muted ? " off" : ""}" data-sx="vmute" title="${v.muted ? "Unmute" : "Mute"}" aria-label="${v.muted ? "Unmute" : "Mute"}" aria-pressed="${v.muted}">${icon(v.muted ? "micOff" : "mic")}</button>
      <button class="sx-cbtn sm${v.deafened ? " off" : ""}" data-sx="vdeafen" title="${v.deafened ? "Undeafen" : "Deafen (hear nobody)"}" aria-label="Deafen" aria-pressed="${v.deafened}">${icon(v.deafened ? "headphonesOff" : "headphones")}</button>
      <button class="sx-cbtn sm${v.live ? " live" : ""}" data-sx="vlive" title="${v.live ? `Stop streaming${v.viewers ? ` (${v.viewers} watching)` : ""}` : "Go Live: share your screen with the channel"}" aria-label="Go Live" aria-pressed="${v.live}">${icon(v.live ? "screenOff" : "screen")}</button>
      <button class="sx-cbtn sm end" data-sx="vleave" title="Leave voice" aria-label="Leave voice">${icon("phoneOff")}</button></div>
    ${v.live ? `<small class="sx-vlive-t">Live${v.viewers ? ` · ${v.viewers} watching` : " · nobody watching yet"}</small>` : ""}</div>`;
}

/* ================= members (the right-hand panel) ================= */
function renderMembers(el, sid) {
  const sv = server(sid); if (!sv) return;
  const list = memberList(sid), close = `<button class="ibtn" data-sx="closepanel" title="Close" aria-label="Close members">${icon("x")}</button>`;
  if (!members.has(sid)) { el.innerHTML = `<div class="sx-panel-head"><b>Members</b><span class="sp"></span>${close}</div><div class="sx-panel-load"><span class="sx-spin"></span></div>`; loadMembers(sid); return; }
  const on = list.filter(m => (m.status || "offline") !== "offline"), off = list.filter(m => (m.status || "offline") === "offline");
  const row = m => { const st = m.id === S.me.id ? (S.shown || "online") : m.status || "offline", d = m.details || {};
    return `<button class="sx-mem${st === "offline" ? " off" : ""}" data-sx="profile:${m.id}" data-mem="${m.id}">${avatar(m, 32, st, d.decoration)}<span class="sx-mem-t"><b class="${m.role === "owner" || m.role === "admin" ? "sx-role-" + m.role : ""}">${esc(m.display_name)}${m.role === "owner" ? `<i class="sx-role-ic" title="Server owner">${icon("crown")}</i>` : ""}</b>
      <small>${m.activity && m.activity.game && st !== "offline" ? `<span class="sx-playing">${esc(playingText(m.activity))}</span>` : d.status_text || d.status_emoji ? esc(((d.status_emoji || "") + " " + (d.status_text || "")).trim()) : m.role === "admin" ? "Admin" : st !== "offline" ? STATUS[st].label : "@" + esc(m.username)}</small></span>${badgesHtml((m.badges || []).slice(0, 2), true)}</button>`; };
  el.innerHTML = `<div class="sx-panel-head"><b>Members</b><small>${list.length}</small><span class="sp"></span>${close}</div>
    <div class="sx-mems">${on.length ? `<div class="sx-group">Online — ${on.length}</div>` + on.map(row).join("") : ""}${off.length ? `<div class="sx-group">Offline — ${off.length}</div>` + off.map(row).join("") : ""}</div>
    <div class="sx-mem-acts"><button class="btn sm primary sx-wide" data-sx="invite:${sid}">${icon("userPlus")}Invite people</button></div>`;
}

/* ================= invites: cards in messages ================= */
function inviteCard(code) {
  const v = invites.get(code);
  if (v === undefined || v === "loading") return `<div class="sx-inv-card loading"><span class="sx-inv-ic sx-skel"></span><span class="sx-inv-t"><small>You've been invited to a server</small><b class="sx-skel line"></b></span></div>`;
  if (!v) return `<div class="sx-inv-card bad"><span class="sx-inv-ic">${icon("x")}</span><span class="sx-inv-t"><small>Invite</small><b>This invite doesn't work any more</b><em>It may have run out, or been removed.</em></span></div>`;
  return `<div class="sx-inv-card"><span class="sx-inv-ic">${iconHtml(v, 48)}</span><span class="sx-inv-t"><small>You've been invited to a server</small><b>${esc(v.name)}</b><em><i class="sx-dot online"></i>${v.online} online <i class="sx-dot offline"></i>${v.member_count} member${v.member_count === 1 ? "" : "s"}</em></span>
    ${v.member ? `<button class="btn sm" data-sx="server:${v.server_id}">Open</button>` : `<button class="btn sm primary" data-sx="joininv:${v.code}">Join</button>`}</div>`;
}
async function invitePreview(code, force) {
  if (!force && invites.has(code) && invites.get(code) !== "loading") return invites.get(code);
  if (invites.get(code) === "loading" && !force) return null;
  invites.set(code, "loading");
  try { invites.set(code, (await api.rpc("get_invite", { p_code: code })) || null); } catch (e) { invites.delete(code); return null; }
  document.querySelectorAll(`.sx-invite[data-invite="${code}"]`).forEach(x => { x.innerHTML = inviteCard(code); });
  return invites.get(code);
}
function fillInvites(root) { root.querySelectorAll(".sx-invite[data-invite]").forEach(x => { const c = x.dataset.invite; if (!invites.has(c)) invitePreview(c); }); }
async function join(code) {
  try {
    const sid = await api.rpc("join_server", { p_code: code });
    await load(); invites.delete(code); await invitePreview(code, true);
    const sv = server(sid); if (sv) { toast(`Welcome to ${sv.name}`); go(sid); }
    return sid;
  } catch (e) { toast(e.message, true); invitePreview(code, true); return null; }
}

/* ================= opening ================= */
function go(sid, cid) {
  const sv = server(sid); if (!sv) return;
  const id = cid || firstChannel(sv); if (!id) return;
  S.settings.lastChannel = { ...(S.settings.lastChannel || {}), [sid]: id }; saveSettings();
  import("./social.js").then(m => m.open({ kind: "channel", id, server: sid }));
}
function saveSettings() { clearTimeout(saveSettings.t); saveSettings.t = setTimeout(() => api.rpc("save_settings", { p_data: S.settings }).catch(() => {}), 800); }

/* ================= dialogs ================= */
function modal(html, cls = "") {
  const m = $("#dlg"); m.innerHTML = `<div class="dlg-box sx-srv-dlg ${cls}" role="dialog" aria-modal="true">${html}</div>`; m.classList.remove("hidden");
  const close = () => { m.classList.add("hidden"); m.onclick = m.oninput = m.onchange = m.onsubmit = null; document.removeEventListener("keydown", key, true); };
  const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", key, true);
  return { m, close };
}
const head = title => `<div class="sx-add-head"><h3>${esc(title)}</h3><span class="sp"></span><button class="ibtn" data-d="close" aria-label="Close">${icon("x")}</button></div>`;

// add a server: make your own (from a template), or join one with an invite
function addServer(tab = "create") {
  let tpl = "friends", pic = null, busy = false;
  const draw = () => tab === "create" ? `${head("Create a server")}
      <p class="sx-add-sub">A place for you and your friends, with text channels. Pick a start; you can change everything later.</p>
      <div class="sx-tpls">${TEMPLATES.map(([k, l, d, ic]) => `<button class="sx-tpl${tpl === k ? " on" : ""}" data-d="tpl:${k}"><span class="sx-tpl-ic">${icon(ic)}</span><span><b>${l}</b><small>${d}</small></span></button>`).join("")}</div>
      <div class="sx-srv-new"><button class="sx-srv-pic" data-d="pic" title="Add a picture" aria-label="Add a server picture">${pic ? `<img src="${esc(pic)}" alt="">` : `${icon("image")}<small>Picture</small>`}</button>
        <label class="sx-field"><span>Server name</span><input id="sxSrvName" maxlength="50" placeholder="${esc(S.me.display_name)}'s server" spellcheck="false" autocomplete="off"></label></div>
      <div class="dlg-acts"><button class="btn ghost" data-d="tab:join">Join a server instead</button><span class="sp"></span><button class="btn primary" data-d="create" ${busy ? "disabled" : ""}>Create server</button></div>`
    : `${head("Join a server")}
      <p class="sx-add-sub">Paste the invite a friend sent you. It looks like <b class="sx-mono">sky:invite/AbCd2345</b> or just <b class="sx-mono">AbCd2345</b>.</p>
      <label class="sx-field"><span>Invite</span><input id="sxInvCode" maxlength="40" placeholder="sky:invite/AbCd2345" spellcheck="false" autocomplete="off"></label>
      <div id="sxInvPrev"></div>
      <div class="dlg-acts"><button class="btn ghost" data-d="tab:create">Create one instead</button><span class="sp"></span><button class="btn primary" data-d="join" disabled>Join server</button></div>`;
  const { m, close } = modal(draw(), "sx-add-srv");
  const focus = () => setTimeout(() => (m.querySelector("#sxSrvName") || m.querySelector("#sxInvCode")).focus(), 20);
  focus();
  const codeOf = v => (/([A-Za-z0-9]{8})\s*$/.exec(String(v || "").trim()) || [])[1] || null;
  let t = 0;
  m.oninput = e => {
    if (e.target.id !== "sxInvCode") return;
    const code = codeOf(e.target.value), btn = m.querySelector('[data-d="join"]'), prev = m.querySelector("#sxInvPrev");
    btn.disabled = true; clearTimeout(t);
    if (!code) { prev.innerHTML = ""; return; }
    prev.innerHTML = `<div class="sx-invite">${inviteCard("__wait")}</div>`;
    t = setTimeout(async () => { const v = await invitePreview(code, true); if (codeOf(m.querySelector("#sxInvCode")?.value) !== code) return;
      prev.innerHTML = `<div class="sx-invite">${inviteCard(code).replace(/<button[^>]*data-sx="(?:joininv|server):[^"]*"[^>]*>.*?<\/button>/, "")}</div>`; btn.disabled = !v; if (v && v.member) btn.textContent = "Open server"; }, 300);
  };
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-d]"); if (!b) return;
    const [a, x] = b.dataset.d.split(/:(.*)/);
    if (a === "close") return close();
    if (a === "tab") { tab = x; m.firstElementChild.innerHTML = draw(); return focus(); }
    if (a === "tpl") { tpl = x; m.querySelectorAll(".sx-tpl").forEach(p => p.classList.toggle("on", p.dataset.d === "tpl:" + x)); return; }
    if (a === "pic") { const url = await pickPicture(); if (url) { pic = url; b.innerHTML = `<img src="${esc(url)}" alt="">`; } return; }
    if (a === "create") {
      const name = (m.querySelector("#sxSrvName").value.trim() || `${S.me.display_name}'s server`).slice(0, 50);
      b.disabled = true;
      try { const sid = await api.rpc("create_server", { p_name: name, p_icon: pic, p_template: tpl }); close(); await load(); go(sid); toast(`${name} is ready. Invite your friends!`); setTimeout(() => inviteDialog(sid), 500); }
      catch (er) { toast(er.message, true); b.disabled = false; }
    }
    if (a === "join") { const code = codeOf(m.querySelector("#sxInvCode").value); if (!code) return; b.disabled = true; const sid = await join(code); if (sid) close(); else b.disabled = false; }
  };
}
// a server picture: square, resized here, uploaded to your own folder
async function pickPicture() {
  const file = await new Promise(res => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp,image/gif"; i.onchange = () => res(i.files[0] || null); i.click(); });
  if (!file) return null;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast("Use a PNG, JPG, WebP or GIF picture.", true); return null; }
  try {
    let bytes;
    if (file.type === "image/gif") bytes = await file.arrayBuffer();
    else { const bmp = await createImageBitmap(file), side = Math.min(bmp.width, bmp.height), out = Math.min(256, side), cv = new OffscreenCanvas(out, out), g = cv.getContext("2d");
      g.imageSmoothingQuality = "high"; g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out); bytes = await (await cv.convertToBlob({ type: "image/webp", quality: .9 })).arrayBuffer(); }
    if (bytes.byteLength > 4 * 1048576) { toast("That picture is too big (4 MB max).", true); return null; }
    return (await api.upload("server", bytes)).url;
  } catch (e) { toast(e.message, true); return null; }
}

// invite people: a code to share, and your friends with a Send button
async function inviteDialog(sid) {
  const sv = server(sid); if (!sv) return;
  let opt = (S.settings.inviteOpt || "7d"), code = null, sent = new Set();
  const OPTS = [["7d", "7 days", 168, null], ["1d", "1 day", 24, null], ["never", "Never expires", null, null], ["once", "One use", 168, 1]];
  const make = async () => { const o = OPTS.find(x => x[0] === opt) || OPTS[0]; code = null; paint(); try { code = await api.rpc("create_invite", { p_server: sid, p_max_uses: o[3], p_hours: o[2] }); } catch (e) { toast(e.message, true); } paint(); };
  const inServer = new Set(memberList(sid).map(m => m.id));
  const draw = () => `${head("Invite friends to " + sv.name)}
    <div class="sx-inv-friends">${S.friends.length ? S.friends.map(f => `<div class="sx-row static">${avatar(f, 34, statusOf(f))}<span class="sx-row-t"><b>${esc(f.display_name)}</b><small>@${esc(f.username)}</small></span>
      <span class="sx-row-acts show">${inServer.has(f.id) ? `<span class="sx-pending">In the server</span>` : `<button class="btn sm${sent.has(f.id) ? "" : " primary"}" data-d="send:${f.id}" ${sent.has(f.id) || !code ? "disabled" : ""}>${sent.has(f.id) ? "Sent" : "Invite"}</button>`}</span></div>`).join("") : `<p class="sx-none">Add friends first, or share the invite below.</p>`}</div>
    <div class="sx-field"><span>Or send them this invite</span><div class="sx-inv-code"><code class="sx-mono" id="sxInvOut">${code ? "sky:invite/" + esc(code) : "Making an invite…"}</code><button class="btn sm primary" data-d="copy" ${code ? "" : "disabled"}>${icon("copy")}Copy</button></div>
      <small>Expires: <select class="sx-select sm" id="sxInvOpt">${OPTS.map(([k, l]) => `<option value="${k}" ${k === opt ? "selected" : ""}>${l}</option>`).join("")}</select> Anyone with it can join, so only share it with people you want in.</small></div>`;
  const paint = () => { const box = $("#dlg .sx-inv-dlg"); if (box) box.innerHTML = draw(); };
  const { m, close } = modal(draw(), "sx-inv-dlg");
  loadMembers(sid).then(list => { list.forEach(x => inServer.add(x.id)); paint(); });
  make();
  m.onchange = e => { if (e.target.id === "sxInvOpt") { opt = e.target.value; S.settings.inviteOpt = opt; saveSettings(); make(); } };
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-d]"); if (!b) return;
    const [a, x] = b.dataset.d.split(/:(.*)/);
    if (a === "close") return close();
    if (a === "copy" && code) (sky.copy ? sky.copy("sky:invite/" + code) : navigator.clipboard.writeText("sky:invite/" + code)).then(() => toast("Invite copied")).catch(() => toast("Couldn't copy", true));
    if (a === "send" && code) {
      b.disabled = true;
      try { await api.rpc("send_message", { p_to: x, p_body: `Join my server ${sv.name} on Skyline: sky:invite/${code}`, p_client_id: "inv" + Date.now().toString(36) + x.slice(0, 6) }); sent.add(x); paint(); }
      catch (er) { toast(er.message, true); b.disabled = false; }
    }
  };
}

// a channel: make one, or change / delete it
async function channelDialog(sid, cid, kind = "text") {
  const sv = server(sid), c = cid ? rawChannel(cid) : null; if (!sv) return;
  if (c) kind = c.kind || "text";
  const { m, close } = modal(`${head(c ? "Edit " + (kind === "voice" ? "" : "#") + c.name : "Create a channel")}
    ${c ? "" : `<div class="sx-radio sx-chkind">${[["text", "Text", "Messages, pictures, GIFs and stickers", "hash"], ["voice", "Voice", "Hang out and talk, up to 10 people", "speaker"]].map(([k, l, d, ic]) => `<label><input type="radio" name="sxChKind" value="${k}" ${kind === k ? "checked" : ""}><span><b>${icon(ic)}${l}</b><small>${d}</small></span></label>`).join("")}</div>`}
    <label class="sx-field"><span>Channel name</span><div class="sx-at"><i>#</i><input id="sxChName" maxlength="32" value="${esc(c ? c.name : "")}" placeholder="new-channel" spellcheck="false" autocomplete="off"></div><small id="sxChHint">Lowercase letters, numbers and dashes. Spaces become dashes.</small></label>
    <label class="sx-field"><span>Topic</span><input id="sxChTopic" maxlength="200" value="${esc(c ? c.topic : "")}" placeholder="What's this channel for? (optional)" autocomplete="off"></label>
    <div class="dlg-acts">${c ? `<button class="btn danger" data-d="delete">${icon("trash")}Delete channel</button>` : ""}<span class="sp"></span><button class="btn ghost" data-d="close">Cancel</button><button class="btn primary" data-d="save">${c ? "Save" : "Create channel"}</button></div>`);
  const name = m.querySelector("#sxChName"); name.focus(); name.select();
  const tidy = v => v.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").replace(/^-+|-+$/g, "").slice(0, 32);
  m.oninput = e => { if (e.target === name) $("#sxChHint").textContent = name.value.trim() ? `It'll be #${tidy(name.value) || "…"}` : "Lowercase letters, numbers and dashes. Spaces become dashes."; };
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-d]"); if (!b) return; const a = b.dataset.d;
    if (a === "close") return close();
    if (a === "save") {
      if (!tidy(name.value)) return name.focus();
      b.disabled = true;
      try {
        if (c) await api.rpc("update_channel", { p_channel: c.id, p_name: name.value, p_topic: m.querySelector("#sxChTopic").value });
        else { const k = (m.querySelector('input[name="sxChKind"]:checked') || {}).value || "text";
          const id = await api.rpc("create_channel", { p_server: sid, p_name: name.value, p_topic: m.querySelector("#sxChTopic").value, p_kind: k }); close(); await load(); return k === "voice" ? VoiceChat.join(id, sid) : go(sid, id); }
        close(); await load();
      } catch (er) { toast(er.message, true); b.disabled = false; }
    }
    if (a === "delete") {
      close();
      if (!(await dialog({ title: `Delete #${c.name}?`, text: "Every message in it is deleted for everyone. This can't be undone.", ok: "Delete channel", danger: true }))) return;
      try { await api.rpc("delete_channel", { p_channel: c.id }); import("./chat.js").then(x => x.Chat.forget("ch:" + c.id)); await load(); if (S.view.id === c.id) go(sid); } catch (er) { toast(er.message, true); }
    }
  };
  m.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); m.querySelector('[data-d="save"]').click(); } });
}

// server settings (admins): overview, members, invites; the owner can delete it
async function settingsDialog(sid, tab = "overview") {
  const sv = server(sid); if (!sv) return;
  const owner = sv.role === "owner"; let pic = sv.icon, invs = null;
  const TABS = [["overview", "Overview", "settings"], ["members", "Members", "users"], ["invites", "Invites", "userPlus"], ["notify", "Notifications", "bell"], ...(owner ? [["danger", "Delete server", "trash"]] : [])];
  const body = () => {
    if (tab === "overview") return `<div class="sx-srv-new"><button class="sx-srv-pic big" data-d="pic" title="Change picture">${pic ? `<img src="${esc(pic)}" alt="">` : `${icon("image")}<small>Picture</small>`}</button>
        <div class="sx-srv-fields"><label class="sx-field"><span>Server name</span><input id="sxSvName" maxlength="50" value="${esc(sv.name)}" autocomplete="off"></label>
        ${pic ? `<button class="sx-link" data-d="nopic">Remove picture</button>` : ""}</div></div>
      <label class="sx-field"><span>Description</span><textarea id="sxSvDesc" maxlength="300" rows="3" placeholder="What's this server about?">${esc(sv.description || "")}</textarea></label>
      <div class="sx-form-acts"><button class="btn primary sm" data-d="saveover">Save changes</button></div>`;
    if (tab === "members") { const list = memberList(sid);
      return `<div class="sx-srv-mems">${list.map(x => `<div class="sx-row static">${avatar(x, 34, x.status)}<span class="sx-row-t"><b>${esc(x.display_name)}${x.id === S.me.id ? " (you)" : ""}</b><small>@${esc(x.username)} · ${x.role === "owner" ? "Owner" : x.role === "admin" ? "Admin" : "Member"}</small></span>
        <span class="sx-row-acts show">${x.role === "owner" || x.id === S.me.id ? "" : `${owner ? `<button class="btn sm" data-d="role:${x.id}:${x.role === "admin" ? "member" : "admin"}">${x.role === "admin" ? "Remove admin" : "Make admin"}</button>` : ""}${owner || x.role === "member" ? `<button class="btn sm danger" data-d="kick:${x.id}">Remove</button>` : ""}`}</span></div>`).join("")}</div>
        <p class="sx-set-note">Admins can make and edit channels, delete messages, manage invites and remove members. Only you, the owner, choose admins.</p>`; }
    if (tab === "invites") return invs == null ? `<div class="sx-panel-load"><span class="sx-spin"></span></div>` : invs.length ? `<div class="sx-srv-invs">${invs.map(i => `<div class="sx-row static"><span class="sx-note-ic">${icon("userPlus")}</span><span class="sx-row-t"><b class="sx-mono">${esc(i.code)}</b><small>by ${esc(i.by.display_name)} · ${i.uses} use${i.uses === 1 ? "" : "s"}${i.max_uses ? " of " + i.max_uses : ""} · ${i.expires_at ? "expires " + new Date(i.expires_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "never expires"}</small></span><span class="sx-row-acts show"><button class="btn sm danger" data-d="revoke:${esc(i.code)}">Revoke</button></span></div>`).join("")}</div>` : `<p class="sx-none">No active invites.</p>`;
    if (tab === "notify") { const lv = notifyLevel(sid); return `<div class="sx-radio">${[["all", "All messages", "A notification for every new message"], ["mentions", "Only @mentions", "When someone @mentions you or replies to you"], ["none", "Nothing", "Unread counts still show in the server list"]].map(([k, l, d]) => `<label><input type="radio" name="sxNot" value="${k}" ${lv === k ? "checked" : ""}><span><b>${l}</b><small>${d}</small></span></label>`).join("")}</div>`; }
    if (tab === "danger") return `<p>Deleting <b>${esc(sv.name)}</b> removes every channel and message for everyone. This can't be undone.</p><label class="sx-field"><span>Type the server's name to confirm</span><input id="sxDelName" autocomplete="off" spellcheck="false"></label><div class="sx-form-acts"><button class="btn danger-solid" data-d="delete" disabled>Delete server</button></div>`;
    return "";
  };
  const draw = () => `${head(sv.name)}<div class="sx-srv-set"><nav>${TABS.filter(t => isAdmin(sid) || t[0] === "notify").map(([k, l, ic]) => `<button class="${k === tab ? "on" : ""}" data-d="tab:${k}">${icon(ic)}<span>${l}</span></button>`).join("")}</nav><div class="sx-srv-body">${body()}</div></div>`;
  const { m, close } = modal(draw(), "sx-srv-settings");
  const paint = () => { const box = m.querySelector(".sx-srv-settings"); if (box) box.innerHTML = draw(); };
  if (!isAdmin(sid)) { tab = "notify"; paint(); }
  loadMembers(sid, true).then(() => tab === "members" && paint());
  m.oninput = e => { if (e.target.id === "sxDelName") m.querySelector('[data-d="delete"]').disabled = e.target.value.trim() !== sv.name; };
  m.onchange = e => { if (e.target.name === "sxNot") { S.settings.serverNotify = { ...(S.settings.serverNotify || {}), [sid]: e.target.value }; saveSettings(); toast("Saved"); } };
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-d]"); if (!b) return;
    const [a, x, y] = b.dataset.d.split(":");
    try {
      if (a === "close") return close();
      if (a === "tab") { tab = x; paint(); if (x === "invites") { invs = await api.rpc("get_invites", { p_server: sid }).catch(() => []); paint(); } return; }
      if (a === "pic") { const url = await pickPicture(); if (url) { pic = url; paint(); } return; }
      if (a === "nopic") { pic = null; return paint(); }
      if (a === "saveover") { await api.rpc("update_server", { p_server: sid, p_data: { name: m.querySelector("#sxSvName").value.trim(), description: m.querySelector("#sxSvDesc").value.trim(), icon: pic } }); toast("Saved"); await load(); return; }
      if (a === "role") { await api.rpc("set_member_role", { p_server: sid, p_user: x, p_role: y }); await loadMembers(sid, true); return paint(); }
      if (a === "kick") { b.dataset.d = "kickyes:" + x; b.textContent = "Click again to remove"; b.title = "They can come back with a new invite"; return; }   // a second click confirms
      if (a === "kickyes") { await api.rpc("kick_member", { p_server: sid, p_user: x }); await loadMembers(sid, true); return paint(); }
      if (a === "revoke") { await api.rpc("revoke_invite", { p_code: x }); invs = invs.filter(i => i.code !== x); return paint(); }
      if (a === "delete") { await api.rpc("delete_server", { p_server: sid }); close(); toast(`${sv.name} was deleted`); await load(); import("./social.js").then(mm => mm.open({ kind: "friends" })); }
    } catch (er) { toast(er.message, true); }
  };
}

/* ---------- the server's menu (its name at the top of the sidebar) ---------- */
function serverMenu(sid, anchor, menu) {
  const sv = server(sid); if (!sv) return;
  const admin = isAdmin(sid), lv = notifyLevel(sid);
  menu(anchor, [
    { label: "Invite people", icon: "userPlus", run: () => inviteDialog(sid) },
    ...(admin ? [{ label: "Server settings", icon: "settings", run: () => settingsDialog(sid) }, { label: "Create channel", icon: "plus", run: () => channelDialog(sid) }] : []),
    { label: "Notifications", icon: "bell", hint: lv === "all" ? "All" : lv === "mentions" ? "@mentions" : "Off", run: () => settingsDialog(sid, "notify") },
    { label: "Mark as read", icon: "check", run: () => { sv.channels.forEach(c => markRead(c.id)); } },
    { label: "Copy server ID", icon: "copy", run: () => (sky.copy ? sky.copy(sid) : navigator.clipboard.writeText(sid)).then(() => toast("Copied")) },
    ...(sv.role !== "owner" ? ["-", { label: "Leave server", icon: "logOut", danger: true, run: () => leave(sid) }] : []),
  ]);
}
async function leave(sid) {
  const sv = server(sid); if (!sv) return;
  if (!(await dialog({ title: `Leave ${sv.name}?`, text: "You won't see its channels any more. You can come back with a new invite.", ok: "Leave server", danger: true }))) return;
  try { await api.rpc("leave_server", { p_server: sid }); toast(`You left ${sv.name}`); await load(); import("./social.js").then(m => m.open({ kind: "friends" })); }
  catch (e) { toast(e.message, true); }
}

/* ---------- live ---------- */
function onChange(c) {
  if (c.table === "server_members" || c.table === "servers" || c.table === "channels") {
    loadSoon();
    const sid = (c.row && (c.row.server_id || (c.table === "servers" && c.row.id))) || (c.old && (c.old.server_id || c.old.id));
    if (c.table === "server_members" && sid && members.has(sid)) loadMembers(sid, true);
  }
}
// presence of members changes slowly; refresh the open server's list now and then
setInterval(() => { if (S.me && S.view.kind === "channel" && !document.hidden) loadMembers(S.view.server, true); }, 60000);

export const Servers = {
  load, loadSoon, loadMembers, server, channel, isAdmin, unreadOf, members: memberList, member, memberByName, roleOf,
  markRead, bump: (cid, you) => { bump(cid, you); loadSoon(); }, notifyLevel, renderRail, renderSide, renderMembers,
  inviteCard, invitePreview, fillInvites, join, go, addServer, voicePanel, inviteDialog, channelDialog, settingsDialog, serverMenu, onChange, mentionTotal,
  serverUnread, firstChannel,
};
