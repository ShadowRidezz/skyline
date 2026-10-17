// Social settings: your profile, your own look (colours and badges, saved to your account), privacy,
// notifications, microphone & camera, and blocked people.
import { $, esc, toast, dialog, lum, mixHex } from "../util.js";
import { icon, BADGE_ICONS } from "./icons.js";
import { api } from "./api.js";
import { S, emit, avatar, badgesHtml } from "./state.js";
import { permissionWords } from "./call.js";
import { openMic, VOICE_QUALITY } from "./audio.js";
import { mountEditor, pickProfilePicture, confirmLeave } from "./editor.js";
import { Admin } from "./admin.js";

let ctx = null, host = null, section = "profile", testStream = null, testTrack = null, testEl = null, meterRaf = 0, saveT = 0;
// (Admin only shows for Skyline's owner)
const SECTIONS = () => [["profile", "Profile", "user"], ["badges", "Badges", "award"], ["appearance", "Appearance", "palette"], ["chat", "Chat", "message"], ["privacy", "Privacy & safety", "shield"],
  ["notifications", "Notifications", "bell"], ["devices", "Voice & video", "mic"], ["blocked", "Blocked", "ban"], ["account", "Account", "logOut"]];

/* ---------- your colours: applied to your Skyline only ---------- */
export const PRESETS = [
  { name: "Skyline", accent: "#8b5cf6", highlight: "#3b82f6", button: "#7c6cf6", nav: "#8b5cf6", subtle: "#a78bfa" },
  { name: "Glacier", accent: "#5aa9e6", highlight: "#7fc8f8", button: "#4a98d8", nav: "#5aa9e6", subtle: "#9cd3f5" },
  { name: "Mint", accent: "#34c39a", highlight: "#5fd3b8", button: "#22a884", nav: "#34c39a", subtle: "#88e0c4" },
  { name: "Ember", accent: "#f0855a", highlight: "#f5b04c", button: "#e2703f", nav: "#f0855a", subtle: "#f7b48f" },
  { name: "Rose", accent: "#e8628a", highlight: "#c56ae0", button: "#d9507b", nav: "#e8628a", subtle: "#f29bb6" },
  { name: "Graphite", accent: "#a1a1aa", highlight: "#d4d4d8", button: "#71717a", nav: "#d4d4d8", subtle: "#a1a1aa" },
];
const COLOR_FIELDS = [["accent", "Accent", "Links, focus and highlights across Skyline"], ["highlight", "Highlight", "The second colour in gradients and charts"],
  ["button", "Buttons", "Main action buttons"], ["nav", "Selected navigation", "The page you're on, in the sidebar"], ["subtle", "Subtle highlights", "Text selection and soft accents"]];
const HEX = /^#[0-9a-f]{6}$/i;
export function applyAppearance(a) {
  let st = $("#sxPersonal");
  const ok = a && COLOR_FIELDS.every(([k]) => HEX.test(a[k] || ""));
  document.body.classList.toggle("personal", !!ok);
  if (!ok) { if (st) st.remove(); return; }
  if (!st) { st = document.createElement("style"); st.id = "sxPersonal"; document.head.appendChild(st); }
  const onBtn = lum(a.button) > .45 ? "#0b0b10" : "#ffffff";
  st.textContent = `:root{--a1:${a.accent}!important;--a2:${a.highlight}!important;--grad:linear-gradient(135deg,${a.accent},${a.highlight})!important;--a-soft:${mixHex(a.subtle, "#ffffff", .35)}!important;--p-btn:${a.button};--p-on-btn:${onBtn};--p-nav:${a.nav};--p-hl:${a.subtle}}`;
}

