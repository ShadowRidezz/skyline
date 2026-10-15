// A conversation: with one friend (direct messages) or in a server's channel. History loads in pages as you
// scroll up; live messages, replies, reactions, editing and deleting, pins, search, stickers, emoji, @mentions,
// invite cards and files (pictures, videos, documents). Each kind of conversation is a "target" below.
import { $, $$, esc, sky, toast, dialog } from "../util.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { S, emit, friend, statusOf, avatar, subline, clock, dayLabel, linkify, badgesHtml } from "./state.js";
import { CallUI } from "./callui.js";
import { notify } from "./social.js";
import { pickEmoji, EMOJI_QUICK, closeEmoji } from "./emoji.js";
import { pickSticker, stickerSrc, stickerName, closeStickers } from "./stickers.js";
import { pickGif, closeGifs, gifHtml } from "./gifs.js";
import { Servers } from "./servers.js";

const PAGE = 60, GROUP_MS = 5 * 60e3, MAX_FILES = 6, MAX_FILE = 25 * 1048576;
let cur = null, el = null, reply = null, editing = null, pending = [], menuEl = null, mention = null;
const prefs = () => S.settings.chat || {};
const urls = new Map();   // attachment path -> { url, at }
// typing: tell the other side every few seconds while you type; show who's typing here
const typing = new Map();   // user id -> { key, at }
let typedAt = 0, typedKey = null, typingTimer = 0;
function iAmTyping(key) {
  if (Date.now() - typedAt < 3000 && typedKey === key) return;
  typedAt = Date.now(); typedKey = key;
  const t = T(key); if (!t) return;
  api.rpc("set_typing", t.kind === "dm" ? { p_to: t.id } : { p_channel: t.id }).catch(() => {});
}
function stopTyping() { if (!typedKey) return; typedKey = null; typedAt = 0; api.rpc("set_typing", {}).catch(() => {}); }
function drawTyping() {
  const box = $("#sxTyping"); if (!box) return;
  const now = Date.now(), t = T(), who = [...typing.entries()].filter(([u, x]) => x.key === cur && now - x.at < 7000 && u !== S.me.id).map(([u]) => t ? t.who(u).display_name : "Someone");
  box.innerHTML = who.length ? `<span class="sx-typing-dots"><i></i><i></i><i></i></span><span><b>${esc(who.slice(0, 3).join(", "))}</b> ${who.length === 1 ? "is" : "are"} typing…</span>` : "";
  box.classList.toggle("on", !!who.length);
  clearTimeout(typingTimer); if (who.length) typingTimer = setTimeout(drawTyping, 1500);
}
function onTyping(ch) {
  if (ch.type === "DELETE") { const u = ch.old && ch.old.user_id; if (u && typing.delete(u)) drawTyping(); return; }
  const r = ch.row || {}; if (!r.user_id || r.user_id === S.me.id) return;
  const key = r.channel_id ? "ch:" + r.channel_id : r.to_user === S.me.id ? r.user_id : null;
  if (!key) { typing.delete(r.user_id); return drawTyping(); }
  typing.set(r.user_id, { key, at: Date.now() }); drawTyping();
}

/* ---------- targets: what's different between a direct message and a channel ---------- */
const UNKNOWN = id => ({ id, display_name: "Former member", username: "unknown", accent: "#475569" });
function T(key = cur) {
  if (String(key || "").startsWith("ch:")) {
    const id = key.slice(3), ch = Servers.channel(id), sv = ch && Servers.server(ch.server_id);
    if (!ch || !sv) return null;
    const admin = Servers.isAdmin(sv.id);
    return {
      key, kind: "channel", id, ch, sv, name: "#" + ch.name,
      who: u => u === S.me.id ? S.me : Servers.member(sv.id, u) || UNKNOWN(u),
      load: before => api.rpc("get_channel_messages", { p_channel: id, p_before: before || null, p_limit: PAGE }),
      send: m => api.rpc("send_channel_message", { p_channel: id, p_body: m.body, p_client_id: m.client_id, p_reply_to: m.reply_to, p_kind: m.kind, p_meta: m.kind === "text" ? null : m.meta }),
      fn: { edit: "cm_edit", del: "cm_delete", react: "cm_react", pin: "cm_pin", get: "get_channel_message" },
      search: q => api.rpc("search_channel", { p_channel: id, p_query: q }),
      pins: () => api.rpc("get_channel_pins", { p_channel: id }),
      attach: (name, buf) => api.attach("srv:" + sv.id, name, buf),
      canDelete: m => m.sender === S.me.id || admin,
      canPin: m => m.sender === S.me.id || admin,
      deleteText: "It's removed for everyone in the channel. This can't be undone.",
    };
  }
  const f = friend(key); if (!f) return null;
  return {
    key, kind: "dm", id: key, f, name: f.display_name,
    who: u => u === S.me.id ? S.me : f,
    load: before => api.rpc("get_messages", { p_friend: key, p_before: before || null, p_limit: PAGE }),
    send: m => api.rpc("send_message", { p_to: key, p_body: m.body, p_client_id: m.client_id, p_reply_to: m.reply_to, p_kind: m.kind, p_meta: m.kind === "text" ? null : m.meta }),
    fn: { edit: "edit_message", del: "delete_message", react: "react", pin: "pin_message", get: "get_message" },
    search: q => api.rpc("search_messages", { p_friend: key, p_query: q }),
    pins: () => api.rpc("get_pins", { p_friend: key }),
    attach: (name, buf) => api.attach(key, name, buf),
    canDelete: m => m.sender === S.me.id,
    canPin: () => true,
    deleteText: "It's removed for both of you. This can't be undone.",
  };
}
export const viewKey = () => S.view.kind === "chat" ? S.view.id : S.view.kind === "channel" ? "ch:" + S.view.id : null;

const convo = id => { if (!S.convos.has(id)) S.convos.set(id, { msgs: [], loaded: false, more: true, loading: false, draft: "" }); return S.convos.get(id); };
const isOpen = id => cur === id && viewKey() === id && document.querySelector("#view-social:not(.hidden)") && !document.hidden;   // on screen (even on another monitor)
const saveSettings = () => { clearTimeout(saveSettings.t); saveSettings.t = setTimeout(() => api.rpc("save_settings", { p_data: S.settings }).catch(() => {}), 600); };

