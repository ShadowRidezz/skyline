// Skyline: the app shell. The main window (plus an optional mini player), the tray icon, start with
// Windows, a global shortcut, and the sky:// protocol that serves the interface, album covers,
// background pictures and site icons.
const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, protocol, net, shell, dialog, globalShortcut,
  Notification, session, desktopCapturer, screen,
} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { Media } = require("./media");
const { Games } = require("./games");
const { Songs } = require("./songs");
const { Art } = require("./art");
const { Assistant } = require("./assistant");
const { Spotify } = require("./spotify");
const { Voice } = require("./tts");
const Pages = require("./pages");
const { Classroom } = require("./classroom");
const { Links } = require("./links");
const { Plays } = require("./plays");
const { Playtime } = require("./playtime");
const { Clips } = require("./clips");
const { DbUpdate } = require("./dbupdate");
const { Backup } = require("./backup");
const { Study } = require("./study");
const { StudyHelper } = require("./studyhelper");
const { Updater } = require("./updater");
const { Social } = require("./social");

const arg = name => { const a = process.argv.find(x => x.startsWith(`--${name}`)); return a ? (a.includes("=") ? a.slice(a.indexOf("=") + 1) : true) : null; };
const SHOT = arg("shot");           // testing: render without showing a window, save screenshots, quit
const REALWIN = SHOT && arg("realwin");   // testing performance: a real GPU window, parked off-screen
if (REALWIN) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
if (SHOT && arg("fakemedia")) { app.commandLine.appendSwitch("use-fake-device-for-media-stream"); app.commandLine.appendSwitch("use-fake-ui-for-media-stream"); }   // tests: a pretend camera and microphone
const RENDERER = path.join(__dirname, "..", "renderer");
const ASSETS = path.join(__dirname, "assets");

if (SHOT) app.setPath("userData", path.join(app.getPath("temp"), "skyline-shot-" + (arg("profile") || "a")));
app.setAppUserModelId(app.isPackaged ? "app.skyline.dashboard" : "app.skyline.dashboard.dev");   // (test copies run as Electron: they must never borrow the real Skyline's name and icon in Windows)
protocol.registerSchemesAsPrivileged([{ scheme: "sky", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

if (!SHOT && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const DATA = app.getPath("userData");
const BG_DIR = path.join(DATA, "backgrounds");
const ICON_DIR = path.join(DATA, "favicons");
let clips = null;
let win = null, mini = null, tray = null, quitting = false, media = null, games = null, songs = null, art = null, assistant = null, voice = null, trayThemes = [];
let settings = {};

/* ---------- stored data ---------- */
const STORES = new Set(["settings", "themes", "history", "tasks", "notes", "school", "money", "minecraft", "youtube", "aichat"]);
function readStore(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name + ".json"), "utf8")); } catch (e) { return null; }
}
function writeStore(name, obj) {
  if (!STORES.has(name)) throw new Error("Unknown store");
  const text = JSON.stringify(obj, null, 1);
  if (text.length > 6e6) throw new Error("That's too much to save");
  fs.mkdirSync(DATA, { recursive: true });
  const file = path.join(DATA, name + ".json"), tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
  if (name === "themes") cleanBackgrounds(text);
  if (name === "settings") { const old = settings; settings = obj || {}; applySettings(old); }
}
function cleanBackgrounds(text) {  // pictures no theme uses any more (kept an hour: an unsaved edit may show one)
  try {
    for (const f of fs.readdirSync(BG_DIR)) {
      const p = path.join(BG_DIR, f);
      if (!text.includes(f) && Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.unlinkSync(p);
    }
  } catch (e) {}
}

/* ---------- settings that the shell itself uses ---------- */
function applySettings(old = {}) {
  if (old.hotkey !== settings.hotkey || old.hotkeyOn !== settings.hotkeyOn || JSON.stringify(old.asst) !== JSON.stringify(settings.asst)) registerHotkey();
  if (assistant) assistant.setWake(!!(settings.asst && settings.asst.wake));
  if (tray) buildTray();
}
function registerHotkey() {
  globalShortcut.unregisterAll();
  if (SHOT || settings.hotkeyOn === false) return;
  const key = settings.hotkey || "Alt+Shift+S";
  try { globalShortcut.register(key, toggleWindow); } catch (e) {}
  const a = settings.asst || {};
  if (a.on !== false && a.hotkeyOn !== false) {   // talk to the assistant from anywhere
    try { globalShortcut.register(a.hotkey || "Alt+Shift+A", () => { showWindow(); send(win, "asst:hotkey"); }); } catch (e) {}
  }
  if (clips) clips.registerKey();   // (unregisterAll above took the clip key too)
}

/* ---------- windows ---------- */
const preload = path.join(__dirname, "preload.js");
function webPrefs(extra = {}) {
  return { preload, contextIsolation: true, sandbox: true, spellcheck: false, ...extra };
}
function onScreen(b) {
  return b && Number.isFinite(b.x) && screen.getAllDisplays().some(d => {
    const a = d.workArea; return b.x + 80 > a.x && b.y + 40 > a.y && b.x < a.x + a.width - 80 && b.y < a.y + a.height - 40;
  });
}

function createWindow(hidden) {
  const st = settings.window || {};
  const size = SHOT && typeof arg("size") === "string" ? arg("size").split("x").map(Number) : null;
  win = new BrowserWindow({
    width: size ? size[0] : st.w || 1440, height: size ? size[1] : st.h || 900,
    ...(onScreen(st) && !size ? { x: st.x, y: st.y } : {}),
    minWidth: 960, minHeight: 620, frame: false, show: false, title: "Skyline", backgroundColor: "#07060f",
    icon: path.join(ASSETS, "icon.png"),
    webPreferences: webPrefs(SHOT && !REALWIN ? { offscreen: true, backgroundThrottling: false } : SHOT ? { backgroundThrottling: false } : {}),
    ...(REALWIN ? { x: -4200, y: 0, skipTaskbar: true, focusable: false } : {}),
  });
  if (st.max && !SHOT) win.maximize();
  win.loadURL("sky://app/index.html");
  win.once("ready-to-show", () => { if ((!hidden && !SHOT) || REALWIN) { win.showInactive(); if (REALWIN) win.setPosition(-4200, 0); } });
  win.on("close", e => {
    if (quitting || SHOT || settings.closeToTray === false) return;
    e.preventDefault(); win.hide();
    if (!settings.trayHinted) {
      settings.trayHinted = true;
      try { writeStore("settings", { ...(readStore("settings") || {}), trayHinted: true }); } catch (er) {}
      notify("Skyline is still here", "It keeps running in the tray, next to the clock. Right-click the icon to quit.");
    }
  });
  const sendState = () => send(win, "win:state", { max: win.isMaximized(), full: win.isFullScreen(), visible: win.isVisible() });
  for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "show", "hide"]) win.on(ev, sendState);
  let saveT = 0;
  const saveBounds = () => { clearTimeout(saveT); saveT = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isFullScreen() || SHOT) return;
    const b = win.getNormalBounds(), cur = readStore("settings") || {};
    cur.window = { x: b.x, y: b.y, w: b.width, h: b.height, max: win.isMaximized() };
    try { writeStore("settings", cur); } catch (e) {}
  }, 600); };
  for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, saveBounds);
  guard(win);
  win.on("closed", () => { win = null; });
}