/* ---------- drawing ---------- */
function render(el, sec) {
  host = el; section = sec || section;
  if (section === "admin") section = "profile";   // (Admin is its own tab now)
  stopTest();
  el.innerHTML = `<header class="sx-head"><h2>Social settings</h2></header>
    <div class="sx-set"><nav class="sx-set-nav">${SECTIONS().map(([k, l, ic]) => `<button class="${k === section ? "on" : ""}${k === "admin" ? " admin" : ""}" data-sx="set:${k}">${icon(ic)}<span>${l}</span></button>`).join("")}</nav>
    <div class="sx-set-body sx-scroll" id="sxSetBody">${body()}</div></div>`;
  if (section === "devices") devices();
  if (section === "profile") mountEditor($("#sxPe"), ctx);
  if (section === "admin") Admin.mount($("#sxAdmin"), () => ctx.reloadMe());
  if (section === "badges") Admin.mountMine($("#sxMyBadges"), () => ctx.reloadMe());
}
const row = (label, help, control) => `<div class="sx-set-row"><div class="sx-set-l"><b>${label}</b>${help ? `<small>${help}</small>` : ""}</div><div class="sx-set-c">${control}</div></div>`;
const toggle = (key, on) => `<label class="toggle"><input type="checkbox" data-set="${key}" ${on ? "checked" : ""}><span class="sw"></span></label>`;
const block = (title, inner, note) => `<section class="sx-set-block"><h3>${title}</h3>${note ? `<p class="sx-set-note">${note}</p>` : ""}${inner}</section>`;

