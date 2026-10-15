// The Social tab: your account, friends, requests, activity and profiles, kept live from the server.
// Conversations are in chat.js, calls in callui.js, settings in settings.js.
import { $, $$, esc, sky, toast, dialog } from "../util.js";
import { icon } from "./icons.js";
import { api, words } from "./api.js";
import { S, on, emit, STATUS, statusOf, friend, myStatus, avatar, badgesHtml, ago, subline, unreadTotal, incomingCount } from "./state.js";
import { Chat } from "./chat.js";
import { CallUI } from "./callui.js";
import { SocialSettings, applyAppearance } from "./settings.js";
import { profileCard, statusDialog, applyMotion } from "./profile.js";
import { Servers, mentionTotal } from "./servers.js";
import { Admin } from "./admin.js";

let root = null, visible = false, hbTimer = 0, friendsTimer = 0, menuEl = null;

/* ================= start-up & data ================= */
async function init() {
  root = $("#sx"); if (!root || !sky || !sky.social) return;
  root.addEventListener("click", click);
  root.addEventListener("contextmenu", ctx);
  root.addEventListener("keydown", keys);
  root.addEventListener("input", input);
  document.addEventListener("click", e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && menuEl) { closeMenu(); e.stopPropagation(); } }, true);
  sky.social.onAuth(async a => { const before = S.user && S.user.id; S.user = a.user || null; if ((S.user && S.user.id) !== before) await boot(); });
  sky.social.onChange(change);
  sky.social.onLive(l => {
    const was = S.live; S.live = l.status === "SUBSCRIBED" ? "live" : l.status === "CLOSED" || l.status === "CHANNEL_ERROR" || l.status === "TIMED_OUT" ? "down" : S.live;
    if (S.live === "live" && was === "down") refreshAll();   // back after a drop: catch up on anything missed
    renderLive();
  });
  sky.social.onOpen(target => { document.dispatchEvent(new CustomEvent("sky:goto", { detail: "social" })); goTarget(target); });
  on(what => {
    if (what === "friends" || what === "requests" || what === "notes") { renderSide(); railBadge(); if (["friends", "requests", "activity"].includes(S.view.kind)) renderMain(); if (S.panel) renderPanel(); }
    if (what === "servers") { Servers.renderRail(); railBadge(); if (S.view.kind === "channel") { renderSide(); if (!Servers.channel(S.view.id)) renderMain(); } }
    if (what === "members" && S.panel && S.panel.kind === "members") renderPanel();
  });
  CallUI.init(); Chat.init(); SocialSettings.init({ open, render: renderAll, reloadMe });
  try { const st = await api.state(); S.configured = st.configured; S.user = st.user; S.ice = st.ice; S.test = st.test; } catch (e) { S.configured = false; }
  await boot();
}

async function boot() {
  S.booting = true; S.me = null; S.friends = []; S.requests = []; S.notes = []; S.servers = []; S.convos.clear(); S.view = { kind: "friends" }; S.panel = null;
  clearInterval(hbTimer); clearInterval(friendsTimer);
  render();
  if (!S.configured || !S.user) { S.booting = false; applyAppearance(null); return render(); }
  try {
    const me = await api.rpc("my_profile");
    S.me = me && me[0] || null;
  } catch (e) { S.me = null; if (e.code === "signed_out") { S.user = null; } }
  if (S.me) {
    S.settings = await api.rpc("get_settings").catch(() => ({})) || {};
    S.isAdmin = S.canBadge = await api.rpc("is_admin").catch(() => false) === true;   // Skyline's owner: the Admin section (the server checks every admin action itself)
    applyAppearance(S.settings.appearance);
    await refreshAll(true);
    heartbeat(); hbTimer = setInterval(heartbeat, 20000);
    friendsTimer = setInterval(() => { if (!document.hidden) loadFriends(); }, 60000);   // presence ages out on its own
  }
  S.booting = false; render();
  const ra = document.getElementById("railAdmin"); if (ra) ra.classList.toggle("hidden", !(S.me && S.isAdmin));   // the Admin tab: only Skyline's owner
}
// the Admin page (its own tab in the sidebar)
let adminWired = false;
function showAdmin() {
  const el = document.getElementById("adminPage"); if (!el) return;
  if (!S.me || !S.isAdmin) { el.innerHTML = `<p class="sx-none">Admin is only for Skyline's owner.</p>`; return; }
  if (!adminWired) { adminWired = true; el.addEventListener("click", e => Admin.click(e)); el.addEventListener("input", e => Admin.input(e)); }
  Admin.mount(el, () => reloadMe());
}
async function reloadMe() { const me = await api.rpc("my_profile"); S.me = me && me[0] || S.me; renderSide(); if (S.panel) renderPanel(); }
new MutationObserver(() => { clearTimeout(reloadMe.t); reloadMe.t = setTimeout(() => applyMotion(document), 60); }).observe(document.body, { childList: true, subtree: true });
async function loadFriends() { try { S.friends = await api.rpc("get_friends") || []; emit("friends"); } catch (e) {} }
async function loadRequests() { try { S.requests = await api.rpc("get_requests") || []; emit("requests"); } catch (e) {} }
async function loadNotes() { try { S.notes = await api.rpc("get_notifications") || []; for (const n of S.notes) S.seenNotes.add(n.id); emit("notes"); } catch (e) {} }
async function refreshAll(first) {
  await Promise.all([loadFriends(), loadRequests(), loadNotes(), Servers.load()]);
  if (!first) Chat.catchUp();
}

// you're here: tell your friends (every 20 s), and go Away by yourself after 10 minutes without touching the PC
async function heartbeat() {
  if (!S.me) return;
  let st = myStatus();
  if (st === "online" && S.settings.autoAway !== false) { try { if (await api.idle() > 600) st = "away"; } catch (e) {} }
  S.shown = st;
  api.rpc("heartbeat", { p_status: st }).catch(() => {});
  renderMe();
}