function guard(w) {  // the interface never navigates away or opens browser windows; links go to your browser
  w.webContents.setWindowOpenHandler(({ url }) => { openUrl(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("sky://")) { e.preventDefault(); openUrl(url); } });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow(false);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide(); else showWindow();
}

function toggleMini(force) {
  if (mini && !mini.isDestroyed()) { if (force === true) { mini.show(); return; } mini.close(); return; }
  if (force === false) return;
  const b = settings.mini || {};
  const d = screen.getPrimaryDisplay().workArea;
  mini = new BrowserWindow({
    width: 420, height: 132, ...(onScreen(b) ? { x: b.x, y: b.y } : { x: d.x + d.width - 440, y: d.y + d.height - 152 }),
    frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, alwaysOnTop: true,
    skipTaskbar: true, transparent: true, backgroundColor: "#00000000", hasShadow: false, show: false, title: "Skyline mini player",
    icon: path.join(ASSETS, "icon.png"), webPreferences: webPrefs(SHOT ? { offscreen: true, backgroundThrottling: false } : {}),
  });
  mini.setAlwaysOnTop(true, "floating");
  mini.loadURL("sky://app/mini.html");
  mini.once("ready-to-show", () => { if (!SHOT) mini.showInactive(); });
  mini.on("moved", () => {
    const [x, y] = mini.getPosition(), cur = readStore("settings") || {};
    cur.mini = { x, y }; try { writeStore("settings", cur); } catch (e) {}
  });
  mini.on("closed", () => { mini = null; broadcast("mini:state", false); if (tray) buildTray(); });
  guard(mini);
  broadcast("mini:state", true);
  if (tray) buildTray();
}

function send(w, ch, data) { if (w && !w.isDestroyed()) w.webContents.send(ch, data); }
function broadcast(ch, data) { send(win, ch, data); send(mini, ch, data); }