async function load(id) {
  const c = convo(id), t = T(id); if (c.loading || !t) return; c.loading = true;
  try {
    const rows = await t.load(), have = new Set(rows.map(m => m.id));
    // keep anything that arrived or was sent while this was loading
    const extra = c.msgs.filter(m => !have.has(m.id) && !(m.client_id && rows.some(r => r.client_id === m.client_id)));
    c.msgs = rows.concat(extra); c.more = rows.length === PAGE; c.loaded = true; c.error = null; rows.forEach(m => S.seenMsgs.add(m.id));
  } catch (e) { c.error = e.message; }
  c.loading = false;
  if (cur === id) { await fileLinks(c.msgs); draw(true); seen(id); }
}
async function older(id) {
  const c = convo(id), t = T(id); if (c.loading || !c.more || !c.msgs.length || !t) return;
  c.loading = true; const list = $("#sxMsgs"), h = list.scrollHeight;
  try { const rows = await t.load(c.msgs[0].created_at); c.msgs = rows.concat(c.msgs); c.more = rows.length === PAGE; rows.forEach(m => S.seenMsgs.add(m.id)); await fileLinks(rows); }
  catch (e) {}
  c.loading = false;
  if (cur === id) { draw(false); const l = $("#sxMsgs"); if (l) l.scrollTop = l.scrollHeight - h; }
}
// private files open through short-lived links (refreshed before they run out)
async function fileLinks(msgs) {
  const need = []; for (const m of msgs) for (const f of (m.meta && m.meta.files) || []) { const u = urls.get(f.path); if (!u || Date.now() - u.at > 50 * 60e3) need.push(f.path); }
  if (!need.length) return;
  try { const got = await api.fileUrls([...new Set(need)]); for (const [p, url] of Object.entries(got || {})) urls.set(p, { url, at: Date.now() }); } catch (e) {}
}
const fileUrl = path => (urls.get(path) || {}).url || "";

// you're looking at it: everything in it is read
async function seen(id) {
  if (!isOpen(id)) return;
  const t = T(id); if (!t) return;
  if (t.kind === "channel") return Servers.markRead(t.id);
  const f = t.f;
  if (f.unread) { f.unread = 0; emit("friends"); }
  const c = convo(id), now = new Date().toISOString();
  if (c.msgs.some(m => m.sender === id && !m.read_at)) { api.rpc("mark_read", { p_friend: id }).catch(() => {}); c.msgs.forEach(m => { if (m.sender === id && !m.read_at) m.read_at = now; }); }
}