/* ================= live updates ================= */
function change(c) {
  if (!S.me) return;
  const r = c.row || {};
  if (c.table === "messages" || c.table === "message_reactions" || c.table === "channel_messages" || c.table === "channel_reactions") return Chat.onMessage(c);
  if (c.table === "servers" || c.table === "server_members" || c.table === "channels") return Servers.onChange(c);
  if (c.table === "presence") {
    const f = friend(r.user_id); if (!f) return;
    f.status = new Date(r.last_seen).getTime() > Date.now() - 60000 ? r.status : "offline"; f.last_seen = r.last_seen;
    return emit("friends");
  }
  if (c.table === "friendships" || c.table === "friend_requests") { loadFriends(); loadRequests(); return; }
  if (c.table === "profile_details") { if (r.user_id === S.me.id) reloadMe(); else if (friend(r.user_id)) { loadFriends(); if (S.panel && S.panel.id === r.user_id) showProfile(r.user_id, S.panel.auto); } return; }
  if (c.table === "notifications" && c.type === "INSERT") {
    if (S.seenNotes.has(r.id)) return; S.seenNotes.add(r.id);
    loadNotes().then(() => {
      const n = S.notes.find(x => x.id === r.id); if (!n) return;
      const who = n.display_name || n.username || "Someone";
      if (n.kind === "announcement") return notify("Skyline", n.body || "", { view: "activity" }, "announcement");
      if (n.kind === "badge") { reloadMe(); return notify("You got a new badge", `${who} gave you the ${n.body || ""} badge.`, { view: "activity" }, "badge"); }
      const text = n.kind === "request" ? `${who} sent you a friend request` : n.kind === "accepted" ? `${who} accepted your friend request` : `Missed call from ${who}`;
      notify(text, n.kind === "request" ? "Open Requests to accept or decline." : n.kind === "accepted" ? "You can message and call each other now." : "", n.kind === "request" ? { view: "requests" } : { chat: n.actor }, n.kind);
    });
    return;
  }
  if (c.table === "call_signals") return CallUI.onSignal(r);
}

// a heads-up: inside Skyline as a small toast; on the desktop too when Skyline isn't in front (never twice for one event)
export function notify(title, body, target, kind) {
  const prefs = S.settings.notify || {};
  if (prefs[kind] === false) return;
  const dnd = myStatus() === "dnd";
  const inFront = document.hasFocus() && !document.hidden;
  if (inFront) showToast(title, body, target);
  else if (!dnd && prefs.desktop !== false) api.notify({ title, body: body || "", target });
  if (!dnd && prefs.sound !== false && kind !== "call") chime();
}
function showToast(title, body, target) {
  let box = $("#sxToasts"); if (!box) { box = document.createElement("div"); box.id = "sxToasts"; box.className = "sx-toasts"; document.body.appendChild(box); }
  const t = document.createElement("button"); t.className = "sx-toast";
  t.innerHTML = `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}`;
  t.onclick = () => { t.remove(); document.dispatchEvent(new CustomEvent("sky:goto", { detail: "social" })); goTarget(target); };
  box.appendChild(t); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 5200);
}
let actx = null;
export function chime() {
  try {
    actx = actx || new AudioContext(); const t = actx.currentTime;
    for (const [f, d] of [[880, 0], [1320, .09]]) { const o = actx.createOscillator(), g = actx.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.06, t + d + .015); g.gain.exponentialRampToValueAtTime(.0001, t + d + .35); o.connect(g).connect(actx.destination); o.start(t + d); o.stop(t + d + .4); }
  } catch (e) {}
}
function goTarget(target) {
  if (!target) return;
  if (target.chat) open({ kind: "chat", id: target.chat });
  else if (target.channel) { const c = Servers.channel(target.channel); if (c) Servers.go(c.server_id, c.id); }
  else if (target.view) open({ kind: target.view });
}
function railBadge() {
  const b = document.querySelector('.rbtn[data-view="social"]'); if (!b) return;
  let n = b.querySelector(".rcount"); const total = S.me ? unreadTotal() + incomingCount() + mentionTotal() : 0;
  if (!total) { if (n) n.remove(); return; }
  if (!n) { n = document.createElement("span"); n.className = "rcount"; b.appendChild(n); }
  n.textContent = total > 99 ? "99+" : total;
}

/* ================= drawing ================= */
function render() {
  if (!root) return;
  if (!S.configured) return root.innerHTML = gate("Social isn't connected yet", "Friends, messages and calls need a small online server that everyone's Skyline talks to. Once it's set up, this tab lets you sign in.", "");
  if (S.booting) return root.innerHTML = `<div class="sx-gate"><div class="sx-spin"></div></div>`;
  if (!S.user) return authScreen();
  if (!S.me) return usernameScreen();
  if (!root.querySelector(".sx-shell")) {
    root.innerHTML = `<div class="sx-shell"><nav class="sx-rail" id="sxRail" aria-label="Servers"></nav><aside class="sx-side" id="sxSide"></aside><main class="sx-main" id="sxMain"></main><aside class="sx-panel hidden" id="sxPanel"></aside></div>`;
  }
  renderAll();
}
function renderAll() { Servers.renderRail(); renderSide(); renderMain(); renderPanel(); railBadge(); }
const gate = (title, text, actions) => `<div class="sx-gate"><div class="sx-gate-box"><div class="sx-gate-ic">${icon("users")}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${actions}</div></div>`;