/* ---------- tray ---------- */
function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, "tray.png")));
    tray.on("click", toggleWindow);
  }
  const m = media ? media.meta : { on: false };
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setToolTip(m.on ? `Skyline · ${m.title}${m.artist ? " – " + m.artist : ""}`.slice(0, 120) : "Skyline");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Skyline", click: showWindow },
    { label: "Mini player", type: "checkbox", checked: !!(mini && !mini.isDestroyed()), click: () => toggleMini() },
    { label: "Ambient mode", click: () => { showWindow(); send(win, "tray:action", { type: "ambient" }); } },
    { type: "separator" },
    { label: m.on ? (m.playing ? "Pause" : "Play") + (m.title ? `  ·  ${m.title}`.slice(0, 44) : "") : "Nothing playing", enabled: !!m.on, click: () => media.send("toggle") },
    { label: "Next track", enabled: !!m.on, click: () => media.send("next") },
    { label: "Previous track", enabled: !!m.on, click: () => media.send("prev") },
    { type: "separator" },
    { label: "Theme", enabled: trayThemes.length > 0, submenu: trayThemes.length ? trayThemes.map(t => ({
      label: t.name, type: "radio", checked: !!t.active, click: () => send(win, "tray:action", { type: "theme", id: t.id }) })) : undefined },
    { label: "Start with Windows", type: "checkbox", checked: login, click: i => setLogin(i.checked, settings.startHidden) },
    { type: "separator" },
    { label: "Quit Skyline", click: () => { quitting = true; app.quit(); } },
  ]));
}

function setLogin(open, hidden) {
  if (!app.isPackaged) return false;  // only the installed app can register itself
  app.setLoginItemSettings({ openAtLogin: !!open, args: hidden ? ["--hidden"] : [] });
  if (tray) buildTray();
  return app.getLoginItemSettings().openAtLogin;
}

function notify(title, body, icon) {
  if (SHOT) { console.log("[notify]", JSON.stringify({ title, body })); return; }   // tests: written down, never shown
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true, icon: icon || path.join(ASSETS, "icon.png") }).show();
}

/* ---------- helpers for the interface ---------- */
function openUrl(url) {
  if (/^https?:\/\/[^\s]+$/i.test(String(url || ""))) shell.openExternal(url);
}

