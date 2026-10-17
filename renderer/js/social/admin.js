// Admin: only for Skyline's owner (the server checks every action itself, this page only shows them).
// The numbers, the badge library (make, edit, give, take back), people (find anyone, badges, suspend), and
// announcements to everyone. Also "Your badges": the badges you were given, and which ones you show.
import { $, esc, sky, toast, dialog } from "../util.js";
import { icon, BADGE_ICONS } from "./icons.js";
import { api } from "./api.js";
import { S, avatar, badgesHtml, ago } from "./state.js";

const A = { tab: "overview", badges: null, stats: null, users: null, q: "", open: null, holders: null };
let host = null, onMe = null;
const TABS = [["overview", "Overview", "chart"], ["badges", "Badges", "award"], ["people", "People", "users"], ["announce", "Announce", "megaphone"]];
const STYLES = [["solid", "Solid"], ["gradient", "Gradient"], ["shine", "Shine"], ["glow", "Glow"]];
const STARTERS = [   // ready-made looks to start a badge from
  { name: "Developer", icon: "code", bg: "#0f172a", bg2: "#2563eb", fg: "#93c5fd", style: "gradient", description: "Builds Skyline" },
  { name: "Founder", icon: "crown", bg: "#2a1a05", bg2: "#f59e0b", fg: "#fde68a", style: "shine", description: "Here from the very start" },
  { name: "Verified", icon: "verified", bg: "#0b1f3a", bg2: "#38bdf8", fg: "#e0f2fe", style: "glow", description: "The real deal" },
  { name: "Bug Hunter", icon: "bug", bg: "#052e1a", bg2: "#22c55e", fg: "#bbf7d0", style: "gradient", description: "Found and reported a bug" },
  { name: "Early Supporter", icon: "rocket", bg: "#2e0b3a", bg2: "#c084fc", fg: "#f3e8ff", style: "shine", description: "Joined Skyline early" },
  { name: "Champion", icon: "trophy", bg: "#3a0b0b", bg2: "#f97316", fg: "#ffedd5", style: "glow", description: "Won a Skyline event" },
];