function body() {
  const me = S.me, set = S.settings, n = set.notify || {};
  if (section === "profile") return `<section class="sx-set-block pe-host"><div id="sxPe"></div></section>`;
  if (section === "admin") return `<section class="sx-set-block"><h3>Admin</h3><div id="sxAdmin"></div></section>`;
  if (section === "badges") return block("Your badges", `<div id="sxMyBadges"></div>`, "Badges show next to your name in chats, servers and on your profile. Choose which ones to show (up to six)."
    + (S.isAdmin ? ` To make new badges or give them to people, open the Admin tab in the sidebar.` : ""));
  if (section === "appearance") {
    const a = set.appearance || {}, cur = COLOR_FIELDS.every(([k]) => HEX.test(a[k] || "")) ? a : null;
    return block("Your colours", `
      <div class="sx-presets">${PRESETS.map(p => `<button class="sx-preset${cur && COLOR_FIELDS.every(([k]) => cur[k] === p[k]) ? " on" : ""}" data-sx="preset:${p.name}" title="${p.name}"><span style="background:linear-gradient(135deg,${p.accent},${p.highlight})"></span><small>${p.name}</small></button>`).join("")}</div>
      ${COLOR_FIELDS.map(([k, l, h]) => row(l, h, `<label class="sx-color"><input type="color" data-color="${k}" value="${(cur || PRESETS[0])[k]}"><span class="sx-mono">${(cur || PRESETS[0])[k]}</span></label>`)).join("")}
      <div class="sx-preview"><span class="sx-preview-l">Preview</span><button class="btn primary sm" type="button">Primary button</button><span class="sx-preview-nav"><span class="sx-preview-dot"></span>Selected page</span><span class="sx-preview-sel">Selected text</span><a href="#" onclick="return false">A link</a></div>
      <div class="sx-form-acts"><button class="btn sm ghost" data-sx="resetcolors" ${cur ? "" : "disabled"}>Reset to theme colours</button></div>`,
      "These change how Skyline looks for you, on this account. Friends see their own colours. When nothing is set, your Theme Studio colours are used.")
      + block("Motion", row("Animated pictures", "Animated avatars and banners. Windows' reduced-motion setting always keeps them still.", `<select class="sx-select" data-set="motion.avatars">${[["always", "Always play"], ["hover", "Play when I point at them"], ["never", "Keep them still"]].map(([v, l]) => `<option value="${v}" ${((set.motion || {}).avatars || "always") === v ? "selected" : ""}>${l}</option>`).join("")}</select>`));
  }
  if (section === "privacy") return block("Your status", `
      ${row("Status", "What friends see next to your name.", `<select class="sx-select" data-set="status">${[["online", "Online"], ["away", "Away"], ["dnd", "Do not disturb"], ["invisible", "Invisible (appear offline)"]].map(([v, l]) => `<option value="${v}" ${(set.status || "online") === v ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
      ${row("Go Away when idle", "After 10 minutes without using your PC.", toggle("autoAway", set.autoAway !== false))}
      ${row("Show what I'm playing", "Friends and your servers see “Playing Fortnite · 25 min” while a game is open.", toggle("shareGame", set.shareGame !== false))}`)
    + block("Friend requests", row("Who can send you requests", "Anyone else can still find you by username, but can't send a request.", `<select class="sx-select" data-set="allow_requests">${[["everyone", "Everyone"], ["friends_of_friends", "Friends of friends"], ["nobody", "No one"]].map(([v, l]) => `<option value="${v}" ${me.allow_requests === v ? "selected" : ""}>${l}</option>`).join("")}</select>`))
    + block("Calls", row("Who can call you", "Off: friends can still message you. Checked by the server, not just this app.", `<select class="sx-select" data-set="allow_calls"><option value="true" ${(me.details || {}).allow_calls !== false ? "selected" : ""}>Friends</option><option value="false" ${(me.details || {}).allow_calls === false ? "selected" : ""}>No one</option></select>`))
    + block("Messages", `<p class="sx-set-note">Only you and the friend you're talking to can read your messages and open your files. Blocking someone stops them messaging, calling or finding you.</p>`);
  if (section === "chat") { const ch = set.chat || {};
    return block("Messages", `
      ${row("Message spacing", "Compact fits more messages on screen.", `<select class="sx-select" data-set="chat.density"><option value="comfortable" ${ch.density !== "compact" ? "selected" : ""}>Comfortable</option><option value="compact" ${ch.density === "compact" ? "selected" : ""}>Compact</option></select>`)}
      ${row("Enter sends messages", "Off: Ctrl+Enter sends, Enter adds a new line.", toggle("enterSends", set.enterSends !== false))}
      ${row("Big emoji", "Messages that are only one to three emoji show large.", toggle("chat.bigEmoji", ch.bigEmoji !== false))}
      ${row("Show link addresses", "Links in messages are clickable and open in your browser.", toggle("chat.links", ch.links !== false))}`)
    + block("Stickers & emoji", row("Recently used", "Clear the emoji and stickers you used lately.", `<button class="btn sm" data-sx="clearrecent">Clear</button>`)); }
  if (section === "notifications") return block("Notifications", `
      ${row("Desktop notifications", "When Skyline isn't the window in front.", toggle("notify.desktop", n.desktop !== false))}
      ${row("Sounds", "A soft chime for messages and a ring for calls.", toggle("notify.sound", n.sound !== false))}
      ${row("New messages", "", toggle("notify.message", n.message !== false))}
      ${row("Show message text", "Off: notifications only say who it's from.", toggle("notify.preview", n.preview !== false))}
      ${row("Friend requests", "", toggle("notify.request", n.request !== false))}
      ${row("Accepted requests", "", toggle("notify.accepted", n.accepted !== false))}
      ${row("Missed calls", "", toggle("notify.missed_call", n.missed_call !== false))}
      ${row("Ring for calls in Do not disturb", "Off: calls still show, silently.", toggle("notify.dndCalls", !!n.dndCalls))}`,
      "Do not disturb mutes all of these. Incoming calls still show inside Skyline, silently.");
  const vo = set.voice || {};
  if (section === "devices") return block("Microphone", `<div id="sxDevMic">${row("Input device", "", `<select class="sx-select" data-dev="mic"><option>Loading…</option></select>`)}</div>
      ${row("Test", "Speak: the bar should move. With headphones on, Hear yourself plays back exactly what friends hear.", `<div class="sx-meter"><i id="sxMeter"></i></div><button class="btn sm" data-sx="testmic">Test</button><button class="btn sm" data-sx="hearmic">Hear yourself</button>`)}
      ${row("Voice quality", esc((VOICE_QUALITY[vo.quality] || VOICE_QUALITY.high).note), `<select class="sx-select" data-set="voice.quality">${Object.entries(VOICE_QUALITY).map(([k, q]) => `<option value="${k}" ${(VOICE_QUALITY[vo.quality] ? vo.quality : "high") === k ? "selected" : ""}>${q.label} · ${q.kbps} kbps</option>`).join("")}</select>`)}
      ${row("Clear voice", "Takes out rumble and desk bumps, and keeps you at one steady volume.", toggle("voice.clear", vo.clear !== false))}
      ${vo.quality === "studio" ? "" : row("Noise suppression", "Cuts fans, keyboards and background noise.", toggle("voice.noise", vo.noise !== false))}
      ${row("Echo cancellation", "Stops friends hearing themselves through your speakers. Turn off only with headphones.", toggle("voice.echo", vo.echo !== false))}
      ${vo.quality === "studio" ? "" : row("Automatic volume", "Evens out how loud you sound.", toggle("voice.agc", vo.agc !== false))}
      ${row("Join calls muted", "Unmute when you're ready to talk.", toggle("voice.joinMuted", !!vo.joinMuted))}`)
    + block("Call volume", row("How loud friends sound", "Above 100% boosts quiet microphones. You can also change it during a call.", `<input type="range" class="rg sx-volset" min="0" max="300" step="10" value="${vo.volume ?? 200}" data-set="voice.volume"><b class="sx-mono" id="sxVolVal">${vo.volume ?? 200}%</b>`))
    + block("Speakers", row("Output device", "Where you hear calls.", `<select class="sx-select" data-dev="out"><option>Loading…</option></select>`))
    + block("Camera", `${row("Camera", "", `<select class="sx-select" data-dev="cam"><option>Loading…</option></select>`)}
      <div class="sx-campreview"><video id="sxCamPrev" autoplay muted playsinline></video><button class="btn sm" data-sx="testcam">Preview camera</button></div>`,
      "If a device doesn't work: make sure no other app is using it, and that Windows Settings → Privacy & security → Microphone / Camera allows desktop apps.");
  if (section === "blocked") {
    const list = S.blocked || [];
    return block("Blocked", list.length ? list.map(b => `<div class="sx-row static">${avatar(b, 34)}<span class="sx-row-t"><b>${esc(b.display_name)}</b><small>@${esc(b.username)}</small></span><span class="sx-row-acts show"><button class="btn sm" data-sx="unblockset:${b.id}">Unblock</button></span></div>`).join("")
      : `<p class="sx-none">You haven't blocked anyone.</p>`, "Blocked people can't find you, see your profile, message you, call you or send you requests.");
  }
  if (section === "account") return block("Account", `${row("Signed in as", "", `<span class="sx-mono">${esc((S.user && S.user.email) || "")}</span>`)}
      ${row("Sign out", "You'll appear offline to friends.", `<button class="btn sm danger" data-sx="signoutset">${icon("logOut")}Sign out</button>`)}`);
  return "";
}

/* ---------- saving ---------- */
async function save() {
  try { await api.rpc("save_settings", { p_data: S.settings }); }
  catch (e) { toast("Couldn't save: " + e.message, true); throw e; }
}
const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => save().catch(() => {}), 500); };
function rerender() { if (host && S.view.kind === "settings") { const b = $("#sxSetBody"), y = b ? b.scrollTop : 0; render(host, section); const nb = $("#sxSetBody"); if (nb) nb.scrollTop = y; } }
async function setStatus(st) { S.settings.status = st; await save().catch(() => {}); if (section === "privacy") rerender(); }

