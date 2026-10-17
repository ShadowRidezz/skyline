// Skyline's interface: the title bar, pages, ambient mode, the welcome tour, keyboard shortcuts and
// the Settings sections. Themes, music and widgets live in their own modules.
import { $, $$, esc, sky, toast, dialog, setSeg, store, debounce } from "./util.js";
import { icon } from "./social/icons.js";
import { Scene } from "./scene/scene.js";
import { Themes, BUILTIN } from "./themes.js";
import { Studio } from "./studio.js";
import { Music } from "./music.js";
import { Widgets, Settings, WIDGETS, renderLinks, layoutWidgets, paintClock, weather } from "./widgets.js";
import { Games } from "./games.js";
import { FX } from "./fx.js";
import { Interface, P as uiPrefs } from "./interface.js";
import { Songs } from "./songs.js";
import { SpotifyUI, SpotifyLib } from "./spotify.js";
import { Assistant, ASST_DEFAULTS } from "./assistant.js";
import { photoReady } from "./scene/engine.js";
import { Pages } from "./pages.js";
import { Extras, CmdK } from "./extras.js";
import { Fun } from "./fun.js";
import { Social } from "./social/social.js";

const DEFAULTS = {
  name: "", clock24: false, seconds: false, clockStyle: "thin", city: null, units: "f", notes: "",
  links: [{ name: "YouTube", url: "https://www.youtube.com" }, { name: "Spotify", url: "https://open.spotify.com" },
          { name: "Twitch", url: "https://www.twitch.tv" }, { name: "Discord", url: "https://discord.com/app" },
          { name: "Gmail", url: "https://mail.google.com" }, { name: "Reddit", url: "https://www.reddit.com" }],
  widgets: null, widgetOrder: null, focusMin: 25, breakMin: 5,
  lyrics: true, visualizer: true, notifyTrack: false, ambientLyrics: true,
  closeToTray: true, startHidden: false, fastStart: true, hotkeyOn: true, hotkey: "Alt+Shift+S", asst: { ...ASST_DEFAULTS },
};
const S = () => Settings.data;
const save = () => Settings.save();
let view = "home";