/* ================= drawing ================= */
function render(host, id) {
  el = host; const changed = cur !== id; cur = id;
  if (changed) { reply = null; editing = null; pending = []; closePanels(); closeMention(); }
  const t = T(id); if (!t) return;
  const c = convo(id), compact = (S.settings.chat || {}).density === "compact";
  if (changed) c.divider = t.kind === "dm" ? (t.f.unread ? (c.msgs.filter(m => m.sender === id).slice(-t.f.unread)[0] || {}).id || "pending" : null)
    : (Servers.unreadOf(t.id) ? (c.msgs.filter(m => m.sender !== S.me.id).slice(-Servers.unreadOf(t.id))[0] || {}).id || "pending" : null);
  const membersOn = S.panel && S.panel.kind === "members" && S.panel.server === (t.sv && t.sv.id);
  const head = t.kind === "dm" ? (() => { const f = t.f, st = statusOf(f); return `
      <button class="sx-avbtn" data-sx="profile:${id}" title="View profile">${avatar(f, 32, st)}</button>
      <div class="sx-chat-who"><b>${esc(f.display_name)}</b><small>@${esc(f.username)} · ${esc(subline(f))}</small></div>
      <span class="sp"></span>
      <button class="ibtn" data-sx="call:${id}" title="${st === "offline" ? esc(f.display_name) + " is offline" : "Start a voice call"}" aria-label="Voice call">${icon("phone")}</button>
      <button class="ibtn" data-sx="video:${id}" title="${st === "offline" ? esc(f.display_name) + " is offline" : "Start a video call"}" aria-label="Video call">${icon("video")}</button>
      <button class="ibtn" data-sx="callshare:${id}" title="Call and share your screen" aria-label="Call and share your screen">${icon("screen")}</button>
      <span class="sx-vsep"></span>
      <button class="ibtn" data-sx="pins" title="Pinned messages" aria-label="Pinned messages">${icon("pin")}</button>
      <button class="ibtn" data-sx="msgsearch" title="Search this conversation" aria-label="Search this conversation">${icon("search")}</button>
      <button class="ibtn${S.panel && S.panel.id === id ? " on" : ""}" data-sx="togglepanel:${id}" title="Profile" aria-label="Show profile">${icon("sidebar")}</button>`; })()
    : `<span class="sx-ch-hash" aria-hidden="true">${icon("hash")}</span>
      <div class="sx-chat-who"><b>${esc(t.ch.name)}</b>${t.ch.topic ? `<small title="${esc(t.ch.topic)}">${esc(t.ch.topic)}</small>` : `<small>${esc(t.sv.name)}</small>`}</div>
      <span class="sp"></span>
      <button class="ibtn" data-sx="invite:${t.sv.id}" title="Invite people" aria-label="Invite people">${icon("userPlus")}</button>
      <button class="ibtn" data-sx="pins" title="Pinned messages" aria-label="Pinned messages">${icon("pin")}</button>
      <button class="ibtn" data-sx="msgsearch" title="Search this channel" aria-label="Search this channel">${icon("search")}</button>
      <button class="ibtn${membersOn ? " on" : ""}" data-sx="members:${t.sv.id}" title="Members" aria-label="Show members" aria-pressed="${membersOn}">${icon("users")}</button>`;
  host.innerHTML = `
    <header class="sx-head sx-chat-head${t.kind === "channel" ? " ch" : ""}">${head}</header>
    ${t.kind === "dm" ? `<div class="sx-stage-slot" id="sxStageSlot"></div>` : ""}
    <div class="sx-msgs${compact ? " compact" : ""}" id="sxMsgs" tabindex="-1"></div>
    <button class="sx-jump hidden" id="sxJump" data-sx="jump">New messages ${icon("chevron")}</button>
    <div class="sx-typing" id="sxTyping" aria-live="polite"></div>
    <form class="sx-compose" id="sxCompose">
      <div class="sx-compose-extra" id="sxComposeExtra"></div>
      <div class="sx-compose-box">
        <button type="button" class="sx-cmp-btn" data-sx="attach" title="Add a file (pictures, videos, PDFs, up to 25 MB)" aria-label="Add a file">${icon("plus")}</button>
        <textarea id="sxText" rows="1" maxlength="4000" spellcheck="true" aria-label="Message ${esc(t.name)}">${esc(c.draft || "")}</textarea>
        <span class="sx-count hidden" id="sxCount"></span>
        <button type="button" class="sx-cmp-btn sx-gif-btn" data-sx="gifs" title="GIFs" aria-label="GIFs">GIF</button>
        <button type="button" class="sx-cmp-btn" data-sx="stickers" title="Stickers" aria-label="Stickers">${icon("sticker")}</button>
        <button type="button" class="sx-cmp-btn" data-sx="emoji" title="Emoji" aria-label="Emoji">${icon("smile")}</button>
        <button class="sx-send" type="submit" title="${S.settings.enterSends === false ? "Send (Ctrl+Enter)" : "Send (Enter) · Shift+Enter for a new line · ↑ edits your last message"}" aria-label="Send" disabled>${icon("send")}</button></div>
    </form>`;
  const list = $("#sxMsgs"), ta = $("#sxText"), form = $("#sxCompose");
  list.onscroll = () => { if (list.scrollTop < 120) older(id); if (nearBottom()) $("#sxJump").classList.add("hidden"); };
  list.onclick = msgClick; list.oncontextmenu = msgMenu;
  list.onkeydown = editKeys;
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; form.querySelector(".sx-send").disabled = !ta.value.trim() && !pending.some(p => p.done); const n = ta.value.length, cnt = $("#sxCount"); cnt.classList.toggle("hidden", n < 3500); cnt.textContent = 4000 - n; c.draft = ta.value; };
  ta.oninput = () => { grow(); if (t.kind === "channel") mentionSuggest(ta); if (ta.value.trim()) iAmTyping(id); else stopTyping(); };
  grow();
  ta.onkeydown = e => {
    if (mention && mentionKeys(e, ta)) return;
    const enterSends = S.settings.enterSends !== false;
    if (e.key === "Enter" && !e.isComposing && ((enterSends && !e.shiftKey && !e.ctrlKey) || (!enterSends && e.ctrlKey))) { e.preventDefault(); form.requestSubmit(); }
    else if (e.key === "ArrowUp" && !ta.value) { const last = [...c.msgs].reverse().find(m => m.sender === S.me.id && m.kind === "text" && !m.deleted_at && !m._local); if (last) { e.preventDefault(); startEdit(last.id); } }
    else if (e.key === "Escape" && reply) { reply = null; extra(); }
  };
  ta.onblur = () => setTimeout(closeMention, 150);
  ta.onpaste = e => { const files = [...(e.clipboardData && e.clipboardData.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } };
  host.ondragover = e => { if ([...(e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); host.classList.add("dropping"); } };
  host.ondragleave = e => { if (!host.contains(e.relatedTarget)) host.classList.remove("dropping"); };
  host.ondrop = e => { host.classList.remove("dropping"); const files = [...(e.dataTransfer.files || [])]; if (files.length) { e.preventDefault(); e.stopPropagation(); addFiles(files); } };
  form.onsubmit = e => { e.preventDefault(); const v = ta.value.trim(); if (!v && !pending.some(p => p.done)) return; ta.value = ""; grow(); closeMention(); stopTyping(); sendNow(id, v); };
  if (!c.loaded) { list.innerHTML = `<div class="sx-msgs-load">${'<div class="sx-skel msg"></div>'.repeat(4)}</div>`; load(id); }
  else { draw(true); seen(id); }
  extra();
  if (t.kind === "dm") CallUI.renderStage();
  drawTyping();
  if (t.kind === "channel") Servers.loadMembers(t.sv.id).then(() => { if (cur === id) draw(false); });
  setTimeout(() => ta.focus(), 30);
}
function nearBottom() { const l = $("#sxMsgs"); return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 80; }

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*\s*){1,3}$/u;
const INVITE = /\bsky:invite\/([A-Za-z0-9]{8})\b/g;
const sizeText = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
const myTag = () => "@" + String(S.me.username).toLowerCase();
const mentionsMe = (m, t) => !!(m.body && m.body.toLowerCase().includes(myTag())) || !!(t.kind === "channel" && m.reply && m.reply.sender === S.me.id && m.sender !== S.me.id);
// @username in a message: highlighted when it's someone in the conversation (you, brighter)
function textHtml(body, t) {
  let h = prefs().links === false ? esc(body) : linkify(body);
  h = h.replace(/(^|[^A-Za-z0-9_.])@([A-Za-z0-9_.]{3,20})/g, (all, pre, name) => {
    const low = name.toLowerCase(), you = low === S.me.username.toLowerCase();
    const known = you || (t.kind === "dm" ? t.f.username.toLowerCase() === low : Servers.memberByName(t.sv.id, low));
    return known ? `${pre}<span class="sx-mention${you ? " you" : ""}">@${name}</span>` : all;
  });
  return h.replace(/sky:invite\/([A-Za-z0-9]{8})/g, `<span class="sx-invlink">sky:invite/$1</span>`);
}
function bodyHtml(m, t) {
  if (m.deleted_at) return `<div class="sx-msg-t gone">${icon("trash")}This message was deleted.</div>`;
  if (m.kind === "gif") return gifHtml(m);
  if (m.kind === "sticker") {
    const src = m.meta && m.meta.sticker ? stickerSrc(m.meta.sticker) : m.meta && m.meta.url ? m.meta.url : "";
    return `<div class="sx-sticker">${src ? `<img src="${esc(src)}" alt="${esc(m.meta.sticker ? stickerName(m.meta.sticker) : "Sticker")}" draggable="false"${/\.gif$|-anim\./.test(src) ? " data-anim" : ""}>` : ""}</div>`;
  }
  let h = m.body ? `<div class="sx-msg-t selectable${prefs().bigEmoji !== false && EMOJI_ONLY.test(m.body.trim()) ? " big" : ""}">${textHtml(m.body, t)}${m.edited_at ? ` <span class="sx-edited" title="Edited ${esc(new Date(m.edited_at).toLocaleString())}">(edited)</span>` : ""}</div>` : "";
  const codes = [...new Set([...(m.body || "").matchAll(INVITE)].map(x => x[1]))].slice(0, 2);
  h += codes.map(code => `<div class="sx-invite" data-invite="${code}">${Servers.inviteCard(code)}</div>`).join("");
  const files = (m.meta && m.meta.files) || [];
  if (files.length) h += `<div class="sx-files${files.length > 1 ? " many" : ""}">${files.map(f => {
    const url = fileUrl(f.path) || (m._local && f._blob) || "";
    if (/^image\//.test(f.type)) return `<button class="sx-img" data-view="${esc(f.path)}" data-name="${esc(f.name)}" style="${f.w && f.h ? `aspect-ratio:${f.w}/${f.h}` : ""}" title="${esc(f.name)}">${url ? `<img src="${esc(url)}" alt="${esc(f.name)}" loading="lazy" draggable="false"${f.type === "image/gif" ? " data-anim" : ""}>` : `<span class="sx-skel"></span>`}</button>`;
    if (/^video\//.test(f.type)) return `<div class="sx-video">${url ? `<video src="${esc(url)}" controls preload="metadata"></video>` : `<span class="sx-skel"></span>`}</div>`;
    return `<div class="sx-file">${icon(f.type === "application/pdf" ? "file" : f.type === "application/zip" ? "archive" : "file")}<span><b title="${esc(f.name)}">${esc(f.name)}</b><small>${sizeText(f.size)}</small></span>
      ${url ? `<button class="ibtn" data-dl="${esc(f.path)}" data-name="${esc(f.name)}" title="Download" aria-label="Download ${esc(f.name)}">${icon("download")}</button>` : ""}</div>`;
  }).join("")}</div>`;
  return h;
}
function reactionsHtml(m, t) {
  if (!m.reactions || !m.reactions.length || m.deleted_at) return "";
  const name = u => u === S.me.id ? "You" : t.who(u).display_name;
  const people = us => us.length > 3 ? us.slice(0, 3).map(name).join(", ") + ` and ${us.length - 3} more` : us.map(name).join(" and ");
  return `<div class="sx-reacts">${m.reactions.map(r => `<button class="sx-react${r.users.includes(S.me.id) ? " mine" : ""}" data-react="${esc(r.emoji)}" title="${esc(people(r.users))} reacted with ${esc(r.emoji)}" aria-pressed="${r.users.includes(S.me.id)}"><span>${esc(r.emoji)}</span><b>${r.users.length}</b></button>`).join("")}
    <button class="sx-react add" data-sx="reactpick" title="Add a reaction" aria-label="Add a reaction">${icon("smilePlus")}</button></div>`;
}
function startHtml(t) {
  if (t.kind === "dm") { const f = t.f; return `<div class="sx-chat-start">${avatar(f, 72)}<h3>${esc(f.display_name)}</h3><p class="sx-chat-start-u">@${esc(f.username)}</p>${badgesHtml(f.badges)}<p>This is the beginning of your conversation with <b>${esc(f.display_name)}</b>. Say hi, send a sticker, or start a call.</p></div>`; }
  return `<div class="sx-chat-start ch"><span class="sx-ch-big">${icon("hash")}</span><h3>Welcome to #${esc(t.ch.name)}</h3><p>This is the start of the <b>#${esc(t.ch.name)}</b> channel in ${esc(t.sv.name)}.${t.ch.topic ? " " + esc(t.ch.topic) : ""}</p>
    <div class="sx-empty-acts"><button class="btn sm" data-sx="invite:${t.sv.id}">${icon("userPlus")}Invite people</button></div></div>`;
}
function draw(toBottom) {
  const list = $("#sxMsgs"); if (!list || !cur) return;
  const t = T(cur), c = convo(cur); if (!t) return;
  if (c.error && !c.msgs.length) { list.innerHTML = `<p class="sx-none bad">${esc(c.error)} <button class="sx-link" data-sx="reload">Try again</button></p>`; return; }
  if (!c.msgs.length) { list.innerHTML = startHtml(t); return; }
  let h = c.more ? `<div class="sx-older"><span class="sx-spin sm"></span></div>` : startHtml(t);
  let prev = null, lastMine = null;
  for (const m of c.msgs) if (m.sender === S.me.id && !m._local && !m.deleted_at) lastMine = m.id;
  for (const m of c.msgs) {
    const ts = new Date(m.created_at).getTime(), mine = m.sender === S.me.id, who = t.who(m.sender);
    if (!prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)) h += `<div class="sx-day"><span>${esc(dayLabel(m.created_at))}</span></div>`;
    if (c.divider && m.id === c.divider) h += `<div class="sx-new"><span>New</span></div>`;
    const grouped = prev && prev.sender === m.sender && !m.reply && ts - new Date(prev.created_at).getTime() < GROUP_MS && dayLabel(prev.created_at) === dayLabel(m.created_at) && m.id !== c.divider;
    const state = m._state === "sending" ? `<span class="sx-state">${m._progress ? "Uploading…" : "Sending…"}</span>` : m._state === "failed" ? `<span class="sx-state bad">Not sent · <button class="sx-link" data-retry="${esc(m.client_id)}">Retry</button></span>` : "";
    const quote = m.reply ? `<button class="sx-quote" data-jump="${esc(m.reply.id)}" title="Jump to the message">${icon("reply")}<b>${esc(t.who(m.reply.sender).display_name)}</b><span>${m.reply.deleted ? "Deleted message" : m.reply.kind === "sticker" ? "Sticker" : m.reply.kind === "gif" ? "GIF" : m.reply.kind === "attachment" && !m.reply.body ? "Attachment" : esc(m.reply.body)}</span></button>` : "";
    const isEditing = editing === m.id, role = t.kind === "channel" ? Servers.roleOf(t.sv.id, m.sender) : "";
    h += `<div class="sx-msg${grouped ? " cont" : ""}${m._state ? " " + m._state : ""}${m.pinned_at ? " pinned" : ""}${isEditing ? " editing" : ""}${m.kind === "sticker" ? " stk" : ""}${!mine && !m.deleted_at && mentionsMe(m, t) ? " mention" : ""}" data-mid="${esc(m.id)}" data-mine="${mine ? 1 : 0}">
      ${quote}
      ${grouped ? `<span class="sx-msg-time" title="${esc(new Date(m.created_at).toLocaleString())}">${esc(clock(m.created_at))}</span>` : `<button class="sx-msg-av" data-sx="profile:${who.id}" tabindex="-1">${avatar(who, 38)}</button>`}
      <div class="sx-msg-b">${grouped ? "" : `<div class="sx-msg-h"><b${role === "owner" || role === "admin" ? ` class="sx-role-${role}"` : ""}>${esc(who.display_name)}</b>${role === "owner" ? `<span class="sx-role-ic" title="Server owner">${icon("crown")}</span>` : ""}${badgesHtml(who.badges, true)}<time title="${esc(new Date(m.created_at).toLocaleString())}">${esc(clock(m.created_at))}</time>${m.pinned_at ? `<span class="sx-pin-tag">${icon("pin")}Pinned</span>` : ""}</div>`}
        ${isEditing ? `<div class="sx-edit"><textarea id="sxEditBox" maxlength="4000" aria-label="Edit message">${esc(m.body)}</textarea><small>Enter to save · Esc to cancel</small></div>` : bodyHtml(m, t)}
        ${reactionsHtml(m, t)}${state}${t.kind === "dm" && mine && m.id === lastMine && m.read_at && !m.deleted_at ? `<span class="sx-state seen">Seen</span>` : ""}</div>
      ${!m._local && !m.deleted_at && !isEditing ? `<div class="sx-tools" role="toolbar" aria-label="Message actions">
        ${EMOJI_QUICK.slice(0, 3).map(e => `<button data-quick="${e}" title="React with ${e}" aria-label="React with ${e}">${e}</button>`).join("")}
        <button data-sx="reactpick" title="Add a reaction" aria-label="Add a reaction">${icon("smilePlus")}</button>
        <button data-sx="reply" title="Reply" aria-label="Reply">${icon("reply")}</button>
        ${mine && m.kind === "text" ? `<button data-sx="edit" title="Edit" aria-label="Edit">${icon("edit")}</button>` : ""}
        <button data-sx="msgmenu" title="More" aria-label="More">${icon("more")}</button></div>` : ""}
    </div>`;
    prev = m;
  }
  const stick = toBottom || nearBottom();
  list.innerHTML = h;
  if (stick) { const div = list.querySelector(".sx-new"); if (toBottom && div) div.scrollIntoView({ block: "center" }); else list.scrollTop = list.scrollHeight; }
  const ed = $("#sxEditBox"); if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); ed.style.height = Math.min(ed.scrollHeight, 220) + "px"; }
  Servers.fillInvites(list);
}