/* ---------- avatar ---------- */
function pickAvatar() {
  if (S.view.kind !== "settings" || section !== "profile") { ctx.open({ kind: "settings", section: "profile" }); setTimeout(pickProfilePicture, 120); return; }
  return pickProfilePicture();
}
/* ---------- microphone, speakers, camera ---------- */
async function devices() {
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
  const d = S.settings.devices || {};
  const fill = (kind, key) => { const sel = host.querySelector(`[data-dev="${key}"]`); if (!sel) return;
    const items = list.filter(x => x.kind === kind);
    sel.innerHTML = `<option value="">System default</option>` + items.filter(x => x.deviceId && x.deviceId !== "default" && x.deviceId !== "communications").map((x, i) => `<option value="${esc(x.deviceId)}" ${d[key] === x.deviceId ? "selected" : ""}>${esc(x.label || `${kind === "audioinput" ? "Microphone" : kind === "videoinput" ? "Camera" : "Speakers"} ${i + 1}`)}</option>`).join("");
    if (!items.length) sel.innerHTML = `<option value="">None found</option>`; };
  fill("audioinput", "mic"); fill("audiooutput", "out"); fill("videoinput", "cam");
}
// the test uses the same microphone path as a real call, so what you see (and hear) is what friends get
async function testMic(listen) {
  stopTest();
  try {
    const d = S.settings.devices || {};
    testTrack = await openMic(d.mic, S.settings.voice || {}); testStream = new MediaStream([testTrack]);
    if (listen) { testEl = new Audio(); testEl.srcObject = testStream; if (d.out && testEl.setSinkId) testEl.setSinkId(d.out).catch(() => {}); testEl.play().catch(() => {}); }
    const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(testStream).connect(an);
    const buf = new Uint8Array(an.fftSize), bar = $("#sxMeter"), until = Date.now() + 15000;
    const step = () => { if (!testStream || Date.now() > until || !bar.isConnected) { ac.close(); return stopTest(); }
      an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); bar.style.transform = `scaleX(${Math.min(1, peak / 70)})`; meterRaf = requestAnimationFrame(step); };
    step(); devices();
  } catch (e) { toast(permissionWords(e, "microphone"), true); }
}
async function testCam() {
  stopTest();
  try {
    const d = S.settings.devices || {};
    testStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: d.cam ? { ideal: d.cam } : undefined, width: { ideal: 640 } } });
    const v = $("#sxCamPrev"); v.srcObject = testStream; v.classList.add("on"); devices();
    setTimeout(() => { if (v.srcObject === testStream) stopTest(); }, 20000);
  } catch (e) { toast(permissionWords(e, "camera"), true); }
}
function stopTest() {
  cancelAnimationFrame(meterRaf);
  if (testEl) { testEl.pause(); testEl.srcObject = null; testEl = null; }
  if (testTrack) { testTrack.stop(); testTrack = null; }
  if (testStream) { testStream.getTracks().forEach(t => t.stop()); testStream = null; }
  const v = $("#sxCamPrev"); if (v) { v.srcObject = null; v.classList.remove("on"); }
  const bar = $("#sxMeter"); if (bar) bar.style.transform = "scaleX(0)";
}