/* ---------- pages ---------- */
const ORDER = ["home", "music", "social", "games", "school", "money", "youtube", "minecraft", "admin", "settings"];
function go(v, section) {
  const from = view, changed = from !== v;
  FX.transition(() => {
    view = v;
    $$("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === v));
    $$(".view").forEach(s => s.classList.toggle("hidden", s.id !== "view-" + v));
    $("#main").scrollTop = 0;
    Studio.show(v === "settings" && (!section || section === "appearance"));
    if (v === "settings") showSection(section || store.local("section") || "appearance");
    Widgets.onView(v);
    Music.loop();
    if (v === "games") Games.show();
    Pages.show(v);
    Extras.onView(v);
    Fun.onView(v);
    Social.show(v === "social");
    if (v === "admin") Social.showAdmin();
  }, changed ? Math.sign(ORDER.indexOf(v) - ORDER.indexOf(from)) : 0);
  FX.railIndicator();
  if (changed) setTimeout(() => FX.cascade($("#view-" + v)), 20);
}
function showSection(id) {
  store.local("section", id);
  $$("[data-sec]").forEach(b => b.classList.toggle("on", b.dataset.sec === id));
  $$(".sset").forEach(s => s.classList.toggle("hidden", s.id !== "set-" + id));
  Studio.show(id === "appearance");
  if (id === "ai") Pages.aiNote();
  if (id === "music") spotifyAccount();
  renderSettings();
  if (id === "ui") Interface.render();
  if (id === "assistant") Assistant.render();
  setTimeout(() => FX.cascade($("#set-" + id)), 10);
}

/* ---------- ambient mode: just the city, the time and the music ---------- */
let ambientHint = 0;
function ambient(on) {
  document.body.classList.toggle("ambient", on);
  if (on && view !== "home") go("home");
  if (on && Date.now() - ambientHint > 6e4) { ambientHint = Date.now(); toast("Ambient mode · Esc to come back · F11 for full screen"); }
  Widgets.pollSystem();
}
let idleT = 0;
document.addEventListener("pointermove", () => {   // in ambient mode the cursor and controls fade away when you're still
  if (!document.body.classList.contains("ambient")) return;
  document.body.classList.add("stir"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.remove("stir"), 2500);
});

/* ---------- title bar ---------- */
function titlebar() {
  $("#tbMin").onclick = () => sky?.win.cmd("min");
  $("#tbMax").onclick = () => sky?.win.cmd("max");
  $("#tbClose").onclick = () => sky?.win.cmd("close");
  $("#tbAmbient").onclick = () => ambient(!document.body.classList.contains("ambient"));
  $("#tbMini").onclick = () => sky?.mini.toggle();
  $(".titlebar .drag").addEventListener("dblclick", () => sky?.win.cmd("max"));
  if (sky) {
    sky.win.onState(s => { document.body.classList.toggle("maxed", !!s.max); document.body.classList.toggle("full", !!s.full); });
    sky.mini.onState(on => $("#tbMini").classList.toggle("on", on));
    sky.mini.state().then(on => $("#tbMini").classList.toggle("on", on));
  }
}

/* ---------- keyboard ---------- */
function keys() {
  document.addEventListener("keydown", e => {
    const typing = (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== "range" && e.target.type !== "checkbox") || e.target.isContentEditable;
    if (!$("#dlg").classList.contains("hidden")) return;
    if (document.body.classList.contains("staging") && e.key !== "F11") return;   // a game is open: keys belong to it
    if (e.key === "Escape") { if (document.body.classList.contains("ambient")) { ambient(false); e.preventDefault(); } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (document.body.classList.contains("full")) sky?.win.cmd("full"); return; }
    if (e.key === "F11") { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else sky?.win.cmd("full"); return; }
    if (e.ctrlKey && e.key === ",") { e.preventDefault(); go("settings"); return; }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); CmdK.open(); return; }   // the command bar, even while typing
    if (e.ctrlKey && e.key === " ") { e.preventDefault(); Assistant.listen(); return; }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[0-9]$/.test(e.key)) { e.preventDefault(); go(e.key === "0" ? "settings" : ORDER.filter(x => x !== "social")[+e.key - 1]); return; }
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === "a") { if (!e.repeat) Assistant.listen(); return; }   // A (with or without Shift): talk to Sky, never while you're typing in a box
    if (e.key === " ") { e.preventDefault(); Music.cmd("toggle"); }
    else if (k === "n" || e.key === "MediaTrackNext") Music.cmd("next");
    else if (k === "p" || e.key === "MediaTrackPrevious") Music.cmd("prev");
    else if (k === "m") sky?.mini.toggle();
    else if (k === "l") go("music");
    else if (e.key === "[") Music.nudgeLyrics(-0.1);   // lyrics later, for this song
    else if (e.key === "]") Music.nudgeLyrics(0.1);    // lyrics earlier, for this song
    else if (k === "g" || e.key === "/") { e.preventDefault(); Games.search(); }
    else if (e.key === "?") shortcuts();
  });
}
function shortcuts() {
  const rows = [["Ctrl + K", "Command bar: go anywhere, play, open, do maths"], ["Space", "Play / pause"], ["N / P", "Next / previous song"], ["A", "Talk to the assistant"], ["F11", "Full screen"], ["M", "Mini player"],
    ["L", "Music & lyrics"], ["[ / ]", "Lyrics later / earlier (saved per song)"], ["Ctrl + 1 … 9", "Home, Music, Games, School, Money, YouTube, Minecraft, Notes"], ["Ctrl + 0", "Settings"], ["G or /", "Search games"], ["Ctrl + ,", "Settings"], ["Ctrl + Z / Y", "Undo / redo in Theme Studio"],
    [S().hotkey || "Alt+Shift+S", "Show or hide Skyline from anywhere"], ["Ctrl + Space", "Talk to the assistant"], [(S().asst || {}).hotkey || "Alt+Shift+A", "Talk to the assistant from anywhere"],
    ["Esc", "Leave ambient mode or full screen"]];
  dialog({ title: "Keyboard shortcuts", cancel: "", ok: "Got it", html: `<div class="keys">${rows.map(([k, d]) => `<div><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join("")}</div>` });
}

/* ---------- settings sections (Appearance is Theme Studio) ---------- */
// Settings > Music: which Spotify account is linked, with Unlink
async function spotifyAccount() {
  const box = $("#spAcct"); if (!box || !sky) return;
  const st = await SpotifyUI.status(true), on = SpotifyUI.connected(), u = (st && st.user) || {};
  box.textContent = on ? `Linked to ${u.name || "your Spotify account"}${u.name ? (u.premium ? " (Premium)" : " (Free)") : ""}. Your playlists, library and queue show on the Music page.` : "Not linked. Link it to see your playlists and library on the Music page.";
  $("#spAcctUnlink").hidden = !on; $("#spAcctLink").hidden = on;
  $("#spAcctUnlink").onclick = async () => { if (await SpotifyUI.unlink()) { SpotifyLib.reset(); spotifyAccount(); Songs.show(); } };
  $("#spAcctLink").onclick = () => { go("music"); Songs.show("lib"); };
  spiceBox(st);
}
// No Premium? With Spicetify, Skyline searches and plays through the Spotify app itself
async function spiceBox(st) {
  const box = $("#spSpice"); if (!box || !sky.spotify.spice) return;
  if (st && st.connected && !st.spicetify && st.user && st.user.premium) { box.hidden = true; return; }   // (Premium linked: the normal connection, nothing to add)
  const s = await sky.spotify.spice().catch(() => null); if (!s) return;
  box.hidden = false;
  box.innerHTML = `<b>No Spotify Premium?</b> ${s.live ? `<span class="ok">Working through Spicetify${s.user ? ` (${esc(s.user.name)})` : ""}: search, play and your library work on the Music page.</span>`
    : s.installed ? `The Skyline helper is in Spicetify. Open Spotify and it connects by itself.`
    : s.spicetify ? `Spicetify is installed. Add Skyline's helper to it and Skyline can search, play and show your library without Premium. <button class="btn sm primary" id="spSpiceAdd">Add Skyline to Spicetify</button><small>Spotify restarts once.</small>`
    : `Skyline can work without Premium through <a href="#" data-link="https://spicetify.app">Spicetify</a> (a free add-on for the Spotify desktop app; using mods is against Spotify's terms, so it's your call). Install it, then come back here.`}`;
  box.onclick = e => { const l = e.target.closest("[data-link]"); if (l) { e.preventDefault(); sky.openUrl(l.dataset.link); } };
  const add = $("#spSpiceAdd"); if (add) add.onclick = async () => { add.disabled = true; add.textContent = "Adding… (Spotify restarts)"; try { await sky.spotify.spiceInstall(); toast("Skyline helper added to Spicetify"); } catch (e) { toast(e.message, true); } setTimeout(() => spiceBox(st), 6000); };
}
document.addEventListener("sky:spotify", () => { SpotifyLib.reset(); spotifyAccount(); Songs.show(); });

function renderSettings() {
  const s = S(), d = Themes.doc;
  $("#setName").value = s.name || "";
  setSeg($("#setClock"), s.clock24 ? "24" : "12"); setSeg($("#setClockStyle"), s.clockStyle || "thin"); $("#setSeconds").checked = !!s.seconds;
  setSeg($("#setUnits"), s.units); $("#cityNow").textContent = s.city ? `${s.city.name}${s.city.region ? ", " + s.city.region : ""}` : "No city yet";
  $("#setLiveWx").checked = d.liveWeather; $("#setRainy").checked = !!d.rainy; $("#setCityTour").checked = !!d.cityTour; $("#setHolidays").checked = d.holidays !== false;
  $("#widgetToggles").innerHTML = WIDGETS.map(([id, name]) => `<label class="toggle"><input type="checkbox" data-wid="${id}" ${(!s.widgets || s.widgets[id] !== false) ? "checked" : ""}><span class="sw"></span><span class="t"><b>${name}</b></span></label>`).join("");
  $("#setFocus").value = s.focusMin || 25; $("#setBreak").value = s.breakMin || 5;
  if (sky && sky.links && $("#linkBrowser")) sky.links.browsers().then(b => {
    const sel = $("#linkBrowser"), cur = s.linksBrowser || "chrome-last";
    sel.innerHTML = (b.chrome ? `<option value="chrome-last">Chrome, on the Google account you used last</option>` + b.profiles.map(p => `<option value="chrome:${esc(p.dir)}">Chrome · ${esc(p.name)}${p.account && p.account !== p.name ? " (" + esc(p.account) + ")" : ""}</option>`).join("") : "")
      + `<option value="default">My default browser</option>`;
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : sel.options[0].value;
  }).catch(() => {});
  if ($("#linkApps")) $("#linkApps").checked = s.linksApps !== false;
  $("#linkRows").innerHTML = (s.links || []).map((l, i) => `<div class="lrow">
      <input data-li="${i}" data-f="name" value="${esc(l.name)}" placeholder="Name" maxlength="24"><input data-li="${i}" data-f="url" value="${esc(l.url)}" placeholder="https://…" spellcheck="false">
      <button class="btn sm ghost danger" data-ldel="${i}" title="Remove">${icon("x")}</button></div>`).join("");
  $("#setLyrics").checked = s.lyrics !== false; $("#setViz").checked = s.visualizer !== false; $("#setNotify").checked = !!s.notifyTrack;
  $("#setAmbLyrics").checked = s.ambientLyrics !== false; $("#setTint").checked = d.albumTint;
  $("#setReduce").checked = Themes.reduceOn(); setSeg($("#setFps"), String(d.fps));
  $("#setSched").checked = !!d.schedule.on;
  $$("[data-sched]").forEach(sel => { sel.innerHTML = Themes.all().map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join(""); sel.value = d.schedule[sel.dataset.sched]; sel.disabled = !d.schedule.on; });
  $("#setTray").checked = s.closeToTray !== false; $("#setHidden").checked = !!s.startHidden; $("#setFast").checked = s.fastStart !== false; $("#setHotkeyOn").checked = s.hotkeyOn !== false;
  $("#setHotkey").value = s.hotkey || "Alt+Shift+S"; $("#setHotkey").disabled = s.hotkeyOn === false;
  if (sky) sky.ai.status().then(a => {
    $("#aiBadge").textContent = a.configured ? (a.source === "env" ? "Connected (environment key)" : "Connected · " + a.hint) : "Not connected";
    $("#aiBadge").className = "badge" + (a.configured ? " ok" : "");
    $("#aiModel").innerHTML = Object.entries(a.models).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(""); $("#aiModel").value = a.model;
    $("#aiClear").disabled = a.source !== "saved";
  });
  if (sky) sky.app.info().then(i => {
    $("#setLogin").checked = i.login; $("#setLogin").disabled = !i.packaged; $("#loginNote").classList.toggle("hidden", i.packaged);
    $("#aboutVer").textContent = "Version " + i.version; $("#dataPath").textContent = i.data;
  });
}

function settingsEvents() {
  $$("[data-sec]").forEach(b => b.onclick = () => showSection(b.dataset.sec));
  const bind = (sel, ev, fn) => $(sel).addEventListener(ev, fn);
  bind("#setName", "input", e => { S().name = e.target.value.slice(0, 30); save(); paintClock(); });
  bind("#setClock", "click", e => { const b = e.target.closest("button"); if (!b) return; S().clock24 = b.dataset.v === "24"; save(); renderSettings(); paintClock(); });
  bind("#setClockStyle", "click", e => { const b = e.target.closest("button"); if (!b) return; S().clockStyle = b.dataset.v; save(); renderSettings(); paintClock(); });
  bind("#setSeconds", "change", e => { S().seconds = e.target.checked; save(); paintClock(); });
  bind("#setUnits", "click", e => { const b = e.target.closest("button"); if (!b) return; S().units = b.dataset.v; save(); renderSettings(); weather(true); });
  bind("#setRainy", "change", e => { Themes.doc.rainy = e.target.checked; Themes.persist(); Themes.apply(Themes.draft); });
  bind("#setHolidays", "change", e => { Themes.doc.holidays = e.target.checked; Themes.persist(); Themes.apply(Themes.draft); });
  bind("#setCityTour", "change", e => { Themes.doc.cityTour = e.target.checked; Themes.persist(); Themes.scheduleTick(); if (e.target.checked) toast("City tour on: a new city every hour"); });
  bind("#setLiveWx", "change", e => { Themes.doc.liveWeather = e.target.checked; Themes.persist(); Themes.apply(Themes.draft); });
  bind("#widgetToggles", "change", e => { const id = e.target.dataset.wid; if (!id) return; S().widgets = { ...(S().widgets || {}), [id]: e.target.checked }; save(); layoutWidgets(); });
  bind("#setFocus", "change", e => { S().focusMin = Math.max(1, Math.min(180, +e.target.value || 25)); save(); Widgets.refresh(); });
  bind("#setBreak", "change", e => { S().breakMin = Math.max(1, Math.min(60, +e.target.value || 5)); save(); Widgets.refresh(); });
  bind("#linkRows", "input", e => { const i = e.target.dataset.li; if (i == null) return; S().links[+i][e.target.dataset.f] = e.target.value; save(); renderLinks(); });
  bind("#linkRows", "change", e => { const i = e.target.dataset.li; if (i == null || e.target.dataset.f !== "url") return;
    let u = e.target.value.trim(); if (u && !/^https?:\/\//i.test(u)) u = "https://" + u; S().links[+i].url = u; e.target.value = u; save(); renderLinks(); });
  bind("#linkRows", "click", e => { const b = e.target.closest("[data-ldel]"); if (!b) return; S().links.splice(+b.dataset.ldel, 1); save(); renderSettings(); renderLinks(); });
  bind("#linkBrowser", "change", e => { S().linksBrowser = e.target.value; save(); });
  bind("#linkApps", "change", e => { S().linksApps = e.target.checked; save(); renderLinks(); });
  bind("#linkAdd", "click", () => { S().links = S().links || []; if (S().links.length >= 12) return toast("12 links at most", true);
    S().links.push({ name: "", url: "" }); renderSettings(); $$("#linkRows input[data-f=name]").pop().focus(); });
  bind("#setLyrics", "change", e => { S().lyrics = e.target.checked; save(); Music.setOption("lyrics", e.target.checked); });
  bind("#setViz", "change", e => { S().visualizer = e.target.checked; save(); Music.setOption("visualizer", e.target.checked); });
  bind("#setNotify", "change", e => { S().notifyTrack = e.target.checked; save(); });
  bind("#setAmbLyrics", "change", e => { S().ambientLyrics = e.target.checked; save(); document.body.classList.toggle("no-amb-lyrics", !e.target.checked); });
  bind("#setTint", "change", e => { Themes.doc.albumTint = e.target.checked; Themes.persist(); Scene.setTint(e.target.checked ? Music.color : null); });
  bind("#setReduce", "change", e => { Themes.doc.reduce = e.target.checked; Themes.persist(); Themes.apply(Themes.draft); Music.loop(); });
  bind("#setFps", "click", e => { const b = e.target.closest("button"); if (!b) return; Themes.doc.fps = +b.dataset.v; Themes.persist(); Themes.apply(Themes.draft); renderSettings(); });
  bind("#setSched", "change", e => { Themes.doc.schedule.on = e.target.checked; Themes.persist(); renderSettings(); Themes.scheduleTick(); });
  $$("[data-sched]").forEach(sel => sel.addEventListener("change", () => { Themes.doc.schedule[sel.dataset.sched] = sel.value; Themes.persist(); Themes.scheduleTick(); }));
  bind("#setTray", "change", e => { S().closeToTray = e.target.checked; save(); });
  bind("#setFast", "change", e => { S().fastStart = e.target.checked; save(); });
  bind("#setHidden", "change", e => { S().startHidden = e.target.checked; save(); if (sky && $("#setLogin").checked) sky.app.setLogin(true, e.target.checked); });
  bind("#setLogin", "change", async e => { if (!sky) return; const on = await sky.app.setLogin(e.target.checked, !!S().startHidden); e.target.checked = on;
    toast(on ? "Skyline will open when Windows starts" : "Skyline won't open with Windows"); });
  bind("#setHotkeyOn", "change", e => { S().hotkeyOn = e.target.checked; save(); renderSettings(); });
  bind("#setHotkey", "keydown", e => {   // press the keys you want
    e.preventDefault(); if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
    if (!mods.length) return toast("Use at least one of Ctrl, Alt or Shift", true);
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    S().hotkey = [...mods, key].join("+"); e.target.value = S().hotkey; save(); toast("Shortcut set to " + S().hotkey);
  });
  const aiErr = e => toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
  bind("#aiSave", "click", async () => {
    try { await sky.ai.setKey($("#aiKey").value); } catch (e) { return aiErr(e); }   // saved (encrypted) right away, and kept through updates
    $("#aiKey").value = ""; Games.aiChanged(await sky.ai.status()); renderSettings();
    try { await sky.ai.test(); toast("Claude is connected and saved"); } catch (e) { aiErr({ message: "Key saved, but Claude didn't answer the test: " + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") }); }
  });
  bind("#aiTest", "click", async () => { try { toast("Testing…"); await sky.ai.test(); toast("Claude is connected and ready"); } catch (e) { aiErr(e); } });
  bind("#aiClear", "click", async () => { if (!(await dialog({ title: "Remove the API key?", text: "The AI Game Builder stops working until you add a key again. Your games stay.", ok: "Remove", danger: true }))) return;
    Games.aiChanged(await sky.ai.clearKey()); renderSettings(); });
  bind("#aiModel", "change", async e => { try { Games.aiChanged(await sky.ai.setModel(e.target.value)); toast("Model changed"); } catch (er) { aiErr(er); } });
  bind("#aiConsole", "click", () => sky?.openUrl("https://console.anthropic.com/settings/keys"));
  bind("#openData", "click", () => sky?.openData());
  bind("#showKeys", "click", shortcuts);
  bind("#replayTour", "click", () => tour(true));
  bind("#quitApp", "click", () => sky?.app.quit());
  let cityT = 0;
  bind("#cityQ", "input", e => {
    clearTimeout(cityT); const q = e.target.value.trim(), out = $("#cityRes");
    if (q.length < 2) { out.innerHTML = ""; return; }
    cityT = setTimeout(() => citySearch(q, out, () => { $("#cityQ").value = ""; renderSettings(); }), 300);
  });
}
async function citySearch(q, out, done) {
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`), j = await r.json();
    out.innerHTML = (j.results || []).map((c, i) => `<button class="cres" data-ci="${i}">${esc(c.name)}<small>${esc([c.admin1, c.country].filter(Boolean).join(", "))}</small></button>`).join("")
      || `<div class="muted">No place called that. Try the nearest city.</div>`;
    out.onclick = ev => { const b = ev.target.closest("[data-ci]"); if (!b) return; const c = j.results[+b.dataset.ci];
      S().city = { name: c.name, region: [c.admin1, c.country].filter(Boolean).join(", "), lat: c.latitude, lon: c.longitude };
      save(); out.innerHTML = ""; weather(true); toast(`Weather set to ${c.name}`); done && done(); };
  } catch (er) { out.innerHTML = `<div class="muted">Couldn't search right now. Check your internet connection.</div>`; }
}