/* ---------- signing in ---------- */
let authMode = "in";
function authScreen() {
  const up = authMode === "up";
  root.innerHTML = `<div class="sx-gate"><form class="sx-gate-box sx-auth" id="sxAuth" novalidate>
    <div class="sx-gate-ic">${icon("users")}</div>
    <h2>${up ? "Create your Skyline account" : "Sign in to Social"}</h2>
    <p>${up ? "Your account lets friends find you by username, message you and call you." : "Message and call your friends right from Skyline."}</p>
    <label class="sx-field"><span>Email</span><input name="email" type="email" autocomplete="email" spellcheck="false" required></label>
    <label class="sx-field"><span>Password</span><input name="password" type="password" autocomplete="${up ? "new-password" : "current-password"}" minlength="8" required>${up ? `<small>At least 8 characters.</small>` : ""}</label>
    <div class="sx-err" id="sxAuthErr" role="alert"></div>
    <button class="btn primary sx-wide" type="submit">${up ? "Create account" : "Sign in"}</button>
    <div class="sx-auth-alt">${up ? `Already have an account? <button type="button" class="sx-link" data-sx="auth:in">Sign in</button>` : `New here? <button type="button" class="sx-link" data-sx="auth:up">Create an account</button>`}
      ${up ? "" : `<span class="sx-sepdot"></span><button type="button" class="sx-link" data-sx="auth:reset">Forgot password?</button>`}</div>
  </form></div>`;
  const f = $("#sxAuth"); f.email.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector("button[type=submit]"), err = $("#sxAuthErr"); err.textContent = ""; btn.disabled = true;
    const email = f.email.value.trim(), password = f.password.value;
    try {
      if (authMode === "up") {
        const r = await api.signUp(email, password);
        if (r.confirm) { err.className = "sx-ok"; err.textContent = "Check your email to confirm your account, then sign in here."; authMode = "in"; btn.disabled = false; return; }
      } else await api.signIn(email, password);
    } catch (er) { err.className = "sx-err"; err.textContent = er.message; btn.disabled = false; }
  };
}
async function resetPassword() {
  const email = await dialog({ title: "Reset your password", text: "We'll email you a link to choose a new password.", input: ($("#sxAuth") && $("#sxAuth").email.value) || "", ok: "Send link" });
  if (!email) return;
  try { await api.reset(email); toast("If that email has an account, a reset link is on its way"); } catch (e) { toast(e.message, true); }
}

/* ---------- choosing a username ---------- */
function usernameScreen() {
  root.innerHTML = `<div class="sx-gate"><form class="sx-gate-box sx-auth" id="sxPick" novalidate>
    <div class="sx-gate-ic">${icon("user")}</div>
    <h2>Choose your username</h2>
    <p>Friends add you with your username. Your display name is what they see, and you can change it any time.</p>
    <label class="sx-field"><span>Username</span><div class="sx-at"><i>@</i><input name="username" maxlength="20" spellcheck="false" autocomplete="off" required></div><small id="sxUserHint">3–20 letters, numbers, underscores or dots.</small></label>
    <label class="sx-field"><span>Display name</span><input name="display" maxlength="32" spellcheck="false" autocomplete="nickname" placeholder="Optional"></label>
    <div class="sx-err" id="sxPickErr" role="alert"></div>
    <button class="btn primary sx-wide" type="submit">Continue</button>
    <div class="sx-auth-alt"><button type="button" class="sx-link" data-sx="signout">Sign out</button></div>
  </form></div>`;
  const f = $("#sxPick"), hint = $("#sxUserHint"); f.username.focus();
  let t = 0;
  f.username.oninput = () => {
    clearTimeout(t); const v = f.username.value.trim(); hint.className = "";
    if (!v) { hint.textContent = "3–20 letters, numbers, underscores or dots."; return; }
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(v) || /(^\.|\.$|\.\.)/.test(v)) { hint.className = "bad"; hint.textContent = words("username_invalid"); return; }
    hint.textContent = "Checking…";
    t = setTimeout(async () => {
      try { const free = await api.rpc("username_available", { p_username: v }); if (f.username.value.trim() !== v) return; hint.className = free ? "good" : "bad"; hint.textContent = free ? `@${v} is available` : words("username_taken"); }
      catch (e) { hint.className = "bad"; hint.textContent = e.message; }
    }, 300);
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector("button[type=submit]"), err = $("#sxPickErr"); err.textContent = ""; btn.disabled = true;
    try { await api.rpc("create_profile", { p_username: f.username.value.trim(), p_display_name: f.display.value.trim() || null }); await boot(); }
    catch (er) { err.textContent = er.message; btn.disabled = false; }
  };
}