async function mount(el, me) {
  host = el; onMe = me; draw();
  if (A.tab === "overview") loadStats(); if (A.tab === "badges") loadBadges(); if (A.tab === "people") loadUsers();
}
function draw() {
  if (!host || !host.isConnected) return;
  host.innerHTML = `<div class="ad-tabs" role="tablist">${TABS.map(([k, l, ic]) => `<button role="tab" aria-selected="${A.tab === k}" class="${A.tab === k ? "on" : ""}" data-ad="tab:${k}">${icon(ic)}<span>${l}</span></button>`).join("")}</div>
    <div class="ad-body">${body()}</div>`;
}
function body() {
  if (A.tab === "overview") {
    const s = A.stats; if (!s) return `<div class="sx-panel-load"><span class="sx-spin"></span></div>`;
    const tile = (n, l, sub = "") => `<div class="ad-stat"><b>${Number(n || 0).toLocaleString()}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
    return `<div class="ad-stats">${tile(s.users, "People", s.new_week ? `+${s.new_week} this week` : "")}${tile(s.online, "Online now")}${tile(s.active_day, "Active today")}${tile(s.messages_day, "Messages today", `${Number(s.messages).toLocaleString()} all time`)}
        ${tile(s.servers, "Servers")}${tile(s.friendships, "Friendships")}${tile(s.calls_day, "Calls today")}${tile(s.badges, "Badges made")}${tile(s.suspended, "Suspended")}</div>
      <div id="adDb" class="ad-db"></div>
      <div class="ad-quick"><button class="btn sm primary" data-ad="tab:badges">${icon("award")}Make or give a badge</button><button class="btn sm" data-ad="tab:people">${icon("users")}Find someone</button><button class="btn sm" data-ad="tab:announce">${icon("megaphone")}Send an announcement</button><button class="btn sm ghost" data-ad="refresh">${icon("refresh")}Refresh</button></div>
      <p class="sx-set-note">Only your account sees this section. The server checks that it's you on every admin action, so nobody can get these powers by changing their app.</p>`;
  }
  if (A.tab === "badges") {
    if (!A.badges) return `<div class="sx-panel-load"><span class="sx-spin"></span></div>`;
    const open = A.open && A.badges.find(b => b.id === A.open);
    return `<div class="ad-row-h"><p class="sx-set-note">Make a badge here, then give it to anyone. It shows next to their name everywhere: chats, servers, profiles.</p><button class="btn sm primary" data-ad="newbadge">${icon("plus")}New badge</button></div>
      <div class="ad-badges">${A.badges.length ? A.badges.map(b => `<button class="ad-badge${A.open === b.id ? " on" : ""}" data-ad="openbadge:${b.id}"><span class="sx-badge-big">${badgesHtml([b])}</span><span class="ad-badge-t"><b>${esc(b.name)}</b><small>${esc(b.description || "")}</small><em>${b.holders} ${b.holders === 1 ? "person has" : "people have"} it</em></span></button>`).join("")
        : `<p class="sx-none">No badges yet. Make your first one: try a Developer or Founder badge for yourself.</p>`}</div>
      ${open ? `<section class="ad-detail"><div class="ad-detail-h"><span class="sx-badge-big">${badgesHtml([open])}</span><span><b>${esc(open.name)}</b><small>${esc(open.description || "No description")}</small></span><span class="sp"></span>
          <button class="btn sm primary" data-ad="give:${open.id}">${icon("userPlus")}Give to someone</button><button class="btn sm" data-ad="editbadge:${open.id}">${icon("edit")}Edit</button><button class="btn sm danger" data-ad="delbadge:${open.id}">${icon("trash")}</button></div>
        <div class="ad-holders">${A.holders == null ? `<div class="sx-skel"></div>` : A.holders.length ? A.holders.map(h => `<div class="sx-row static">${avatar(h, 32)}<span class="sx-row-t"><b>${esc(h.display_name)}</b><small>@${esc(h.username)} · given ${esc(ago(h.granted_at))}</small></span><span class="sx-row-acts show"><button class="btn sm" data-ad="take:${h.id}:${open.id}">Take back</button></span></div>`).join("") : `<p class="sx-none">Nobody has it yet.</p>`}</div></section>` : ""}`;
  }
  if (A.tab === "people") {
    const byId = new Map((A.badges || []).map(b => [b.id, b]));
    return `<label class="sx-search">${icon("search")}<input id="adQ" placeholder="Search by username or name" value="${esc(A.q)}" spellcheck="false" autocomplete="off"></label>
      <div class="ad-people">${A.users == null ? `<div class="sx-skel"></div><div class="sx-skel"></div>` : A.users.length ? A.users.map(u => `<div class="sx-row static${u.suspended ? " ad-sus" : ""}">${avatar(u, 36, u.status)}<span class="sx-row-t"><b>${esc(u.display_name)}${u.admin ? ` <span class="ad-tag">Admin</span>` : ""}${u.suspended ? ` <span class="ad-tag bad">Suspended</span>` : ""}</b>
          <small>@${esc(u.username)} · joined ${esc(new Date(u.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }))} · ${u.friends} friend${u.friends === 1 ? "" : "s"}${u.suspended && u.suspended.reason ? " · " + esc(u.suspended.reason) : ""}</small></span>
          <span class="ad-ubadges">${badgesHtml(u.badges.map(id => byId.get(id)).filter(Boolean), true)}</span>
          <span class="sx-row-acts show"><button class="btn sm" data-ad="givepick:${u.id}">${icon("award")}Badge</button>${u.admin || u.id === S.me.id ? "" : `<button class="btn sm ${u.suspended ? "" : "danger"}" data-ad="suspend:${u.id}:${u.suspended ? 0 : 1}">${u.suspended ? "Unsuspend" : "Suspend"}</button>`}</span></div>`).join("")
        : `<p class="sx-none">No one matches.</p>`}</div>`;
  }
  if (A.tab === "announce") return `<p class="sx-set-note">Sends a message from Skyline to everyone's Activity, with a notification. Use it for news like new features. Up to 500 characters.</p>
      <label class="sx-field"><span>Announcement</span><textarea id="adText" rows="4" maxlength="500" placeholder="Servers are here! Make one from the + on the left of Social."></textarea><small id="adCount">0 / 500</small></label>
      <div class="sx-form-acts"><button class="btn primary sm" data-ad="announce">${icon("megaphone")}Send to everyone</button></div>`;
  return "";
}
async function loadStats() { try { A.stats = await api.rpc("admin_stats"); } catch (e) { A.stats = A.stats || {}; } if (A.tab === "overview") { draw(); dbBox(); } }
// database updates, without opening Supabase: a token once, then every update goes in by itself
async function dbBox() {
  const el = $("#adDb"); if (!el || !sky.db) return;
  const r = await sky.db.status(); if (!r || !r.ok) return; const s = r.data;
  el.innerHTML = !s.hasToken ? `<b>Database updates</b><p>Let Skyline update the database by itself, so you never have to open Supabase again. Do this once:</p>
      <ol><li>Open <a href="#" data-dblink>supabase.com → Account → Access Tokens</a> (it opens in a Skyline window; sign in with GitHub once and it remembers you).</li><li>Click <b>Generate new token</b>, name it “Skyline”, and copy it (it starts with <b>sbp_</b>).</li><li>Paste it here:</li></ol>
      <div class="ad-db-row"><input type="password" id="adDbTok" placeholder="sbp_…" autocomplete="off" spellcheck="false"><button class="btn sm primary" data-ad="dbtoken">Save and update now</button></div>
      <small>The token stays encrypted on this PC and only your Skyline uses it.</small>`
    : `<b>Database</b> ${s.upToDate ? `<span class="ad-ok">Up to date</span>` : `<span class="ad-warn">Update ready</span>`}
      <p>${s.upToDate ? `Updated ${s.at ? new Date(s.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}. New versions of Skyline bring their database changes in by themselves.` : `This version of Skyline has database changes. ${s.error ? "Last try: " + esc(s.error) : ""}`}</p>
      <div class="ad-db-row">${s.upToDate ? "" : `<button class="btn sm primary" data-ad="dbapply">Update the database now</button>`}<button class="btn sm ghost" data-ad="dbforget">Remove token</button></div>
      <p class="ad-mail">${s.authError ? `<span class="ad-warn">Sign-in email</span> Couldn't set up the "forgot password" email: ${esc(s.authError)}`
        : !s.authReady ? `<span class="ad-warn">Sign-in email</span> Skyline sets up the "forgot password" email (a 6-digit code) on the server shortly.`
        : s.customEmail === false ? `<span class="ad-warn">Sign-in email</span> Your server sends with Supabase's built-in email, which only reaches people on your Supabase team.`
        : `<span class="ad-ok">Sign-in email</span> "Forgot password" sends a 6-digit code.`}</p>
      ${!s.authReady || s.customEmail === false ? `<details class="ad-smtp" ${s.authError ? "open" : ""}><summary>Set up the email sender, so friends get their codes</summary>
        <p>Use any email account. With Gmail: turn on 2-Step Verification, make an <b>app password</b> at myaccount.google.com/apppasswords, and use it below (not your normal password).</p>
        <div class="ad-smtp-g">
          <label><span>From address</span><input id="adSmFrom" placeholder="you@gmail.com" autocomplete="off" spellcheck="false"></label>
          <label><span>Server</span><input id="adSmHost" value="smtp.gmail.com" spellcheck="false"></label>
          <label><span>Port</span><input id="adSmPort" value="465" inputmode="numeric"></label>
          <label><span>Username</span><input id="adSmUser" placeholder="you@gmail.com" autocomplete="off" spellcheck="false"></label>
          <label><span>Password</span><input id="adSmPass" type="password" placeholder="app password" autocomplete="new-password"></label>
        </div>
        <div class="ad-db-row"><button class="btn sm primary" data-ad="smtp">Save and set up the code email</button></div>
        <small>It goes straight to your Supabase project; Skyline doesn't keep it.</small></details>` : ""}`;
}
async function loadBadges() { try { A.badges = await api.rpc("admin_badges") || []; } catch (e) { A.badges = []; toast(e.message, true); } if (A.tab === "badges" || A.tab === "people") draw(); if (A.open) loadHolders(A.open); }
async function loadHolders(id) { A.holders = null; draw(); try { A.holders = await api.rpc("admin_badge_holders", { p_badge: id }) || []; } catch (e) { A.holders = []; } if (A.open === id) draw(); }
async function loadUsers() { if (!A.badges) loadBadges(); try { A.users = await api.rpc("admin_users", { p_query: A.q }) || []; } catch (e) { A.users = []; toast(e.message, true); } if (A.tab === "people") draw(); }

/* ---------- making a badge ---------- */
function badgeEditor(start) {
  const b = { name: "", description: "", icon: "star", bg: "#1e1b4b", bg2: "#7c3aed", fg: "#ede9fe", border: "", style: "gradient", ...(start || {}) };
  const m = $("#dlg");
  const preview = () => `<div class="ad-prev"><span class="sx-badge-big">${badgesHtml([{ ...b, name: b.name || "Badge" }])}</span>
      <span class="ad-prev-in"><span class="ad-prev-row">${avatar(S.me, 30)}<b>${esc(S.me.display_name)}</b>${badgesHtml([{ ...b, name: b.name || "Badge" }], true)}<small>Today at 9:41 PM</small></span><span class="ad-prev-row muted">How it looks next to a name</span></span></div>`;
  m.innerHTML = `<div class="dlg-box ad-editor" role="dialog" aria-modal="true" aria-label="Badge"><div class="sx-add-head"><h3>${b.id ? "Edit badge" : "New badge"}</h3><span class="sp"></span><button class="ibtn" data-b="close" aria-label="Close">${icon("x")}</button></div>
    <div id="adPrev">${preview()}</div>
    ${b.id ? "" : `<div class="ad-starters"><small>Start from</small>${STARTERS.map((s, i) => `<button data-b="starter:${i}" title="${esc(s.name)}">${badgesHtml([s], true)}<span>${esc(s.name)}</span></button>`).join("")}</div>`}
    <div class="ad-ed-grid"><label class="sx-field"><span>Name</span><input id="adBName" maxlength="24" value="${esc(b.name)}" placeholder="e.g. Founder" spellcheck="false"></label>
      <label class="sx-field"><span>Description <i>(shows when you point at it)</i></span><input id="adBDesc" maxlength="100" value="${esc(b.description)}" placeholder="e.g. Here from the very start"></label></div>
    <div class="sx-field"><span>Symbol</span><div class="sx-icons ad-icons">${BADGE_ICONS.map(k => `<button class="sx-iconpick${b.icon === k ? " on" : ""}" data-b="icon:${k}" title="${k}" aria-label="${k}">${icon(k)}</button>`).join("")}<button class="sx-iconpick${!b.icon ? " on" : ""}" data-b="icon:" title="First letter" aria-label="First letter"><span class="sx-noic">Aa</span></button></div></div>
    <div class="sx-field"><span>Style</span><div class="seg sm ad-styles">${STYLES.map(([k, l]) => `<button class="${b.style === k ? "on" : ""}" data-b="style:${k}">${l}</button>`).join("")}</div></div>
    <div class="sx-badge-colors"><label class="sx-color"><input type="color" data-bc="bg" value="${b.bg}"><span>Background</span></label><label class="sx-color${b.style === "solid" ? " dim" : ""}"><input type="color" data-bc="bg2" value="${b.bg2 || b.bg}"><span>${b.style === "glow" ? "Glow" : "Second colour"}</span></label><label class="sx-color"><input type="color" data-bc="fg" value="${b.fg}"><span>Symbol</span></label>
      <label class="sx-color"><input type="checkbox" data-bc="hasborder" ${b.border ? "checked" : ""}><input type="color" data-bc="border" value="${b.border || b.fg}" ${b.border ? "" : "disabled"}><span>Border</span></label></div>
    <div class="dlg-acts"><button class="btn ghost" data-b="close">Cancel</button><button class="btn primary" data-b="save">${b.id ? "Save badge" : "Make badge"}</button></div></div>`;
  m.classList.remove("hidden"); $("#adBName").focus();
  const close = () => { m.classList.add("hidden"); m.onclick = m.oninput = null; document.removeEventListener("keydown", key, true); };
  const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", key, true);
  const refresh = () => { $("#adPrev").innerHTML = preview(); };
  m.oninput = e => { const t = e.target;
    if (t.id === "adBName") b.name = t.value; if (t.id === "adBDesc") b.description = t.value;
    if (["bg", "bg2", "fg", "border"].includes(t.dataset.bc)) b[t.dataset.bc] = t.value;
    if (t.dataset.bc === "hasborder") { const c = m.querySelector('[data-bc="border"]'); c.disabled = !t.checked; b.border = t.checked ? c.value : ""; }
    refresh(); };
  m.onclick = async e => {
    if (e.target === m) return close();
    const x = e.target.closest("[data-b]"); if (!x) return;
    const [a, v] = x.dataset.b.split(/:(.*)/);
    if (a === "close") return close();
    if (a === "starter") { close(); return badgeEditor({ ...STARTERS[+v] }); }
    if (a === "icon") { b.icon = v; m.querySelectorAll(".ad-icons .sx-iconpick").forEach(p => p.classList.toggle("on", p.dataset.b === "icon:" + v)); return refresh(); }
    if (a === "style") { b.style = v; m.querySelectorAll(".ad-styles button").forEach(p => p.classList.toggle("on", p.dataset.b === "style:" + v)); m.querySelector('[data-bc="bg2"]').parentElement.classList.toggle("dim", v === "solid"); return refresh(); }
    if (a === "save") {
      b.name = b.name.trim(); if (!b.name) { $("#adBName").focus(); return toast("Give the badge a name", true); }
      x.disabled = true;
      try {
        const id = await api.rpc("admin_save_badge", { p_id: b.id || null, p_data: { name: b.name, description: b.description.trim(), icon: b.icon || "", bg: b.bg, bg2: b.style === "solid" ? "" : b.bg2, fg: b.fg, border: b.border || "", style: b.style } });
        close(); toast(b.id ? "Badge saved" : `Made the ${b.name} badge`); A.open = id; await loadBadges(); if (onMe) onMe();
        if (!b.id && await dialog({ title: `Give ${b.name} to yourself?`, text: "You can give it to anyone from the Badges or People tab.", ok: "Give it to me", cancel: "Not now" })) give(id, S.me.id);
      } catch (er) { toast(er.message, true); x.disabled = false; }
    }
  };
}

/* ---------- giving ---------- */
async function give(badge, user) {
  try { await api.rpc("admin_give_badge", { p_user: user, p_badge: badge }); toast("Badge given"); if (user === S.me.id && onMe) onMe(); await loadBadges(); if (A.tab === "people") loadUsers(); }
  catch (e) { toast(e.message, true); }
}
// pick a person for a badge
function pickPerson(badge) {
  const b = (A.badges || []).find(x => x.id === badge); if (!b) return;
  const m = $("#dlg");
  m.innerHTML = `<div class="dlg-box sx-add" role="dialog" aria-modal="true" aria-label="Give badge"><div class="sx-add-head"><h3>Give ${esc(b.name)}</h3><span class="sp"></span><button class="ibtn" data-g="close" aria-label="Close">${icon("x")}</button></div>
    <div class="ad-give-b">${badgesHtml([b], false, true)}</div>
    <label class="sx-search">${icon("search")}<input id="adGQ" placeholder="Username or name" spellcheck="false" autocomplete="off"></label><div class="sx-add-res" id="adGRes"></div></div>`;
  m.classList.remove("hidden");
  const q = $("#adGQ"), res = $("#adGRes"); q.focus();
  const close = () => { m.classList.add("hidden"); m.onclick = null; document.removeEventListener("keydown", key, true); };
  const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", key, true);
  let t = 0, seq = 0;
  const search = async () => { const my = ++seq; res.innerHTML = `<div class="sx-skel"></div>`;
    const list = await api.rpc("admin_users", { p_query: q.value.trim() }).catch(() => []); if (my !== seq) return;
    res.innerHTML = list.length ? list.slice(0, 20).map(u => `<div class="sx-row static">${avatar(u, 34, u.status)}<span class="sx-row-t"><b>${esc(u.display_name)}</b><small>@${esc(u.username)}</small></span><span class="sx-row-acts show">${u.badges.includes(badge) ? `<span class="sx-pending">${icon("check")}Has it</span>` : `<button class="btn sm primary" data-g="give:${u.id}">Give</button>`}</span></div>`).join("") : `<p class="sx-none">No one matches.</p>`; };
  q.oninput = () => { clearTimeout(t); t = setTimeout(search, 220); }; search();
  m.onclick = async e => { if (e.target === m) return close(); const x = e.target.closest("[data-g]"); if (!x) return; const [a, v] = x.dataset.g.split(/:(.*)/);
    if (a === "close") return close();
    if (a === "give") { x.disabled = true; await give(badge, v); search(); if (A.open === badge) loadHolders(badge); } };
}
// pick a badge for a person (from People)
function pickBadge(user, anchor) {
  const list = A.badges || []; if (!list.length) { toast("Make a badge first (Badges tab)", true); return; }
  const u = (A.users || []).find(x => x.id === user) || {};
  const box = document.createElement("div"); box.className = "sx-menu ad-bmenu"; box.setAttribute("role", "menu");
  box.innerHTML = `<div class="sx-menu-head"><b>Badges for ${esc(u.display_name || "")}</b></div>` + list.map(b => { const has = (u.badges || []).includes(b.id);
    return `<button role="menuitemcheckbox" aria-checked="${has}" data-pb="${b.id}">${badgesHtml([b], true)}<span>${esc(b.name)}</span>${has ? `<small>${icon("check")}Has it · click to take back</small>` : ""}</button>`; }).join("");
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect(); box.style.left = Math.max(8, Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8)) + "px";
  box.style.top = (r.bottom + box.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - box.offsetHeight - 6) : r.bottom + 6) + "px";
  const away = e => { if (!box.contains(e.target)) done(); }, done = () => { box.remove(); document.removeEventListener("mousedown", away, true); };
  setTimeout(() => document.addEventListener("mousedown", away, true));
  box.onclick = async e => { const b = e.target.closest("[data-pb]"); if (!b) return; done(); const has = (u.badges || []).includes(b.dataset.pb);
    if (has) { try { await api.rpc("admin_take_badge", { p_user: user, p_badge: b.dataset.pb }); toast("Badge taken back"); if (user === S.me.id && onMe) onMe(); loadUsers(); loadBadges(); } catch (er) { toast(er.message, true); } }
    else { await give(b.dataset.pb, user); } };
}

/* ---------- clicks ---------- */
document.addEventListener("click", e => { if (e.target.closest("[data-dblink]")) { e.preventDefault(); sky.db.tokenPage(); } });
async function click(e) {
  const b = e.target.closest("[data-ad]"); if (!b || !host || !host.contains(b)) return false;
  const [a, x, y] = b.dataset.ad.split(":");
  if (a === "tab") { A.tab = x; draw(); if (x === "overview") loadStats(); if (x === "badges") loadBadges(); if (x === "people") loadUsers(); if (x === "announce") $("#adText")?.focus(); return true; }
  if (a === "dbtoken") { const t = $("#adDbTok").value; b.disabled = true; b.textContent = "Checking…";
    const r = await sky.db.setToken(t); if (!r.ok) { toast(r.error, true); b.disabled = false; b.textContent = "Save and update now"; return true; }
    b.textContent = "Updating…"; const u = await sky.db.apply(); toast(u.ok ? "Database updated" : u.error, !u.ok); dbBox(); return true; }
  if (a === "dbapply") { b.disabled = true; b.textContent = "Updating…"; const u = await sky.db.apply(); toast(u.ok ? "Database updated" : u.error, !u.ok); dbBox(); return true; }
  if (a === "dbforget") { await sky.db.forget(); dbBox(); return true; }
  if (a === "smtp") {
    const v = id => ($("#" + id) || {}).value || "";
    b.disabled = true; b.textContent = "Setting up…";
    const r = await sky.db.setSmtp({ sender: v("adSmFrom"), host: v("adSmHost"), port: v("adSmPort"), user: v("adSmUser") || v("adSmFrom"), pass: v("adSmPass"), name: "Skyline" });
    toast(r.ok ? "Email sender set up. Friends now get a 6-digit code." : r.error, !r.ok); dbBox(); return true;
  }
  if (a === "refresh") { A.stats = null; draw(); loadStats(); return true; }
  if (a === "newbadge") { badgeEditor(); return true; }
  if (a === "openbadge") { A.open = A.open === x ? null : x; draw(); if (A.open) loadHolders(x); return true; }
  if (a === "editbadge") { const bd = A.badges.find(z => z.id === x); if (bd) badgeEditor({ ...bd, description: bd.description || "", border: bd.border || "", bg2: bd.bg2 || bd.bg }); return true; }
  if (a === "delbadge") { const bd = A.badges.find(z => z.id === x); if (!bd || !(await dialog({ title: `Delete ${bd.name}?`, text: `It's removed from ${bd.holders} ${bd.holders === 1 ? "person" : "people"} too. This can't be undone.`, ok: "Delete badge", danger: true }))) return true;
    try { await api.rpc("admin_delete_badge", { p_id: x }); A.open = null; toast("Badge deleted"); await loadBadges(); if (onMe) onMe(); } catch (er) { toast(er.message, true); } return true; }
  if (a === "give") { pickPerson(x); return true; }
  if (a === "take") { try { await api.rpc("admin_take_badge", { p_user: x, p_badge: y }); toast("Badge taken back"); if (x === S.me.id && onMe) onMe(); await loadBadges(); } catch (er) { toast(er.message, true); } return true; }
  if (a === "givepick") { pickBadge(x, b); return true; }
  if (a === "suspend") {
    const u = (A.users || []).find(z => z.id === x) || {}, on = y === "1";
    let reason = "";
    if (on) { reason = await dialog({ title: `Suspend ${u.display_name || "this account"}?`, text: "They can't message, call, post or add anyone until you unsuspend them. Give a short reason (only admins see it).", input: "", ok: "Suspend", danger: true }); if (reason == null) return true; }
    try { await api.rpc("admin_suspend", { p_user: x, p_on: on, p_reason: reason || "" }); toast(on ? "Suspended" : "Unsuspended"); loadUsers(); } catch (er) { toast(er.message, true); } return true;
  }
  if (a === "announce") {
    const t = ($("#adText").value || "").trim(); if (t.length < 2) { $("#adText").focus(); return true; }
    if (!(await dialog({ title: "Send to everyone?", text: `“${t.slice(0, 160)}${t.length > 160 ? "…" : ""}” goes to every Skyline account's Activity, with a notification.`, ok: "Send announcement" }))) return true;
    try { const n = await api.rpc("admin_announce", { p_text: t }); toast(`Sent to ${n} ${n === 1 ? "person" : "people"}`); $("#adText").value = ""; } catch (er) { toast(er.message, true); } return true;
  }
  return false;
}
function input(e) {
  if (e.target.id === "adQ") { A.q = e.target.value; clearTimeout(input.t); input.t = setTimeout(() => { const pos = e.target.selectionStart; loadUsers().then(() => { const i = $("#adQ"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }); }, 250); return true; }
  if (e.target.id === "adText") { const c = $("#adCount"); if (c) c.textContent = `${e.target.value.length} / 500`; return true; }
  return false;
}

/* ---------- your badges (everyone) ---------- */
async function mountMine(el, refreshMe) {
  el.innerHTML = `<div class="sx-skel"></div>`;
  let list = [];
  try { list = await api.rpc("my_badges") || []; } catch (e) { el.innerHTML = `<p class="sx-none bad">${esc(e.message)}</p>`; return; }
  const draw_ = () => { el.innerHTML = list.length ? `<div class="ad-mine">${list.map(b => `<div class="ad-mine-row"><span class="sx-badge-big">${badgesHtml([b])}</span><span class="ad-badge-t"><b>${esc(b.name)}</b><small>${esc(b.description || "")}</small><em>Given ${esc(ago(b.granted_at))}</em></span>
      <label class="sx-check" title="Show on my profile"><input type="checkbox" data-mybadge="${b.id}" ${b.hidden ? "" : "checked"}><span>Show</span></label></div>`).join("")}</div>`
    : `<p class="sx-none">You don't have any badges yet. Badges are given out by Skyline for things like being an early supporter, finding bugs or winning events.</p>`; };
  draw_();
  el.onchange = async e => { const t = e.target; if (!t.dataset.mybadge) return; const b = list.find(x => x.id === t.dataset.mybadge);
    try { await api.rpc("show_badge", { p_badge: b.id, p_show: t.checked }); b.hidden = !t.checked; toast(t.checked ? "Shown on your profile" : "Hidden from your profile"); if (refreshMe) refreshMe(); }
    catch (er) { t.checked = !t.checked; toast(er.message, true); } };
}

export const Admin = { mount, click, input, mountMine };