/* ---------- the welcome tour (first start) ---------- */
const TOUR_THEMES = () => [...BUILTIN.filter(t => t.scene === "photo").slice(0, 8), ...BUILTIN.filter(t => t.scene !== "photo")];
async function tour(force) {
  if (!force && S().toured) return;
  const box = $("#tour"); box.classList.remove("hidden");
  let step = 0, picked = Themes.doc.active;
  const steps = [
    () => `<h2>Welcome to <span class="grad">Skyline</span></h2><p>Your desktop, as a city at night. Music, weather and the things you need, floating above the skyline.</p>
      <label class="field">What should Skyline call you?<input id="tName" placeholder="Your name (optional)" maxlength="30" value="${esc(S().name || "")}"></label>`,
    () => `<h2>Where are you?</h2><p>For the weather. If it rains outside, it can rain in your skyline too.</p>
      <label class="field">City<input id="tCity" placeholder="Type a city name…" autocomplete="off"></label><div class="cityres" id="tCityRes"></div>
      <p class="muted" id="tCityNow">${S().city ? "" + esc(S().city.name) : "You can skip this and add it later."}</p>`,
    () => `<h2>Pick your world</h2><p>Real photos of cities at night that come alive with your music. You can change everything later in Theme Studio.</p><div class="tour-themes">${TOUR_THEMES().map(t =>
      `<button class="tt ${t.id === picked ? "on" : ""}" data-tt="${t.id}"><canvas width="240" height="135"></canvas><span>${esc(t.name)}</span></button>`).join("")}</div>`,
    () => `<h2>You're all set</h2><p>A few things worth knowing:</p><ul class="tips">
      <li><b>Play music</b> in Spotify, YouTube or any app, or <b>drop your own songs</b> on the window: the city moves with it.</li>
      <li><b>The glowing mic</b> in the side bar is your assistant. Click it and say “open Minecraft” or “play Blinding Lights”. Teach it things: “remember that I use Modrinth App for Minecraft”.</li>
      <li><b>Ambient mode</b> (the moon button, or A) hides everything but the city, the time and your music.</li>
      <li><b>${esc(S().hotkey || "Alt+Shift+S")}</b> shows or hides Skyline from anywhere. Closing the window keeps it in the tray.</li>
      <li>Press <b>?</b> any time for all the keyboard shortcuts.</li></ul>`,
  ];
  const render = () => {
    box.innerHTML = `<div class="tour-card">${steps[step]()}<div class="tour-foot"><div class="dots">${steps.map((_, i) => `<i class="${i === step ? "on" : ""}"></i>`).join("")}</div>
      <span class="sp"></span>${step ? `<button class="btn ghost" data-t="back">Back</button>` : `<button class="btn ghost" data-t="skip">Skip</button>`}
      <button class="btn primary" data-t="next">${step === steps.length - 1 ? "Start" : "Next"}</button></div></div>`;
    if (step === 1) { let t = 0; $("#tCity").addEventListener("input", e => { clearTimeout(t); const q = e.target.value.trim(); if (q.length < 2) return;
      t = setTimeout(() => citySearch(q, $("#tCityRes"), () => { $("#tCityNow").textContent = "" + S().city.name; $("#tCity").value = ""; }), 300); }); $("#tCity").focus(); }
    if (step === 0) $("#tName").focus();
    if (step === 2) $$(".tt").forEach(async b => { const cv = b.querySelector("canvas"), th = BUILTIN.find(x => x.id === b.dataset.tt);
      if (th.scene === "photo") await photoReady(th.photo.src);
      requestAnimationFrame(() => cv.getContext("2d").drawImage(Scene.thumb(th, 240, 135), 0, 0)); });
  };
  const finish = () => { S().toured = true; save(); box.classList.add("hidden"); box.innerHTML = ""; };
  box.onclick = async e => {
    const tt = e.target.closest("[data-tt]");
    if (tt) { picked = tt.dataset.tt; $$(".tt").forEach(b => b.classList.toggle("on", b === tt)); await Themes.select(picked, { quiet: true }); Themes.persist(); return; }
    const b = e.target.closest("[data-t]"); if (!b) return;
    if (step === 0 && $("#tName")) { S().name = $("#tName").value.trim().slice(0, 30); save(); paintClock(); }
    if (b.dataset.t === "skip") return finish();
    if (b.dataset.t === "back") { step--; return render(); }
    if (step === steps.length - 1) return finish();
    step++; render();
  };
  box.onkeydown = e => { if (e.key === "Enter" && e.target.tagName === "INPUT" && step === 0) box.querySelector('[data-t="next"]').click(); };
  render();
}