// the graphics card (NVIDIA): name, temperature, load and memory, at most every 2.5 s
let gpuLast = null, gpuAt = 0, gpuNone = false;
let social = null;
// GPU numbers: one nvidia-smi keeps reporting every 2 s while the stats are on screen (starting it each time cost more),
// and it's stopped when nobody has asked for a while.
let gpuProc = null, gpuStop = 0;
function gpuStats() {
  if (gpuNone) return null;
  gpuAt = Date.now();
  clearTimeout(gpuStop); gpuStop = setTimeout(() => { if (gpuProc) { try { gpuProc.kill(); } catch (e) {} gpuProc = null; } }, 15e3);
  if (gpuProc) return gpuLast;
  const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe");
  if (!fs.existsSync(exe)) { gpuNone = true; return null; }
  const p = gpuProc = require("child_process").spawn(exe, ["--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits", "-lms", "2000"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  let first = null; const ready = new Promise(r => { first = r; setTimeout(r, 4000); });
  p.on("error", () => { gpuNone = true; gpuProc = null; first(); });
  p.on("exit", () => { if (gpuProc === p) gpuProc = null; first(); });
  require("readline").createInterface({ input: p.stdout }).on("line", line => {
    const q = line.split(",").map(x => x.trim());
    if (q.length >= 5 && !isNaN(+q[2])) gpuLast = { name: q[0].replace(/^NVIDIA (GeForce )?/, ""), temp: +q[1], load: +q[2], memUsed: +q[3], memTotal: +q[4] };
    first();
  });
  return ready.then(() => gpuLast);
}
app.on("will-quit", () => { if (gpuProc) try { gpuProc.kill(); } catch (e) {} });
let cpuPrev = null;
function cpuUsage() {
  const t = os.cpus().reduce((a, c) => { for (const k in c.times) a[k === "idle" ? "idle" : "busy"] += c.times[k]; return a; }, { idle: 0, busy: 0 });
  let pct = null;
  if (cpuPrev) { const di = t.idle - cpuPrev.idle, db = t.busy - cpuPrev.busy; if (di + db > 0) pct = Math.round(db / (di + db) * 1000) / 10; }
  cpuPrev = t;
  return pct;
}

const lyricCache = new Map();
async function lyrics({ title, artist, album, dur }) {
  const key = [title, artist, album, Math.round(dur || 0)].join("|");
  if (lyricCache.has(key)) return lyricCache.get(key);
  const headers = { "User-Agent": `Skyline/${app.getVersion()} (desktop dashboard)` };
  const get = async u => { try { const r = await net.fetch(u, { headers }); return r.ok ? r.json() : null; } catch (e) { return null; } };
  // "Lights - Single Version", "Song (feat. X)", "Track - Remastered 2011" -> "Lights", "Song", "Track"
  const clean = s => String(s || "").replace(/\s*[([](feat|ft|with|prod)\.?[^)\]]*[)\]]/gi, "").replace(/\s+-\s+(single|radio|album|remaster|remastered|edit|version|mono|stereo|live|explicit|clean|bonus|deluxe|from|\d{4}).*$/i, "")
    .replace(/\s*[([](single|radio|album|remaster|remastered|edit|version|mono|stereo|explicit|clean|bonus|deluxe|\d{4})[^)\]]*[)\]]/gi, "").trim();
  const mainArtist = String(artist || "").split(/\s*(?:,|&| x | feat\.?| ft\.?| and )\s*/i)[0].trim();
  const wordsP = wordLyrics(clean(title), mainArtist, dur).catch(() => null);   // asked at the same time as LRCLIB
  const good = x => x && (x.syncedLyrics || x.plainLyrics || x.instrumental);
  const near = x => !(dur > 0) || !x.duration || Math.abs(x.duration - dur) <= 6;
  let best = null;
  for (const [t, a] of [[title, artist], [clean(title), mainArtist]]) {
    if (best || !t) continue;
    const q = new URLSearchParams({ track_name: t, artist_name: a || "" });
    if (album && t === title) q.set("album_name", album);
    if (dur > 0) q.set("duration", String(Math.round(dur)));
    const x = await get(`https://lrclib.net/api/get?${q}`); if (good(x)) best = x;
  }
  if (!best) {   // search, and take the closest match that has synced lyrics and the right length
    const pools = [await get(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: clean(title), artist_name: mainArtist })}`)];
    if (!(pools[0] || []).length) pools.push(await get(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${clean(title)} ${mainArtist}` })}`));
    const found = pools.flat().filter(Boolean).filter(good);
    found.sort((x, y) => (near(y) - near(x)) || (!!y.syncedLyrics - !!x.syncedLyrics) || Math.abs((x.duration || 0) - dur) - Math.abs((y.duration || 0) - dur));
    if (found[0] && near(found[0])) best = found[0];
  }
  let out = best ? { synced: best.syncedLyrics || "", plain: best.plainLyrics || "", instrumental: !!best.instrumental, source: "LRCLIB" } : null;
  // word-by-word timing (each word's own start and length), so the karaoke follows the singing exactly
  const words = await wordsP;
  if (words && words.length) out = { ...(out || { synced: "", plain: words.map(l => l.words.map(w => w.w).join("")).join("\n"), instrumental: false }), words, source: "NetEase" };
  lyricCache.set(key, out);
  if (lyricCache.size > 200) lyricCache.delete(lyricCache.keys().next().value);
  return out;
}

// NetEase Cloud Music keeps word-timed lyrics ("yrc") for a huge catalogue, Western music included: every word's
// start and length in milliseconds. Find the same recording (title, artist and length must match), then read them.
async function wordLyrics(title, artist, dur) {
  const getJ = async u => { const c = new AbortController(), t = setTimeout(() => c.abort(), 7000);
    // Node's own fetch, not Chromium's: NetEase answers Chromium's browser-style requests with its chart instead of the search
    try { const r = await globalThis.fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", Referer: "https://music.163.com/" }, signal: c.signal });
      return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); } };
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const T = norm(title), A = norm(artist); if (!T) return null;
  // (spaces as %20: NetEase reads "+" literally and returns unrelated songs)
  const res = await getJ(`https://music.163.com/api/search/get?type=1&limit=12&s=${encodeURIComponent(`${title} ${artist}`)}`);
  const songs = ((res && res.result && res.result.songs) || []).map(x => ({ id: x.id, name: norm(x.name), artists: (x.artists || []).map(a => norm(a.name)), dur: (x.duration || 0) / 1000 }))
    .filter(x => (x.name === T || x.name.startsWith(T + " ") || T.startsWith(x.name + " ")) && (!A || x.artists.some(a => a === A || a.includes(A) || A.includes(a))))
    .filter(x => !(dur > 0) || Math.abs(x.dur - dur) <= 3)   // the same recording, not a live or radio version
    .sort((a, b) => Math.abs(a.dur - dur) - Math.abs(b.dur - dur) || (a.name === T ? -1 : 1));
  for (const song of songs.slice(0, 4)) {
    const j = await getJ(`https://music.163.com/api/song/lyric/v1?${new URLSearchParams({ id: String(song.id), lv: "1", yv: "1", tv: "-1", rv: "-1", kv: "-1" })}`);
    const yrc = j && j.yrc && j.yrc.lyric; if (!yrc) continue;
    const lines = [];
    for (const raw of yrc.split(/\r?\n/)) {
      const h = raw.match(/^\[(\d+),(\d+)\]/); if (!h) continue;   // credit lines are JSON; lyric lines start with [start,length]
      const words = [...raw.matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)].map(m => ({ t: +m[1] / 1000, d: +m[2] / 1000, w: m[3] })).filter(w => w.w !== "");
      const text = words.map(w => w.w).join("").trim();
      if (!text || /作词|作曲|编曲|制作|混音|母带|监制|lyrics by|composed by|producer/i.test(text)) continue;
      lines.push({ t: +h[1] / 1000, d: +h[2] / 1000, words });
    }
    if (lines.length >= 3) return lines;
  }
  return null;
}