/* ---------- @mentions: pick someone from the server while typing ---------- */
function mentionSuggest(ta) {
  const t = T(); if (!t || t.kind !== "channel") return;
  const before = ta.value.slice(0, ta.selectionStart), m = /(^|\s)@([A-Za-z0-9_.]{0,20})$/.exec(before);
  if (!m) return closeMention();
  const q = m[2].toLowerCase(), list = Servers.members(t.sv.id).filter(p => p.id !== S.me.id && (p.username.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q))).slice(0, 6);
  if (!list.length) return closeMention();
  mention = { start: before.length - m[2].length - 1, list, i: Math.min(mention ? mention.i : 0, list.length - 1) };
  let box = $("#sxMention");
  if (!box) { box = document.createElement("div"); box.id = "sxMention"; box.className = "sx-mention-pop"; box.setAttribute("role", "listbox"); $("#sxCompose").appendChild(box);
    box.onmousedown = e => { const b = e.target.closest("[data-mi]"); if (!b) return; e.preventDefault(); mention.i = +b.dataset.mi; pickMention($("#sxText")); }; }
  box.innerHTML = `<div class="sx-mention-h">Members</div>` + list.map((p, i) => `<button type="button" role="option" aria-selected="${i === mention.i}" class="${i === mention.i ? "on" : ""}" data-mi="${i}">${avatar(p, 24, p.status)}<b>${esc(p.display_name)}</b><small>@${esc(p.username)}</small></button>`).join("");
}
function mentionKeys(e, ta) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); mention.i = (mention.i + (e.key === "ArrowDown" ? 1 : -1) + mention.list.length) % mention.list.length; mentionSuggest(ta); return true; }
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(ta); return true; }
  if (e.key === "Escape") { e.preventDefault(); closeMention(); return true; }
  return false;
}
function pickMention(ta) {
  if (!mention) return; const p = mention.list[mention.i], end = ta.selectionStart;
  const ins = "@" + p.username + " "; ta.value = ta.value.slice(0, mention.start) + ins + ta.value.slice(end);
  const pos = mention.start + ins.length; ta.setSelectionRange(pos, pos); closeMention(); ta.focus(); ta.dispatchEvent(new Event("input"));
}
function closeMention() { mention = null; const b = $("#sxMention"); if (b) b.remove(); }