/* ---------- start ---------- */
/* ---------- the sky answers clicks: a shooting star, or fireworks on a double-click ---------- */
function skyClicks() {
  const open = e => uiPrefs().skyClicks !== false && e.button === 0 && !document.body.classList.contains("staging") &&
    !e.target.closest(".glass, .gcard, button, input, textarea, select, a, label, .hero, .seg, .g-stage, .tour, .dlg, .toast, .widgets, .player, .lyrics, .head, .g-head, .subnav, .titlebar, .rail, .g-sec-h, .mu-left, .intro");
  let t = 0;
  document.addEventListener("click", e => { if (!open(e)) return; clearTimeout(t); t = setTimeout(() => { Scene.comet(e.clientX, e.clientY); FX.sound("toggle"); }, 240); });
  document.addEventListener("dblclick", e => { if (!open(e)) return; clearTimeout(t); Scene.firework(e.clientX, e.clientY); FX.sound("success"); });
}

/* ---------- every slider's coloured part follows its knob, wherever the slider was drawn ---------- */
function sliderFill() {
  const fill = i => { const lo = +i.min || 0, hi = i.max === "" ? 100 : +i.max; i.style.setProperty("--v", ((i.value - lo) / ((hi - lo) || 1) * 100) + "%"); };
  document.addEventListener("input", e => { if (e.target.matches?.("input.rg")) fill(e.target); }, true);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) (n.matches("input.rg") ? [n] : n.querySelectorAll("input.rg")).forEach(fill); })
    .observe(document.body, { childList: true, subtree: true });
  $$("input.rg").forEach(fill);
}