/* ---------- the sidebar ---------- */
function renderSide() {
  const el = $("#sxSide"); if (!el || !S.me) return;
  Servers.renderRail();
  if (S.view.kind === "channel" && Servers.renderSide(el)) { renderMe(); CallUI.renderSlot(); return; }
  const v = S.view, online = S.friends.filter(f => statusOf(f) !== "offline").length, inc = incomingCount(), unreadNotes = S.notes.filter(n => !n.read_at).length;
  const recent = [...S.friends].sort((a, b) => (new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)) || a.display_name.localeCompare(b.display_name));
  el.innerHTML = `
    <div class="sx-side-head"><span class="sx-h">Social</span><span class="sp"></span>
      <button class="ibtn sx-bell${unreadNotes ? " has" : ""}" data-sx="go:activity" title="Activity${unreadNotes ? ` (${unreadNotes} new)` : ""}" aria-label="Activity">${icon("bell")}</button>
      <button class="ibtn" data-sx="add" title="Add friend" aria-label="Add friend">${icon("userPlus")}</button></div>
    <nav class="sx-nav">
      <button class="sx-nav-i${v.kind === "friends" ? " on" : ""}" data-sx="go:friends">${icon("users")}<span>Friends</span><em>${online ? online + " online" : ""}</em></button>
      <button class="sx-nav-i${v.kind === "requests" ? " on" : ""}" data-sx="go:requests">${icon("inbox")}<span>Requests</span>${inc ? `<b class="sx-pill">${inc}</b>` : ""}</button>
    </nav>
    <div class="sx-sec"><span>Direct messages</span></div>
    <div class="sx-dms">${recent.length ? recent.map(f => {
      const st = statusOf(f), on_ = v.kind === "chat" && v.id === f.id;
      return `<button class="sx-dm${on_ ? " on" : ""}${f.unread ? " unread" : ""}${st === "offline" ? " off" : ""}" data-sx="chat:${f.id}" data-fid="${f.id}">${avatar(f, 32, st)}<span class="sx-dm-t"><b>${esc(f.display_name)}</b><small>${S.call && S.call.peer.id === f.id && S.call.state !== "ended" ? "In a call" : esc(subline(f))}</small></span>${f.unread ? `<b class="sx-pill">${f.unread > 99 ? "99+" : f.unread}</b>` : f.last_message_at ? `<time class="sx-dm-time" title="Last message ${esc(new Date(f.last_message_at).toLocaleString())}">${shortAgo(f.last_message_at)}</time>` : ""}</button>`;
    }).join("") : `<p class="sx-side-empty">Friends you add show up here.</p>`}</div>
    <div class="sx-callslot" id="sxCallSlot"></div>
    <div class="sx-me" id="sxMe"></div>`;
  renderMe(); CallUI.renderSlot();
}
// "now", "5m", "3h", "2d", or a date: how long since you last talked
function shortAgo(t) { const m = (Date.now() - new Date(t)) / 60000; return m < 1 ? "now" : m < 60 ? Math.floor(m) + "m" : m < 1440 ? Math.floor(m / 60) + "h" : m < 10080 ? Math.floor(m / 1440) + "d" : new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }); }
function renderMe() {
  const el = $("#sxMe"); if (!el || !S.me) return;
  const st = S.shown || myStatus(), my = S.me.badges || [];
  el.innerHTML = `<button class="sx-me-who" data-sx="me" title="Your profile and status" aria-haspopup="menu">${avatar(S.me, 34, st)}<span class="sx-me-t"><b><span>${esc(S.me.display_name)}</span>${badgesHtml(my.slice(0, 1), true)}</b><small>@${esc(S.me.username)}</small></span></button>
    <button class="ibtn" data-sx="copyname" title="Copy your username" aria-label="Copy your username">${icon("copy")}</button>
    <button class="ibtn" data-sx="go:settings" title="Social settings" aria-label="Social settings">${icon("settings")}</button>`;
}
function renderLive() {
  const m = $("#sxMain"); if (!m) return;
  let bar = $("#sxLive");
  if (S.live === "down") { if (!bar) { bar = document.createElement("div"); bar.id = "sxLive"; bar.className = "sx-live"; m.prepend(bar); } bar.innerHTML = `<span class="sx-spin sm"></span>Reconnecting… new messages will appear when you're back online.`; }
  else if (bar) bar.remove();
}

/* ---------- the main area ---------- */
export function open(v) {
  if (v.kind === "server") { const sv = Servers.server(v.id); if (!sv) return; v = { kind: "channel", id: Servers.firstChannel(sv), server: sv.id }; }
  S.view = v;
  if (v.kind !== "chat" && S.panel && S.panel.auto) S.panel = null;
  if (S.panel && S.panel.kind === "members" && (v.kind !== "channel" || v.server !== S.panel.server)) S.panel = v.kind === "channel" ? { kind: "members", server: v.server } : null;
  renderSide(); renderMain(); renderPanel();
}
function renderMain() {
  const el = $("#sxMain"); if (!el || !S.me) return;
  const v = S.view;
  if (v.kind === "chat" && friend(v.id)) Chat.render(el, v.id);
  else if (v.kind === "channel" && Servers.channel(v.id)) Chat.render(el, "ch:" + v.id);
  else if (v.kind === "requests") el.innerHTML = requestsPage();
  else if (v.kind === "activity") { el.innerHTML = activityPage(); if (S.notes.some(n => !n.read_at)) api.rpc("mark_notifications_read").then(() => { S.notes.forEach(n => n.read_at = n.read_at || new Date().toISOString()); renderSide(); }).catch(() => {}); }
  else if (v.kind === "settings") SocialSettings.render(el, v.section);
  else { S.view = { kind: "friends", filter: v.filter || "all" }; el.innerHTML = friendsPage(); }
  renderLive();
}
const head = (title, extra = "") => `<header class="sx-head"><h2>${title}</h2><span class="sp"></span>${extra}</header>`;