async function favicon(host) {
  host = String(host || "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
  if (!host) return null;
  const file = path.join(ICON_DIR, host + ".img");
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 30 * 864e5) return `sky://favicon/${host}`;
  for (const u of [`https://${host}/favicon.ico`, `https://${host}/apple-touch-icon.png`]) {
    try {
      const r = await net.fetch(u, { headers: { "User-Agent": "Mozilla/5.0 Skyline" } });
      const type = r.headers.get("content-type") || "";
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && buf.length > 60 && buf.length < 500e3 && !/html|text/.test(type)) {
        fs.mkdirSync(ICON_DIR, { recursive: true }); fs.writeFileSync(file, buf);
        return `sky://favicon/${host}`;
      }
    } catch (e) {}
  }
  return null;
}

function imageType(buf) {
  if (buf[0] === 0x89) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 4).toString() === "RIFF") return "image/webp";
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1) return "image/x-icon";
  return "application/octet-stream";
}

async function pickBackground() {
  const r = await dialog.showOpenDialog(win, { title: "Choose a background picture", properties: ["openFile"],
    filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return saveBackground(nativeImage.createFromPath(r.filePaths[0]));
}
function saveBackground(img) {
  if (!img || img.isEmpty()) throw new Error("That file isn't a picture Skyline can read");
  const { width, height } = img.getSize(), k = Math.min(1, 2560 / Math.max(width, height));
  if (k < 1) img = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: "best" });
  fs.mkdirSync(BG_DIR, { recursive: true });
  const name = `bg-${Date.now()}.jpg`;
  fs.writeFileSync(path.join(BG_DIR, name), img.toJPEG(88));
  return { url: `sky://bg/${name}` };
}

async function exportTheme(theme) {
  const safe = String(theme.name || "theme").replace(/[^\w -]/g, "").trim() || "theme";
  const r = await dialog.showSaveDialog(win, { title: "Export theme", defaultPath: path.join(app.getPath("documents"), `${safe}.skytheme`),
    filters: [{ name: "Skyline theme", extensions: ["skytheme"] }] });
  if (r.canceled || !r.filePath) return false;
  const out = { skyline: 1, theme: { ...theme } };
  const m = theme.image && /^sky:\/\/bg\/(bg-\d+\.jpg)$/.exec(theme.image.url || "");
  if (m) { try { out.image = fs.readFileSync(path.join(BG_DIR, m[1])).toString("base64"); } catch (e) {} }
  fs.writeFileSync(r.filePath, JSON.stringify(out, null, 1), "utf8");
  return true;
}
async function importThemes() {
  const r = await dialog.showOpenDialog(win, { title: "Import themes", properties: ["openFile", "multiSelections"],
    filters: [{ name: "Skyline theme", extensions: ["skytheme", "json"] }] });
  if (r.canceled) return null;
  const out = [];
  for (const f of r.filePaths) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8")), t = j.theme || j;
      if (!t || !t.colors) continue;
      if (j.image && t.image) t.image.url = saveBackground(nativeImage.createFromBuffer(Buffer.from(j.image, "base64"))).url;
      out.push(t);
    } catch (e) {}
  }
  return out;
}