/* ---------- the area above the box: replying to, files waiting to go ---------- */
function extra() {
  const box = $("#sxComposeExtra"); if (!box) return;
  const t = T();
  box.innerHTML = (reply && t ? `<div class="sx-replying">${icon("reply")}<span>Replying to <b>${esc(reply.sender === S.me.id ? "yourself" : t.who(reply.sender).display_name)}</b></span><em>${esc(reply.kind === "sticker" ? "Sticker" : reply.kind === "gif" ? "GIF" : reply.body || "Attachment")}</em><button class="ibtn sm" data-sx="noreply" aria-label="Cancel reply">${icon("x")}</button></div>` : "")
    + (pending.length ? `<div class="sx-pending-files">${pending.map((p, i) => `<div class="sx-pf${p.error ? " bad" : ""}" title="${esc(p.name)}">${p.preview ? `<img src="${p.preview}" alt="">` : icon("file")}<span><b>${esc(p.name)}</b><small>${p.error ? esc(p.error) : p.done ? sizeText(p.size) : "Uploading…"}</small></span>
        ${p.done || p.error ? "" : `<i class="sx-pf-bar"><i></i></i>`}<button class="ibtn sm" data-sx="unfile:${i}" aria-label="Remove ${esc(p.name)}">${icon("x")}</button></div>`).join("")}</div>` : "");
  const send = document.querySelector("#sxCompose .sx-send"), ta = $("#sxText");
  if (send && ta) send.disabled = !ta.value.trim() && !pending.some(p => p.done);
}
async function addFiles(files) {
  const id = cur, t = T(id); if (!t) return;
  for (const file of files) {
    if (pending.length >= MAX_FILES) { toast(`Up to ${MAX_FILES} files at a time.`, true); break; }
    if (file.size > MAX_FILE) { toast(`“${file.name}” is bigger than 25 MB.`, true); continue; }
    const p = { name: file.name || "file", size: file.size, type: file.type, done: false, preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : "" };
    pending.push(p); extra();
    (async () => {
      try {
        if (p.preview) { const im = new Image(); im.src = p.preview; await im.decode().catch(() => {}); p.w = im.naturalWidth; p.h = im.naturalHeight; }
        const r = await t.attach(p.name, await file.arrayBuffer());
        Object.assign(p, { path: r.path, type: r.type, size: r.size, name: r.name, done: true });
        if (p.preview) urls.set(r.path, { url: p.preview, at: Date.now() - 49 * 60e3 });   // show it from the computer until the real link arrives
      } catch (e) { p.error = e.message; }
      if (cur === id) extra();
    })();
  }
}