function friendsPage() {
  const filter = S.view.filter || "all", q = (S.friendQuery || "").toLowerCase();
  const list = S.friends.filter(f => (filter === "all" || statusOf(f) !== "offline") && (!q || f.display_name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)));
  const groups = ["online", "away", "dnd", "offline"].map(st => [st, list.filter(f => statusOf(f) === st)]).filter(([, l]) => l.length);
  const seg = `<div class="seg sm sx-seg"><button class="${filter === "online" ? "on" : ""}" data-sx="filter:online">Online</button><button class="${filter === "all" ? "on" : ""}" data-sx="filter:all">All</button></div>`;
  if (!S.friends.length) return head("Friends") + empty("users", "No friends yet", `Add people by their username. Yours is <b class="sx-mono">@${esc(S.me.username)}</b>: share it so friends can add you too.`,
    `<button class="btn primary sm" data-sx="add">${icon("userPlus")}Add friend</button><button class="btn sm" data-sx="copyname">${icon("copy")}Copy my username</button>`);
  return head("Friends", `${seg}<label class="sx-search sm">${icon("search")}<input id="sxFriendQ" placeholder="Search friends" value="${esc(S.friendQuery || "")}" spellcheck="false"></label><button class="btn primary sm" data-sx="add">${icon("userPlus")}Add friend</button>`)
    + `<div class="sx-scroll"><div class="sx-list">${groups.length ? groups.map(([st, l]) => `<div class="sx-group">${STATUS[st].label} — ${l.length}</div>` + l.map(friendRow).join("")).join("")
      : `<p class="sx-none">${filter === "online" && !q ? "None of your friends are online right now." : "No friends match that search."}</p>`}</div></div>`;
}
function friendRow(f) {
  const st = statusOf(f);
  return `<div class="sx-row" data-fid="${f.id}" tabindex="0" role="button" data-sx="chat:${f.id}">
    <button class="sx-avbtn" data-sx="profile:${f.id}" title="View profile" aria-label="View ${esc(f.display_name)}'s profile">${avatar(f, 38, st)}</button>
    <span class="sx-row-t"><b>${esc(f.display_name)}<small>@${esc(f.username)}</small></b><small>${esc(subline(f))}</small></span>
    ${f.unread ? `<b class="sx-pill">${f.unread}</b>` : ""}
    <span class="sx-row-acts">
      <button class="sx-act" data-sx="chat:${f.id}" title="Message" aria-label="Message">${icon("message")}</button>
      <button class="sx-act" data-sx="call:${f.id}" title="${st === "offline" ? esc(f.display_name) + " is offline" : "Voice call"}" aria-label="Voice call">${icon("phone")}</button>
      <button class="sx-act" data-sx="menu:${f.id}" title="More" aria-label="More options" aria-haspopup="menu">${icon("more")}</button>
    </span></div>`;
}
function requestsPage() {
  const inc = S.requests.filter(r => r.direction === "incoming"), out = S.requests.filter(r => r.direction === "outgoing");
  if (!inc.length && !out.length) return head("Requests", `<button class="btn primary sm" data-sx="add">${icon("userPlus")}Add friend</button>`) + empty("inbox", "No pending requests", "Friend requests you send or receive wait here until they're answered.", "");
  const row = (r, acts) => `<div class="sx-row static">${avatar(r, 38)}<span class="sx-row-t"><b>${esc(r.display_name)}<small>@${esc(r.username)}</small></b><small>${r.direction === "incoming" ? "Wants to be friends" : "Request sent"} · ${esc(ago(r.created_at))}</small></span><span class="sx-row-acts show">${acts}</span></div>`;
  return head("Requests", `<button class="btn primary sm" data-sx="add">${icon("userPlus")}Add friend</button>`) + `<div class="sx-scroll"><div class="sx-list">
    ${inc.length ? `<div class="sx-group">Received — ${inc.length}</div>` + inc.map(r => row(r, `<button class="btn sm primary" data-sx="accept:${r.id}">${icon("check")}Accept</button><button class="btn sm" data-sx="decline:${r.id}">Decline</button>`)).join("") : ""}
    ${out.length ? `<div class="sx-group">Sent — ${out.length}</div>` + out.map(r => row(r, `<span class="sx-pending">Pending</span><button class="btn sm ghost" data-sx="cancel:${r.id}">Cancel</button>`)).join("") : ""}
  </div></div>`;
}
function activityPage() {
  if (!S.notes.length) return head("Activity") + empty("bell", "Nothing new", "Friend requests, missed calls, badges and news from Skyline show up here.", "");
  return head("Activity") + `<div class="sx-scroll"><div class="sx-list">${S.notes.map(n => {
    const who = esc(n.display_name || n.username || "Someone"), ic = n.kind === "missed_call" ? "phoneOff" : n.kind === "accepted" ? "check" : n.kind === "announcement" ? "megaphone" : n.kind === "badge" ? "award" : "userPlus";
    const text = n.kind === "request" ? `<b>${who}</b> sent you a friend request` : n.kind === "accepted" ? `<b>${who}</b> accepted your friend request`
      : n.kind === "announcement" ? `<b>Skyline</b> · ${esc(n.body || "")}` : n.kind === "badge" ? `<b>${who}</b> gave you the <b>${esc(n.body || "")}</b> badge` : `Missed call from <b>${who}</b>`;
    const act = n.kind === "request" ? `<button class="btn sm" data-sx="go:requests">View</button>` : n.actor && friend(n.actor) ? `<button class="btn sm" data-sx="chat:${n.actor}">Message</button>${n.kind === "missed_call" ? `<button class="btn sm" data-sx="call:${n.actor}">${icon("phone")}Call back</button>` : ""}` : "";
    return `<div class="sx-row static${n.read_at ? "" : " fresh"}"><span class="sx-note-ic ${n.kind}">${icon(ic)}</span><span class="sx-row-t"><span class="sx-note-t">${text}</span><small>${esc(ago(n.created_at))}</small></span><span class="sx-row-acts show">${act}</span></div>`;
  }).join("")}</div></div>`;
}
export const empty = (ic, title, html, acts) => `<div class="sx-empty"><div class="sx-empty-ic">${icon(ic)}</div><h3>${esc(title)}</h3><p>${html}</p>${acts ? `<div class="sx-empty-acts">${acts}</div>` : ""}</div>`;