/* ---------- IPC ---------- */
function ipc() {
  ipcMain.handle("store:read", (e, name) => STORES.has(name) ? readStore(name) : null);
  ipcMain.handle("store:write", (e, name, obj) => {
    if (name === "settings" && obj && typeof obj === "object") {   // the window position etc. belong to the shell, not the page
      const cur = readStore("settings") || {};
      obj = { ...obj, window: cur.window, mini: cur.mini, miniOpen: cur.miniOpen, trayHinted: cur.trayHinted || obj.trayHinted };
    }
    writeStore(name, obj); return true;
  });
  ipcMain.handle("win:cmd", (e, cmd) => {
    const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
    if (cmd === "min") w.minimize();
    else if (cmd === "max") w.isMaximized() ? w.unmaximize() : w.maximize();
    else if (cmd === "full") w.setFullScreen(!w.isFullScreen());
    else if (cmd === "close") w.close();
    else if (cmd === "hide") w.hide();
    return { max: w.isMaximized(), full: w.isFullScreen() };
  });
  ipcMain.handle("win:zoom", (e, f) => { const z = Math.min(1.4, Math.max(.7, Number(f) || 1)); if (Math.abs(e.sender.getZoomFactor() - z) > .001) e.sender.setZoomFactor(z); return z; });
  ipcMain.handle("media:cmd", (e, cmd, value) => {
    const ok = { toggle: 0, play: 0, pause: 0, next: 0, prev: 0, seek: 1, shuffle: 1, repeat: 1, vol: 1, mute: 1, pin: 1, refresh: 0 };   // (tuck is main-only)
    if (!(cmd in ok)) return false;
    const v = ok[cmd] ? (cmd === "pin" ? String(value || "").replace(/[\r\n]/g, "") : String(Number(value) || 0)) : "";
    media.send(v !== "" || ok[cmd] ? `${cmd} ${v}`.trim() : cmd);
    return true;
  });
  const wants = { meter: new Set(), sys: new Set() };   // each window says what it needs; the helper runs it while anyone does
  ipcMain.handle("media:want", (e, kind, on) => {
    const set = wants[kind]; if (!set) return false;
    const id = e.sender.id;
    if (on) { if (!set.has(id)) { set.add(id); e.sender.once("destroyed", () => { set.delete(id); media.want(kind, set.size > 0); }); } }
    else set.delete(id);
    media.want(kind, set.size > 0);
    return true;
  });
  ipcMain.handle("media:state", () => ({ meta: media.meta, vol: media.vol, apps: media.apps, game: media.game }));
  ipcMain.handle("sys:stats", async () => ({ cpu: cpuUsage(), mem: { total: os.totalmem(), free: os.freemem() }, uptime: os.uptime(), cores: os.cpus().length, gpu: await gpuStats() }));
  ipcMain.handle("open:url", (e, url) => openUrl(url));
  ipcMain.handle("open:data", () => shell.openPath(DATA));
  ipcMain.handle("favicon", (e, host) => favicon(host));
  ipcMain.handle("lyrics", (e, q) => lyrics(q || {}));
  ipcMain.handle("bg:pick", () => pickBackground());
  ipcMain.handle("theme:export", (e, t) => exportTheme(t));
  ipcMain.handle("theme:import", () => importThemes());
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), packaged: app.isPackaged, login: app.getLoginItemSettings().openAtLogin, data: DATA, shot: !!SHOT }));
  ipcMain.handle("app:login", (e, open, hidden) => setLogin(open, hidden));
  ipcMain.handle("tray:themes", (e, list) => { trayThemes = Array.isArray(list) ? list.slice(0, 40) : []; if (tray) buildTray(); });
  ipcMain.handle("mini:toggle", (e, force) => { toggleMini(force); return !!(mini && !mini.isDestroyed()); });
  ipcMain.handle("mini:state", () => !!(mini && !mini.isDestroyed()));
  ipcMain.handle("main:show", () => showWindow());
  ipcMain.handle("notify", (e, n) => notify(String(n.title || "Skyline"), String(n.body || "")));
  ipcMain.handle("app:copy", (e, text) => { require("electron").clipboard.writeText(String(text || "").slice(0, 20000)); return true; });
  ipcMain.handle("app:quit", () => { quitting = true; app.quit(); });
}