/* ---------- events ---------- */
async function click(a, x) {
  if (a === "set") { if (section === "profile" && x !== "profile" && !(await confirmLeave())) return; section = x; if (x === "blocked") S.blocked = await api.rpc("get_blocked").catch(() => []); return render(host, x); }
  if (a === "preset") { const p = PRESETS.find(q => q.name === x); if (!p) return; const { name, ...cols } = p; S.settings.appearance = cols; applyAppearance(cols); rerender(); return saveSoon(); }
  if (a === "resetcolors") { delete S.settings.appearance; applyAppearance(null); rerender(); return saveSoon(); }
  if (a === "testmic") return testMic(false);
  if (a === "hearmic") return testMic(true);
  if (a === "clearrecent") { S.settings.recentEmoji = []; S.settings.recentStickers = []; saveSoon(); return toast("Cleared"); }
  if (a === "testcam") return testCam();
  if (a === "unblockset") { try { await api.rpc("unblock_user", { p_user: x }); S.blocked = S.blocked.filter(b => b.id !== x); toast("Unblocked"); rerender(); } catch (e) { toast(e.message, true); } return; }
  if (a === "signoutset") { if (await dialog({ title: "Sign out of Social?", text: "Friends will see you as offline until you sign back in.", ok: "Sign out" })) { await api.rpc("heartbeat", { p_status: "offline" }).catch(() => {}); api.signOut().catch(e => toast(e.message, true)); } }
}
async function change(e) {
  const t = e.target;
  if (t.dataset.set) {
    const k = t.dataset.set, v = t.type === "checkbox" ? t.checked : t.value;
    if (k === "allow_calls") { try { await api.rpc("update_profile_details", { p_data: { allow_calls: v === "true" } }); S.me.details = { ...(S.me.details || {}), allow_calls: v === "true" }; toast("Saved"); } catch (er) { toast(er.message, true); } return; }
    if (k.startsWith("voice.") || k.startsWith("chat.")) {
      const [grp, key] = k.split("."), val = t.type === "range" ? +t.value : v;
      S.settings[grp] = { ...(S.settings[grp] || {}), [key]: val };
      if (k === "voice.volume") import("./callui.js").then(m => m.setVolume(val));
      if (k === "voice.quality") rerender();
      if (grp === "chat") document.dispatchEvent(new CustomEvent("sx:chatprefs"));
      return saveSoon();
    }
    if (k === "allow_requests") { try { await api.rpc("update_profile", { p_allow_requests: v }); S.me.allow_requests = v; toast("Saved"); } catch (er) { toast(er.message, true); } return; }
    if (k.startsWith("notify.")) { S.settings.notify = { ...(S.settings.notify || {}), [k.slice(7)]: v }; }
    else if (k.startsWith("motion.")) { S.settings.motion = { ...(S.settings.motion || {}), [k.slice(7)]: v }; document.querySelectorAll("img[data-frozen]").forEach(i => { if (i.dataset.live) i.src = i.dataset.live; delete i.dataset.frozen; delete i.dataset.live; }); import("./profile.js").then(m => m.applyMotion(document)); }
    else S.settings[k] = v;
    await save().catch(() => {});
    if (k === "status" || k === "shareGame") { document.dispatchEvent(new CustomEvent("sx:status")); }
    return;
  }
  if (t.dataset.dev) { S.settings.devices = { ...(S.settings.devices || {}), [t.dataset.dev]: t.value }; saveSoon(); return; }
}
function colorInput(e) {
  const t = e.target;
  if (t.dataset.set === "voice.volume") { const o = $("#sxVolVal"); if (o) o.textContent = t.value + "%"; return; }
  if (!t.dataset.color) return;
  const a = { ...(COLOR_FIELDS.every(([k]) => HEX.test((S.settings.appearance || {})[k] || "")) ? S.settings.appearance : (({ name, ...c }) => c)(PRESETS[0])) };
  a[t.dataset.color] = t.value; S.settings.appearance = a; applyAppearance(a);
  const lab = t.parentElement.querySelector("span"); if (lab) lab.textContent = t.value;
  saveSoon();
}
export const SocialSettings = {
  init(c) {
    ctx = c;
    const root = $("#sx");
    root.addEventListener("change", e => { if (e.target.closest(".sx-set")) change(e); });
    root.addEventListener("input", e => { if (e.target.closest(".sx-set")) { if (Admin.input(e)) return; colorInput(e); } });
    root.addEventListener("click", e => { if (e.target.closest("#sxAdmin")) Admin.click(e); });
  },
  render, click, setStatus, pickAvatar, stopTest,
};