/* ---------- the side panel: someone's profile ---------- */
async function showProfile(id, auto) {
  S.panel = { kind: "profile", id, auto: !!auto, loading: true }; renderPanel();
  try { const p = (await api.rpc("get_profile", { p_user: id }))[0]; if (S.panel && S.panel.id === id) { S.panel.p = p; S.panel.loading = false; renderPanel(); } }
  catch (e) { if (S.panel && S.panel.id === id) { S.panel.error = e.message; S.panel.loading = false; renderPanel(); } }
}
function renderPanel() {
  const el = $("#sxPanel"); if (!el) return; syncPanelBtn();
  if (!S.panel) { el.classList.add("hidden"); el.innerHTML = ""; root && root.querySelector(".sx-shell")?.classList.remove("with-panel"); return; }
  el.classList.remove("hidden"); root.querySelector(".sx-shell").classList.add("with-panel");
  if (S.panel.kind === "members") return Servers.renderMembers(el, S.panel.server);
  const P = S.panel, f = friend(P.id), p = P.p || f || (S.me && P.id === S.me.id ? S.me : null);
  const close = `<button class="ibtn pc-close" data-sx="closepanel" title="Close" aria-label="Close profile">${icon("x")}</button>`;
  if (P.loading && !p) { el.innerHTML = `<div class="sx-panel-load">${close}<span class="sx-spin"></span></div>`; return; }
  if (P.error && !p) { el.innerHTML = `<div class="sx-panel-head"><span class="sp"></span>${close}</div><p class="sx-none">${esc(P.error)}</p>`; return; }
  const me = S.me && p.id === S.me.id, rel = me ? "self" : P.p ? P.p.relation : f ? "friend" : "none";
  const st = me ? (S.shown || myStatus()) : f ? statusOf(f) : P.p && P.p.status || null;
  const d = (P.p && P.p.details) || (me ? S.me.details : null) || (f ? { status_text: f.status_text, status_emoji: f.status_emoji, decoration: f.decoration } : {});
  const actions = me ? `<div class="pc-acts"><button class="btn sm" data-sx="editprofile">${icon("edit")}Edit profile</button><button class="btn sm" data-sx="setstatus">${icon("sparkle")}Set status</button></div>`
    : rel === "friend" ? `<div class="pc-acts"><button class="btn sm primary" data-sx="chat:${p.id}">${icon("message")}Message</button><button class="btn sm" data-sx="call:${p.id}" title="Voice call">${icon("phone")}Call</button><button class="btn sm" data-sx="video:${p.id}" title="Video call" aria-label="Video call">${icon("video")}</button><button class="btn sm" data-sx="menu:${p.id}" title="More" aria-label="More">${icon("more")}</button></div>`
    : rel === "none" ? `<div class="pc-acts"><button class="btn sm primary" data-sx="request:${esc(p.username)}">${icon("userPlus")}Add friend</button></div>`
    : rel === "incoming" ? `<div class="pc-acts"><button class="btn sm primary" data-sx="acceptfrom:${p.id}">${icon("check")}Accept request</button></div>`
    : rel === "blocked" ? `<div class="pc-acts"><button class="btn sm" data-sx="unblock:${p.id}">Unblock</button></div>` : `<div class="pc-acts"><span class="sx-pending">Request sent</span></div>`;
  el.innerHTML = profileCard({ ...p, created_at: (P.p && P.p.created_at) || p.created_at }, d, { status: rel === "friend" || me ? st : null, friendsSince: rel === "friend" ? ((P.p && P.p.friends_since) || (f && f.friends_since)) : null, actions, headActions: close });
  applyMotion(el);
}

/* ---------- adding friends ---------- */
let addT = 0, addSeq = 0;
function addFriend() {
  const m = $("#dlg");
  m.innerHTML = `<div class="dlg-box sx-add" role="dialog" aria-modal="true" aria-label="Add friend">
    <div class="sx-add-head"><h3>Add friend</h3><span class="sp"></span><button class="ibtn" data-r="close" aria-label="Close">${icon("x")}</button></div>
    <p class="sx-add-sub">Search for a username. They'll get a request they can accept.</p>
    <label class="sx-search">${icon("search")}<input id="sxAddQ" placeholder="Username, e.g. Shadow_Ridezz" spellcheck="false" autocomplete="off" maxlength="32"><button class="ibtn sm hidden" id="sxAddClear" aria-label="Clear search">${icon("x")}</button></label>
    <div class="sx-add-res" id="sxAddRes"><p class="sx-add-tip">Your username is <b class="sx-mono">@${esc(S.me.username)}</b> <button class="sx-link" data-r="copyme">Copy</button></p></div>
  </div>`;
  m.classList.remove("hidden");
  const q = $("#sxAddQ"), res = $("#sxAddRes"), clear = $("#sxAddClear"); q.focus();
  const close = () => { m.classList.add("hidden"); m.onclick = null; document.removeEventListener("keydown", esc_, true); };
  const esc_ = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", esc_, true);
  const search = async () => {
    const v = q.value.trim(), seq = ++addSeq; clear.classList.toggle("hidden", !v);
    if (v.replace(/^@/, "").length < 2) { res.innerHTML = `<p class="sx-add-tip">Your username is <b class="sx-mono">@${esc(S.me.username)}</b> <button class="sx-link" data-r="copyme">Copy</button></p>`; return; }
    res.innerHTML = `<div class="sx-skel"></div><div class="sx-skel"></div>`;
    try {
      const list = await api.rpc("search_users", { p_query: v }); if (seq !== addSeq) return;
      res.innerHTML = list.length ? list.map(u => {
        const act = u.relation === "friend" ? `<span class="sx-pending">${icon("check")}Friends</span>` : u.relation === "outgoing" ? `<span class="sx-pending">Request sent</span>`
          : u.relation === "incoming" ? `<button class="btn sm primary" data-r="acceptfrom:${u.id}">Accept request</button>` : u.relation === "blocked" ? `<span class="sx-pending">Blocked</span>`
          : `<button class="btn sm primary" data-r="send:${esc(u.username)}">${icon("userPlus")}Add friend</button>`;
        return `<div class="sx-row static">${avatar(u, 38, u.status || null)}<span class="sx-row-t"><b>${esc(u.display_name)}</b><small>@${esc(u.username)}${u.status ? " · " + STATUS[u.status].label : ""}</small></span><span class="sx-row-acts show">${act}</span></div>`;
      }).join("") : `<p class="sx-none">No one found with that username. Check the spelling with them.</p>`;
    } catch (e) { if (seq === addSeq) res.innerHTML = `<p class="sx-none bad">${esc(e.message)}</p>`; }
  };
  q.oninput = () => { clearTimeout(addT); addT = setTimeout(search, 250); };
  q.onkeydown = e => { if (e.key === "Enter") { clearTimeout(addT); search(); } };
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-r]"); if (!b) return;
    const [a, x] = b.dataset.r.split(/:(.*)/);
    if (a === "close") return close();
    if (a === "copyme") return copyName();
    if (a === "send") { b.disabled = true; await sendRequest(x); search(); }
    if (a === "acceptfrom") { b.disabled = true; await acceptFrom(x); search(); }
  };
  clear.onclick = e => { e.stopPropagation(); q.value = ""; q.focus(); search(); };
}
async function sendRequest(username) {
  try { const r = await api.rpc("send_request", { p_username: username }); toast(r === "accepted" ? `You and @${username} are now friends` : `Friend request sent to @${username}`); await Promise.all([loadRequests(), loadFriends()]); }
  catch (e) { toast(e.message, true); }
}
async function acceptFrom(uid) { const r = S.requests.find(x => x.user_id === uid && x.direction === "incoming"); if (!r) { await loadRequests(); } const rr = S.requests.find(x => x.user_id === uid && x.direction === "incoming"); if (rr) await respond(rr.id, true); }
async function respond(id, yes) {
  const r = S.requests.find(x => x.id === id);
  try { await api.rpc("respond_request", { p_id: id, p_accept: yes }); if (yes && r) toast(`You and ${r.display_name} are now friends`); }
  catch (e) { toast(e.message, true); }
  await Promise.all([loadRequests(), loadFriends()]);
}
function copyName(name = S.me.username) { (sky.copy ? sky.copy("@" + name.replace(/^@/, "")) : navigator.clipboard.writeText("@" + name)).then(() => toast(`Copied @${name.replace(/^@/, "")}`)).catch(() => toast("Couldn't copy", true)); }