/* ---------- start ---------- */
app.whenReady().then(async () => {
  settings = readStore("settings") || {};
  protocol.handle("sky", async req => {
    const u = new URL(req.url), host = u.host, rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    const file = (base, name) => { const p = path.normalize(path.join(base, name)); return p.startsWith(base) ? p : null; };
    try {
      if (host === "app") {
        const p = file(RENDERER, rel || "index.html");
        if (p) return net.fetch(pathToFileURL(p).toString());
      } else if (host === "play" && games) {
        const r = games.serve(rel); if (r) return r;
      } else if (host === "song" && songs) {
        const r = songs.serve(rel, req); if (r) return r;
      } else if (host === "gameart" && art) {
        const r = art.serveArt(rel); if (r) return r;
      } else if (host === "art") {
        const a = media && media.art.get(rel);
        if (a) return new Response(a.data, { headers: { "content-type": a.type, "cache-control": "max-age=86400", "access-control-allow-origin": "*" } });
      } else if (host === "bg" && /^bg-\d+\.jpg$/.test(rel)) {
        return new Response(fs.readFileSync(path.join(BG_DIR, rel)), { headers: { "content-type": "image/jpeg" } });
      } else if (host === "favicon" && /^[a-z0-9.-]+$/.test(rel)) {
        const buf = fs.readFileSync(path.join(ICON_DIR, rel + ".img"));
        return new Response(buf, { headers: { "content-type": imageType(buf) } });
      }
    } catch (e) {}
    return new Response("not found", { status: 404 });
  });

  // The music visualiser listens to what your speakers play (system audio, nothing is recorded).
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    const pick = social && social.takeShare();   // screen sharing in a call: the screen or window you picked
    if (pick && SHOT && arg("fakemedia")) return cb({ video: req.frame });   // tests share Skyline's own page, never your real screen
    if (pick) return desktopCapturer.getSources({ types: ["screen", "window"] }).then(s => { const src = s.find(x => x.id === pick); cb(src ? { video: src } : {}); }).catch(() => cb({}));
    desktopCapturer.getSources({ types: ["screen"] }).then(s => cb(s[0] ? { video: s[0], audio: "loopback" } : {})).catch(() => cb({}));   // the music visualiser's speaker sound
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "notifications" || perm === "media" || perm === "display-capture" || perm === "fullscreen"));   // fullscreen: YouTube's own full-screen button

  media = new Media(DATA);
  media.on("meta", (m, changed) => {
    broadcast("media:meta", m);
    if (tray) buildTray();
    if (changed && settings.notifyTrack && m.on && !(win && win.isFocused())) {
      const a = m.art && media.art.get(m.art.split("/").pop());
      notify(m.title, [m.artist, m.album].filter(Boolean).join(" · "), a ? nativeImage.createFromBuffer(a.data) : undefined);
    }
  });
  media.on("level", d => { if (win && win.isVisible()) send(win, "media:level", d); if (mini && !mini.isDestroyed()) send(mini, "media:level", d); });
  media.on("vol", v => broadcast("media:vol", v));
  media.on("apps", a => broadcast("media:apps", a));
  media.on("game", g => broadcast("media:game", g));
  media.on("sys", s => send(win, "sys:net", s));
  media.start();

  ipc();
  art = new Art(DATA);
  games = new Games(DATA, art); games.install(() => win);
  games.notify = it => send(win, "lib:changed", it);
  songs = new Songs(DATA); songs.install(); songs.media = media;
  // after a song link opens Spotify, its window is sent back to the taskbar and Skyline stays in front
  // ms: how long to keep it down. A Spotify that's just starting can take 5-10 s to show its window, so that gets longer.
  const tuckSpotify = (ms = 3500) => { if (SHOT) return; media.send("tuck Spotify " + Math.round(ms));
    for (const ms of [120, 400, 900, 1600]) setTimeout(() => { if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) win.moveTop(); }, ms); };
  const spotify = new Spotify(DATA, { media, tuck: tuckSpotify }); spotify.install(); songs.spotifyApi = spotify; songs.tuck = tuckSpotify;
  assistant = new Assistant(DATA, { games, songs, spotify, ai: games.ai, media, getWin: () => win, shot: !!SHOT }); assistant.install(!!SHOT);
  new Links({ getSettings: () => settings, assistant }).install();
  const plays = new Plays(DATA, media); plays.install(); app.on("before-quit", () => plays.stop());
  const playtime = new Playtime(DATA, games, media); playtime.install(!!SHOT);
  clips = new Clips(DATA, () => win, playtime, { shot: !!SHOT }); clips.install();   // the clip saver (off until you turn it on)
  new Backup(DATA, () => win).install(!!SHOT);
  const study = new Study({ ai: games.ai, brain: assistant.brain }); study.install();
  new StudyHelper(DATA, study).install();
  new Updater(() => win).install(!!SHOT);
  social = new Social(DATA, () => win, { shot: !!SHOT }); social.install();
  new DbUpdate(DATA, social).install(!!SHOT);   // the admin's Skyline brings the database up to date by itself   // friends, messages and calls   // new versions arrive by themselves, on every PC   // the Chrome extension for IXL / Sadlier talks to this
  if (settings.asst && settings.asst.wake && !SHOT) assistant.setWake(true);
  voice = new Voice(DATA, () => win); voice.install();
  Pages.install();
  const classroom = new Classroom(DATA, () => win); classroom.install(!!SHOT);
  if (!SHOT) setTimeout(() => { if (classroom.read().connected) classroom.sync().catch(() => {}); }, 45000);   // fresh assignments shortly after startup
  // Spotify plays instantly only if it's already running: start it hidden in the background when Skyline starts
  if (!SHOT && settings.spotifyReady !== false) setTimeout(() => {
    const exe = path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe");
    if (!fs.existsSync(exe)) return;
    require("child_process").execFile("tasklist", ["/FI", "IMAGENAME eq Spotify.exe", "/NH"], { windowsHide: true }, (err, out) => {
      if (err || /Spotify\.exe/i.test(out || "")) return;
      const p = require("child_process").spawn(exe, ["--minimized"], { detached: true, stdio: "ignore", windowsHide: true }); p.on("error", () => {}); p.unref();
      media.send("tuck Spotify 20000");
    });
  }, 4000);
  const hidden = process.argv.includes("--hidden") && settings.startHidden !== false;
  createWindow(hidden);
  if (!SHOT) { buildTray(); registerHotkey(); if (settings.miniOpen) toggleMini(true); }
  if (SHOT) runShots();
});