/* ================= sending ================= */
function sendNow(id, text) {
  const files = pending.filter(p => p.done), meta = files.length ? { files: files.map(p => ({ path: p.path, name: p.name, type: p.type, size: p.size, ...(p.w ? { w: p.w, h: p.h } : {}) })) } : null;
  if (pending.some(p => !p.done && !p.error)) { toast("Wait for your files to finish uploading.", true); $("#sxText").value = text; return; }
  pending = []; const rp = reply; reply = null; extra();
  send(id, { body: text, kind: meta ? "attachment" : "text", meta, reply: rp });
}
async function send(id, { body = "", kind = "text", meta = null, reply: rp = null }) {
  const c = convo(id), client_id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const m = { id: "local-" + client_id, client_id, sender: S.me.id, body, kind, meta: meta || {}, reply_to: rp ? rp.id : null,
    reply: rp ? { id: rp.id, sender: rp.sender, kind: rp.kind, body: (rp.body || "").slice(0, 160) } : null, reactions: [], created_at: new Date().toISOString(), _local: true, _state: "sending" };
  c.msgs.push(m); c.divider = null; draw(false); const l = $("#sxMsgs"); if (l) l.scrollTop = l.scrollHeight;
  await deliver(id, m);
}
async function deliver(id, m) {
  const c = convo(id), t = T(id); if (!t) return;
  try {
    const saved = await t.send(m);
    S.seenMsgs.add(saved.id);
    const full = { ...saved, reactions: [], reply: m.reply };
    const i = c.msgs.indexOf(m), dup = c.msgs.findIndex(x => x.id === saved.id);
    if (dup >= 0) { if (i >= 0) c.msgs.splice(i, 1); }   // the live feed brought it first
    else if (i >= 0) c.msgs[i] = full; else c.msgs.push(full);
    if (t.kind === "dm") { t.f.last_message_at = saved.created_at; emit("friends"); }
  } catch (e) { m._state = "failed"; m._error = e.message; if (e.code !== "offline") toast(e.message, true); }
  if (cur === id) draw(false);
}
function retry(client_id) { const c = convo(cur), m = c.msgs.find(x => x.client_id === client_id && x._state === "failed"); if (!m) return; m._state = "sending"; draw(false); deliver(cur, m); }

/* ================= editing, reacting, deleting, pinning ================= */
const msg = id => convo(cur).msgs.find(m => m.id === id);
function startEdit(id) { editing = id; draw(false); }
async function saveEdit() {
  const m = msg(editing), box = $("#sxEditBox"), t = T(); if (!m || !box || !t) return;
  const v = box.value.trim(); if (!v) return confirmDelete(m);
  editing = null;
  if (v === m.body) return draw(false);
  const before = m.body; m.body = v; m.edited_at = new Date().toISOString(); draw(false);
  try { const saved = await api.rpc(t.fn.edit, { p_id: m.id, p_body: v }); Object.assign(m, { body: saved.body, edited_at: saved.edited_at }); }
  catch (e) { m.body = before; toast(e.message, true); draw(false); }
}
function editKeys(e) {
  if (e.target.id !== "sxEditBox") return;
  if (e.key === "Escape") { e.preventDefault(); editing = null; draw(false); $("#sxText").focus(); }
  else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
}
async function react(m, emoji) {
  const t = T(); if (!m || m._local || !t) return;
  const r = (m.reactions || []).find(x => x.emoji === emoji), on = !(r && r.users.includes(S.me.id));
  // show it at once, then confirm
  if (on) { if (r) r.users.push(S.me.id); else (m.reactions = m.reactions || []).push({ emoji, users: [S.me.id] }); }
  else { r.users = r.users.filter(u => u !== S.me.id); if (!r.users.length) m.reactions = m.reactions.filter(x => x !== r); }
  draw(false);
  try { await api.rpc(t.fn.react, { p_id: m.id, p_emoji: emoji, p_on: on }); } catch (e) { toast(e.message, true); refresh(m.id, cur); }
}
async function confirmDelete(m) {
  const t = T(); if (!m || !t) return;
  if (!(await dialog({ title: "Delete this message?", text: t.deleteText, ok: "Delete", danger: true }))) { editing = null; return draw(false); }
  editing = null;
  try { await api.rpc(t.fn.del, { p_id: m.id }); Object.assign(m, { deleted_at: new Date().toISOString(), body: "", meta: {}, reactions: [], pinned_at: null }); draw(false); }
  catch (e) { toast(e.message, true); }
}
async function pin(m, on) { const t = T(); try { await api.rpc(t.fn.pin, { p_id: m.id, p_on: on }); m.pinned_at = on ? new Date().toISOString() : null; draw(false); toast(on ? "Pinned" : "Unpinned"); } catch (e) { toast(e.message, true); } }
// one message again from the server (after an edit or a reaction), in whichever conversation holds it
async function refresh(id, key) {
  const t = T(key); if (!t) return;
  try { const m = await api.rpc(t.fn.get, { p_id: id }); if (!m) return; const c = S.convos.get(key); if (!c) return;
    const i = c.msgs.findIndex(x => x.id === id); if (i >= 0) { c.msgs[i] = m; await fileLinks([m]); if (cur === key) draw(false); } } catch (e) {}
}
function jump(id) {
  const row = document.querySelector(`.sx-msg[data-mid="${CSS.escape(id)}"]`);
  if (!row) return toast("That message is further back. Scroll up to load it.");
  row.scrollIntoView({ block: "center", behavior: "smooth" }); row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
}