async function start() {
  sliderFill();
  Settings.data = { ...DEFAULTS, ...(store.cached("settings") || {}) };
  FX.init(() => uiPrefs(), () => Themes.reduceOn());
  Interface.init();
  const fast = (store.cached("settings") || {}).fastStart !== false;   // fast start: the clock first, everything else right after
  const playIntro = !fast && FX.level() !== "off" && uiPrefs().intro !== false;
  if (playIntro) document.body.classList.add("booting");
  Scene.init($("#sceneCanvas"));
  Themes.start();
  const fresh = await store.read("settings");
  if (fresh) { Settings.data = { ...DEFAULTS, ...fresh }; Interface.init(); }
  document.body.classList.toggle("no-amb-lyrics", S().ambientLyrics === false);
  titlebar(); keys(); settingsEvents();
  let picked = false;   // a page clicked while Skyline is still starting stays open
  $$("[data-view]").forEach(b => b.onclick = () => { picked = true; go(b.dataset.view); });
  document.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (!g) return; const [v, sec] = g.dataset.goto.split(":"); go(v, sec); });
  document.addEventListener("sky:goto", e => { const [v, sec] = String(e.detail || "").split(":"); if (ORDER.includes(v)) go(v, sec); });
  $("#ambientExit").onclick = () => ambient(false);
  await Widgets.init();
  await Music.init(S());
  Social.init();   // friends, messages and calls: live from the start, so calls and messages reach you on any page
  // the heavier parts (your songs, games, school, money, YouTube, Minecraft, the assistant). With fast start they load
  // just after the clock is on screen; then whatever page is open is drawn again with everything in it.
  const rest = async () => {
    await Songs.init(Music);
    await Games.init(go);
    await Pages.init();
    Assistant.init({ go, ambient, studioRefresh: () => Studio.refresh() });
    Extras.init({ go, ambient, shortcuts });
    Fun.init({ go });
    if (sky) sky.tray.onAction(a => {
      if (a.type === "theme") Themes.select(a.id, { quiet: true }).then(() => { Themes.persist(); Studio.refresh(); });
      if (a.type === "ambient") ambient(true);
    });
    Themes.on(w => { if (w === "select") { Themes.trayList(); if (view === "settings") renderSettings(); } });
    skyClicks();
  };
  if (!fast) await rest();
  if (!picked) go("home");
  document.body.classList.add("ready");
  if (fast) {
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // (after the first paint)
    await rest();
    if (view === "games") Games.show();
    Pages.show(view); Extras.onView(view); Fun.onView(view);
  }
  if (playIntro) {
    Scene.intro();
    await FX.intro();
    document.body.classList.remove("booting"); document.body.classList.add("booted");
    FX.railIndicator(); FX.cascade($("#view-home"));
    setTimeout(() => document.body.classList.remove("booted"), 1500);
  }
  tour(false);
}
start();