/* ---------- friend actions ---------- */
async function unfriend(id) {
  const f = friend(id); if (!f) return;
  if (!(await dialog({ title: `Remove ${f.display_name}?`, text: "You won't be able to message or call each other until one of you sends a new request. Your conversation stays.", ok: "Remove friend", danger: true }))) return;
  try { await api.rpc("remove_friend", { p_user: id }); toast(`Removed ${f.display_name}`); if (S.view.id === id) open({ kind: "friends" }); await loadFriends(); } catch (e) { toast(e.message, true); }
}
async function block(id) {
  const p = friend(id) || (S.panel && S.panel.p) || {};
  if (!(await dialog({ title: `Block ${p.display_name || "this person"}?`, text: "They'll be removed from your friends and won't be able to find you, message you, call you or send you requests. They aren't told.", ok: "Block", danger: true }))) return;
  try { await api.rpc("block_user", { p_user: id }); toast("Blocked"); if (S.view.id === id) open({ kind: "friends" }); if (S.panel && S.panel.id === id) S.panel = null; await Promise.all([loadFriends(), loadRequests()]); renderPanel(); } catch (e) { toast(e.message, true); }
}

/* ---------- menus ---------- */
function menu(anchor, items, at) {
  closeMenu();
  const m = menuEl = document.createElement("div"); m.className = "sx-menu"; m.setAttribute("role", "menu");
  m.innerHTML = items.map(i => i === "-" ? `<hr>` : i.head ? `<div class="sx-menu-head">${i.head}</div>` : `<button role="menuitem" class="${i.danger ? "danger" : ""}${i.on ? " on" : ""}" ${i.disabled ? "disabled" : ""}>${i.icon ? icon(i.icon) : `<span class="sx-menu-dot ${i.dot || ""}"></span>`}<span>${esc(i.label)}</span>${i.hint ? `<small>${esc(i.hint)}</small>` : ""}</button>`).join("");
  document.body.appendChild(m);
  const btns = [...m.querySelectorAll("button")], acts = items.filter(i => i !== "-" && !i.head);
  btns.forEach((b, k) => b.onclick = e => { e.stopPropagation(); closeMenu(); acts[k].run(); });
  const r = at || anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  let x = at ? at.x : r.right - mw, y = at ? at.y : r.bottom + 6;
  if (y + mh > innerHeight - 8) y = (at ? at.y : r.top - 6) - mh;
  m.style.left = Math.max(8, Math.min(x, innerWidth - mw - 8)) + "px"; m.style.top = Math.max(8, y) + "px";
  btns[0] && btns[0].focus();
  m.onkeydown = e => { const i = btns.indexOf(document.activeElement); if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); } if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); } };
}
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function friendMenu(id, anchor, at) {
  const f = friend(id); if (!f) return;
  menu(anchor, [
    { label: "Message", icon: "message", run: () => open({ kind: "chat", id }) },
    { label: "Voice call", icon: "phone", run: () => CallUI.start(f, false) },
    { label: "Video call", icon: "video", run: () => CallUI.start(f, true) },
    { label: "View profile", icon: "user", run: () => showProfile(id) },
    { label: "Copy username", icon: "copy", run: () => copyName(f.username) },
    "-",
    { label: "Remove friend", icon: "userMinus", danger: true, run: () => unfriend(id) },
    { label: "Block", icon: "ban", danger: true, run: () => block(id) },
  ], at);
}
function meMenu(anchor) {
  const cur = S.settings.status || "online", set = st => SocialSettings.setStatus(st).then(heartbeat);
  menu(anchor, [
    { head: `<b>${esc(S.me.display_name)}</b><small>@${esc(S.me.username)}</small>` },
    { label: "Online", dot: "online", on: cur === "online", run: () => set("online") },
    { label: "Away", dot: "away", on: cur === "away", run: () => set("away") },
    { label: "Do not disturb", dot: "dnd", hint: "Mutes notifications", on: cur === "dnd", run: () => set("dnd") },
    { label: "Invisible", dot: "offline", hint: "Appear offline", on: cur === "invisible", run: () => set("invisible") },
    "-",
    { label: "Set a custom status", icon: "sparkle", hint: (S.me.details && S.me.details.status_text) ? "" : "", run: () => statusDialog({ onSaved: reloadMe, setPresence: st => SocialSettings.setStatus(st).then(heartbeat) }) },
    "-",
    { label: "View profile", icon: "user", run: () => showProfile(S.me.id) },
    { label: "Edit profile", icon: "edit", run: () => open({ kind: "settings", section: "profile" }) },
    { label: "Change avatar", icon: "image", run: () => SocialSettings.pickAvatar() },
    { label: "Customize appearance", icon: "palette", run: () => open({ kind: "settings", section: "appearance" }) },
    { label: "Social settings", icon: "settings", run: () => open({ kind: "settings", section: "privacy" }) },
    { label: "Copy username", icon: "copy", run: () => copyName() },
  ]);
}