/* ---------- clicks on messages ---------- */
function msgClick(e) {
  const a = e.target.closest("[data-link]"); if (a) { e.preventDefault(); sky.openUrl(a.dataset.link); return; }
  const r = e.target.closest("[data-retry]"); if (r) return retry(r.dataset.retry);
  const j = e.target.closest("[data-jump]"); if (j) return jump(j.dataset.jump);
  const row = e.target.closest(".sx-msg"); if (!row) return;
  const m = msg(row.dataset.mid);
  const q = e.target.closest("[data-quick]"); if (q) return react(m, q.dataset.quick);
  const rc = e.target.closest("[data-react]"); if (rc) return react(m, rc.dataset.react);
  const v = e.target.closest("[data-view]"); if (v) return viewer(v.dataset.view, v.dataset.name);
  const dl = e.target.closest("[data-dl]"); if (dl) return download(dl.dataset.dl, dl.dataset.name);
}
function msgMenu(e) {
  const row = e.target.closest(".sx-msg"); if (!row || e.target.closest("textarea, a, video")) return;
  const m = msg(row.dataset.mid); if (!m || m._local || m.deleted_at) return;
  e.preventDefault(); openMsgMenu(m, null, { x: e.clientX, y: e.clientY });
}
function openMsgMenu(m, anchor, at) {
  closeMenu();
  const t = T(), mine = m.sender === S.me.id, items = [
    ["Reply", "reply", () => { reply = m; extra(); $("#sxText").focus(); }],
    ["Add reaction", "smilePlus", () => pickEmoji(anchor || document.querySelector(`.sx-msg[data-mid="${CSS.escape(m.id)}"]`), x => react(m, x), { save: saveSettings })],
    ...(m.body ? [["Copy text", "copy", () => (sky.copy ? sky.copy(m.body) : navigator.clipboard.writeText(m.body)).then(() => toast("Copied"))]] : []),
    ...(t.canPin(m) ? [[m.pinned_at ? "Unpin" : "Pin message", "pin", () => pin(m, !m.pinned_at)]] : []),
    ...(mine && m.kind === "text" ? [["Edit", "edit", () => startEdit(m.id)]] : []),
    ...(t.canDelete(m) ? [["Delete message", "trash", () => confirmDelete(m), true]] : []),
  ];
  const el_ = menuEl = document.createElement("div"); el_.className = "sx-menu"; el_.setAttribute("role", "menu");
  el_.innerHTML = items.map(([l, ic, , d]) => `<button role="menuitem" class="${d ? "danger" : ""}">${icon(ic)}<span>${l}</span></button>`).join("");
  document.body.appendChild(el_);
  [...el_.querySelectorAll("button")].forEach((b, i) => b.onclick = ev => { ev.stopPropagation(); closeMenu(); items[i][2](); });
  const r = at || anchor.getBoundingClientRect(), w = el_.offsetWidth, h = el_.offsetHeight;
  let x = at ? at.x : r.right - w, y = at ? at.y : r.bottom + 6; if (y + h > innerHeight - 8) y = (at ? at.y : r.top - 6) - h;
  el_.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px"; el_.style.top = Math.max(8, y) + "px";
  el_.querySelector("button").focus();
  setTimeout(() => document.addEventListener("mousedown", awayMenu, true));
}
const awayMenu = e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } document.removeEventListener("mousedown", awayMenu, true); }

/* ---------- pictures and files ---------- */
function viewer(path, name) {
  const url = fileUrl(path); if (!url) return;
  const v = document.createElement("div"); v.className = "sx-viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", name || "Picture");
  v.innerHTML = `<div class="sx-viewer-top"><span>${esc(name || "")}</span><span class="sp"></span><button class="ibtn" data-v="dl" aria-label="Download">${icon("download")}</button><button class="ibtn" data-v="close" aria-label="Close">${icon("x")}</button></div><img src="${esc(url)}" alt="${esc(name || "")}">`;
  document.body.appendChild(v);
  const close = () => { v.remove(); document.removeEventListener("keydown", key, true); };
  const key = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", key, true);
  v.onclick = e => { const b = e.target.closest("[data-v]"); if (b && b.dataset.v === "dl") return download(path, name); if (b || e.target === v) close(); };
}
async function download(path, name) {
  const url = fileUrl(path); if (!url) return;
  try { const blob = await (await fetch(url)).blob(), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name || "file"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  catch (e) { toast("Couldn't download that file.", true); }
}

/* ---------- pins and search: a panel under the header ---------- */
function closePanels() { const p = $("#sxFloat"); if (p) p.remove(); }
async function panel(kind) {
  const existing = $("#sxFloat"); if (existing && existing.dataset.kind === kind) return closePanels();
  closePanels(); const t = T(); if (!t) return;
  const p = document.createElement("div"); p.id = "sxFloat"; p.className = "sx-float"; p.dataset.kind = kind;
  p.innerHTML = `<div class="sx-float-head"><b>${kind === "pins" ? "Pinned messages" : "Search"}</b><span class="sp"></span><button class="ibtn sm" data-f="close" aria-label="Close">${icon("x")}</button></div>
    ${kind === "search" ? `<label class="sx-search sm">${icon("search")}<input id="sxMsgQ" placeholder="Search ${t.kind === "dm" ? "messages with " + esc(t.name) : esc(t.name)}" spellcheck="false"></label>` : ""}<div class="sx-float-list" id="sxFloatList"><div class="sx-skel"></div></div>`;
  el.appendChild(p);
  const fill = list => { $("#sxFloatList").innerHTML = list.length ? list.map(m => { const w = t.who(m.sender); return `<button class="sx-float-item" data-f="go" data-id="${esc(m.id)}">${avatar(w, 28)}<span><b>${esc(w.display_name)}</b><small>${esc(new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</small><em>${esc(m.kind === "sticker" ? "Sticker" : m.kind === "gif" ? "GIF" : m.body || "Attachment")}</em></span></button>`; }).join("")
    : `<p class="sx-none">${kind === "pins" ? "No pinned messages yet. Pin one from a message's menu." : "No messages match."}</p>`; };
  if (kind === "pins") t.pins().then(fill).catch(() => fill([]));
  else { $("#sxFloatList").innerHTML = ""; const q = $("#sxMsgQ"); q.focus(); let tm = 0; q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { if (q.value.trim().length < 2) return ($("#sxFloatList").innerHTML = ""); t.search(q.value.trim()).then(fill).catch(() => fill([])); }, 250); }; }
  p.onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; if (b.dataset.f === "close") return closePanels(); if (b.dataset.f === "go") { closePanels(); jump(b.dataset.id); } };
}