app.on("second-instance", () => showWindow());
app.on("before-quit", () => {
  quitting = true;
  try { const cur = readStore("settings") || {}; cur.miniOpen = !!(mini && !mini.isDestroyed()); writeStore("settings", cur); } catch (e) {}
});
app.on("will-quit", () => { globalShortcut.unregisterAll(); if (media) media.stop(); if (assistant) assistant.stop(); if (voice) voice.stop(); });
app.on("window-all-closed", () => { if (SHOT || quitting) app.quit(); });

/* ---------- testing: `electron . --shot=steps.json` renders offscreen and saves screenshots ---------- */
async function runShots() {
  const wc = win.webContents;
  wc.setFrameRate(30);
  wc.setAudioMuted(true);   // tests never make sound on the speakers
  wc.on("console-message", (...a) => {
    const e = a[0], msg = e && e.message !== undefined ? e.message : a[2], level = e && e.level !== undefined ? e.level : a[1];
    console.log(`[page:${level}] ${msg}${level === "error" && e && e.sourceId ? " @ " + String(e.sourceId).split("/").pop() + ":" + e.lineNumber : ""}`);
  });
  await new Promise(r => wc.once("did-finish-load", r));
  let steps = [{ wait: 3000, shot: "shot.png" }];
  if (typeof SHOT === "string" && SHOT.endsWith(".json")) steps = JSON.parse(fs.readFileSync(SHOT, "utf8"));
  else if (typeof SHOT === "string") steps = [{ wait: 3000, shot: SHOT }];
  const outDir = arg("out") || process.cwd();
  for (const s of steps) {
    if (s.miniJs && mini && !mini.isDestroyed()) { try { const v = await mini.webContents.executeJavaScript(`(async () => { ${s.miniJs} })()`, true); console.log("[mini js]", JSON.stringify(v)); } catch (e) { console.log("[mini js error]", e.message); } }
    if (s.js) { try { const v = await wc.executeJavaScript(`(async () => { ${s.js} })()`, true); if (v !== undefined) console.log("[js]", JSON.stringify(v)); } catch (e) { console.log("[js error]", e.message); } }
    await new Promise(r => setTimeout(r, s.wait || 800));
    if (s.trace) {   // testing: record a performance trace for s.trace ms
      const { contentTracing } = require("electron");
      await contentTracing.startRecording({ included_categories: ["toplevel", "viz", "cc", "gpu", "blink", "v8.execute", "disabled-by-default-devtools.timeline"], excluded_categories: ["*"] });
      await new Promise(r => setTimeout(r, s.trace));
      const file = await contentTracing.stopRecording(path.join(outDir, s.traceFile || "trace.json")); console.log("[trace]", file);
    }
    if (s.shot) { const img = await wc.capturePage(); fs.writeFileSync(path.join(outDir, s.shot), img.toPNG()); console.log("[shot]", s.shot); }
    if (s.shotMini && mini) { const img = await mini.webContents.capturePage(); fs.writeFileSync(path.join(outDir, s.shotMini), img.toPNG()); console.log("[shot]", s.shotMini); }
  }
  quitting = true;
  app.quit(); setTimeout(() => app.exit(0), 4000);   // a normal quit, so goodbyes (like going offline) happen
}