/* ---------- events ---------- */
async function click(e) {
  const ln = e.target.closest("[data-link]"); if (ln && ln.closest(".pc")) { e.preventDefault(); sky.openUrl(ln.dataset.link); return; }
  const b = e.target.closest("[data-sx]"); if (!b || !root.contains(b)) return;
  const [a, x] = b.dataset.sx.split(/:(.*)/);
  if (b.closest(".sx-row-acts, .sx-avbtn") && b !== e.target.closest("[data-sx]")) return;
  e.stopPropagation();
  switch (a) {
    case "auth": if (x === "reset") return resetPassword(); authMode = x; return authScreen();
    case "signout": return api.signOut().catch(er => toast(er.message, true));
    case "go": return open({ kind: x });
    case "filter": S.view.filter = x; return renderMain();
    case "chat": S.lastDm = x; return open({ kind: "chat", id: x });
    case "profile": return showProfile(x);
    case "closepanel": S.panel = null; return emit("panel");
    case "editprofile": return open({ kind: "settings", section: "profile" });
    case "setstatus": return statusDialog({ onSaved: reloadMe, setPresence: st => SocialSettings.setStatus(st).then(heartbeat) });
    case "add": return addFriend();
    case "copyname": return copyName();
    case "copy": return copyName(x);
    case "call": { const f = friend(x); if (f) CallUI.start(f, false); return; }
    case "video": { const f = friend(x); if (f) CallUI.start(f, true); return; }
    case "menu": return friendMenu(x, b);
    case "me": return meMenu(b);
    case "accept": return respond(x, true);
    case "decline": return respond(x, false);
    case "acceptfrom": await acceptFrom(x); return S.panel && showProfile(S.panel.id);
    case "home": { const last = S.lastDm && friend(S.lastDm) ? { kind: "chat", id: S.lastDm } : { kind: "friends" }; return open(last); }
    case "server": return Servers.go(x);
    case "channel": { const c = Servers.channel(x); if (c) Servers.go(c.server_id, c.id); return; }
    case "newserver": return Servers.addServer();
    case "srvmenu": return Servers.serverMenu(x, b, menu);
    case "newchannel": return Servers.channelDialog(x);
    case "editchannel": { const c = Servers.channel(x); if (c) Servers.channelDialog(c.server_id, c.id); return; }
    case "invite": return Servers.inviteDialog(x);
    case "joininv": b.disabled = true; await Servers.join(x); return;
    case "members": { S.panel = S.panel && S.panel.kind === "members" ? null : { kind: "members", server: x }; renderPanel(); const hb = document.querySelector(`[data-sx="members:${x}"]`); if (hb) hb.classList.toggle("on", !!S.panel); return; }
    case "cancel": try { await api.rpc("cancel_request", { p_id: x }); toast("Request canceled"); } catch (er) { toast(er.message, true); } return loadRequests();
    case "request": await sendRequest(x); return S.panel && showProfile(S.panel.id);
    case "unfriend": return unfriend(x);
    case "block": return block(x);
    case "unblock": try { await api.rpc("unblock_user", { p_user: x }); toast("Unblocked"); } catch (er) { toast(er.message, true); } return S.panel && showProfile(S.panel.id);
  }
  Chat.click(a, x, b); SocialSettings.click(a, x, b);
}
function ctx(e) {
  const sv = e.target.closest("[data-srv]"); if (sv) { e.preventDefault(); return Servers.serverMenu(sv.dataset.srv, sv, menu); }
  const ch = e.target.closest("[data-cid]"); if (ch) { const c = Servers.channel(ch.dataset.cid); if (c && Servers.isAdmin(c.server_id)) { e.preventDefault(); menu(ch, [
    { label: "Edit channel", icon: "edit", run: () => Servers.channelDialog(c.server_id, c.id) }, { label: "Mark as read", icon: "check", run: () => Servers.markRead(c.id) }], { x: e.clientX, y: e.clientY }); } return; }
  const row = e.target.closest("[data-fid]"); if (!row || !friend(row.dataset.fid)) return;
  e.preventDefault(); friendMenu(row.dataset.fid, row, { x: e.clientX, y: e.clientY });
}
function keys(e) {
  const row = e.target.closest(".sx-row[data-sx]");
  if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.click(); }
  if (row && e.target === row && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); friendMenu(row.dataset.fid, row); }
}
function input(e) {
  if (e.target.id === "sxFriendQ") { S.friendQuery = e.target.value; const pos = e.target.selectionStart; renderMain(); const i = $("#sxFriendQ"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
}

export const Social = {
  init,
  show(on_) {
    visible = on_;
    if (on_ && S.me) { const k = Chat.viewKey(); if (k) Chat.seen(k); }
    CallUI.renderDock();
  },
  visible: () => visible,
  showAdmin,
  open,
  showProfile,
};
on(what => { if (what === "call") renderSide(); if (what === "panel") { renderPanel(); syncPanelBtn(); } });
function syncPanelBtn() { const b = document.querySelector('[data-sx^="togglepanel:"]'); if (b) b.classList.toggle("on", !!(S.panel && S.panel.id === b.dataset.sx.split(":")[1])); }
document.addEventListener("sx:status", () => heartbeat());