/* ================= live ================= */
function onMessage(ch) {
  const isCh = ch.table === "channel_messages" || ch.table === "channel_reactions";
  if (ch.table === "message_reactions" || ch.table === "channel_reactions") {
    const id = (ch.row && ch.row.message_id) || (ch.old && ch.old.message_id); if (!id) return;
    for (const [key, c] of S.convos) if (c.msgs.some(m => m.id === id)) refresh(id, key);
    return;
  }
  const m = ch.row || {}; if (!m.id) return;
  const key = isCh ? "ch:" + m.channel_id : (m.sender === S.me.id ? m.recipient : m.sender), c = S.convos.get(key);
  if (ch.type === "UPDATE") {   // seen, edited, deleted, pinned
    if (c) { const x = c.msgs.find(y => y.id === m.id); if (x) { const reactions = m.deleted_at ? [] : x.reactions; Object.assign(x, m, { reactions, reply: x.reply }); if (cur === key) draw(false); } }
    return;
  }
  if (ch.type !== "INSERT" || S.seenMsgs.has(m.id)) return; S.seenMsgs.add(m.id);
  if (typing.delete(m.sender)) drawTyping();
  const full = { ...m, reactions: [], reply: null };
  if (c && (c.loaded || c.loading)) {   // (while loading too: the load keeps it)
    if (m.sender === S.me.id && c.msgs.some(x => x.client_id && x.client_id === m.client_id)) return;   // our own, being confirmed by send
    c.msgs.push(full);
    if (m.reply_to || (m.meta && m.meta.files)) refresh(m.id, key);   // fetch the quote / file links
  }
  if (isCh) return channelMessage(m, key, full);
  const other = key, f = friend(other);
  if (f) f.last_message_at = m.created_at;
  if (m.sender === S.me.id) { emit("friends"); return; }
  if (isOpen(other)) {
    const stick = nearBottom(); draw(false); if (!stick) $("#sxJump").classList.remove("hidden");
    seen(other);
  } else {
    if (f) f.unread = (f.unread || 0) + 1;
    if (cur === other) draw(false);
    const np = S.settings.notify || {};
    const preview = m.kind === "sticker" ? "Sent a sticker" : m.kind === "gif" ? "Sent a GIF" : m.kind === "attachment" && !m.body ? "Sent a file" : m.body.slice(0, 140);
    if (f) notify(f.display_name, np.preview === false ? "Sent you a message" : preview, { chat: other }, "message");
  }
  emit("friends");
}
function channelMessage(m, key, full) {
  if (m.sender === S.me.id) return;
  const t = T(key); if (!t) { Servers.load(); return; }
  if (isOpen(key)) { const stick = nearBottom(); draw(false); if (!stick) $("#sxJump").classList.remove("hidden"); seen(key); return; }
  if (cur === key) draw(false);
  // you're mentioned: your @username, or a reply to one of yours (checked by the server's counts too)
  const you = (m.body || "").toLowerCase().includes(myTag()) || !!(m.reply_to && (S.convos.get(key)?.msgs || []).some(x => x.id === m.reply_to && x.sender === S.me.id));
  Servers.bump(t.id, you);
  const level = Servers.notifyLevel(t.sv.id);
  if (level === "none" || (level === "mentions" && !you)) return;
  const np = S.settings.notify || {}, w = t.who(m.sender);
  const preview = m.kind === "sticker" ? "Sent a sticker" : m.kind === "gif" ? "Sent a GIF" : m.kind === "attachment" && !m.body ? "Sent a file" : m.body.slice(0, 140);
  notify(`${w.display_name} in #${t.ch.name}${you ? " (mentioned you)" : ""}`, np.preview === false ? `New message in ${t.sv.name}` : preview, { channel: t.id }, "message");
}
function catchUp() {   // after reconnecting: reload whatever conversation you're in
  for (const [id, c] of S.convos) { c.loaded = false; if (cur === id && el && viewKey() === id) load(id); }
}

export const Chat = {
  init() {
    window.addEventListener("focus", () => { if (cur && viewKey() === cur) seen(cur); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && cur && viewKey() === cur) seen(cur); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#sxFloat")) closePanels(); });
    document.addEventListener("sx:chatprefs", () => { const l = $("#sxMsgs"); if (l) { l.classList.toggle("compact", prefs().density === "compact"); draw(false); } });
  },
  render, onMessage, catchUp, viewKey, onTyping,
  redraw: () => draw(false),
  forget: key => { S.convos.delete(key); if (cur === key) cur = null; },
  seen: id => seen(id),
  click(a, x, b) {
    if (a === "jump") { const l = $("#sxMsgs"); l.scrollTop = l.scrollHeight; $("#sxJump").classList.add("hidden"); }
    if (a === "reload" && cur) { const c = convo(cur); c.error = null; load(cur); }
    if (a === "togglepanel") { if (S.panel && S.panel.id === x) { S.panel = null; emit("panel"); } else import("./social.js").then(m => m.Social.showProfile(x, true)); }
    if (a === "callshare") { const f = friend(x); if (f) CallUI.start(f, false, { share: true }); }
    if (a === "emoji") { closeStickers(); closeGifs(); pickEmoji(b, e => { const ta = $("#sxText"), s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + e + ta.value.slice(ta.selectionEnd ?? s); ta.focus(); ta.setSelectionRange(s + e.length, s + e.length); ta.dispatchEvent(new Event("input")); }, { save: saveSettings, keepOpen: true }); }
    if (a === "gifs") { closeEmoji(); closeStickers(); pickGif(b, g => { const rp = reply; reply = null; extra(); send(cur, { kind: "gif", meta: g, reply: rp }); }); }
    if (a === "stickers") { closeEmoji(); closeGifs(); pickSticker(b, pick => { const rp = reply; reply = null; extra(); send(cur, { kind: "sticker", meta: pick, reply: rp }); }, saveSettings); }
    if (a === "attach") { const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.onchange = () => addFiles([...inp.files]); inp.click(); }
    if (a === "unfile") { const p = pending.splice(+x, 1)[0]; if (p && p.preview) URL.revokeObjectURL(p.preview); extra(); }
    if (a === "noreply") { reply = null; extra(); }
    if (a === "pins") panel("pins");
    if (a === "msgsearch") panel("search");
    const row = b && b.closest(".sx-msg"), m = row && msg(row.dataset.mid);
    if (a === "reply" && m) { reply = m; extra(); $("#sxText").focus(); }
    if (a === "edit" && m) startEdit(m.id);
    if (a === "reactpick" && m) pickEmoji(b, e => react(m, e), { save: saveSettings });
    if (a === "msgmenu" && m) openMsgMenu(m, b);
  },
};
