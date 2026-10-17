// Extras, round 2: lyric cards, Weekly Wrapped, homework focus mode, a neon sign in the city, bedtime on school
// nights, and money goals on the Games page.
import { $, $$, esc, sky, toast, store } from "./util.js";
import { icon } from "./social/icons.js";
import { Settings } from "./widgets.js";
import { Music } from "./music.js";
import { School } from "./school.js";
import { Assistant } from "./assistant.js";

const F = () => (Settings.data.fun = { sign: "", signOn: true, bedtime: true, bedAt: "23:00", ...(Settings.data.fun || {}) });
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mins = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`;
let nav = { go: () => {} };

/* ---------- a picture to share (lyric card, Wrapped) ---------- */
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function wrap(g, text, max) { const words = String(text).split(/\s+/), lines = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; }
function city(g, W, H, base, color, maxH = 260) {   // a little skyline along the bottom, with lit windows
  let x = 0, seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  while (x < W) { const w = 50 + rnd() * 90, h = maxH * .35 + rnd() * maxH; g.fillStyle = "rgba(8,6,20,.92)"; g.fillRect(x, base - h, w - 6, h);
    for (let wy = base - h + 14; wy < base - 14; wy += 22) for (let wx = x + 8; wx < x + w - 18; wx += 16) if (rnd() > .62) { g.fillStyle = rnd() > .5 ? color : "rgba(255,214,140,.85)"; g.fillRect(wx, wy, 7, 10); }
    x += w; }
  g.fillStyle = "rgba(8,6,20,1)"; g.fillRect(0, base, W, H - base);
}
async function card(draw, W = 1080, H = 1350) {
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  await draw(g, W, H);
  return c;
}
function preview(canvas, name) {
  $("#funCard")?.remove();
  const box = document.createElement("div"); box.id = "funCard"; box.className = "fun-ov";
  box.innerHTML = `<div class="fun-card glass"><img alt=""><div class="row"><button class="btn primary" data-fc="copy">Copy picture</button><button class="btn" data-fc="save">Save</button><span class="sp"></span><button class="btn ghost" data-fc="close">Close</button></div></div>`;
  box.querySelector("img").src = canvas.toDataURL("image/png");
  document.body.appendChild(box);
  box.addEventListener("click", async e => {
    const b = e.target.closest("[data-fc]"); if (!b && e.target !== box) return;
    const a = b ? b.dataset.fc : "close";
    if (a === "close") return box.remove();
    if (a === "copy") canvas.toBlob(async blob => { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Copied: paste it anywhere (Discord, Snapchat, Instagram…)"); } catch (er) { toast("Couldn't copy the picture", true); } });
    if (a === "save") { const l = document.createElement("a"); l.download = name + ".png"; l.href = canvas.toDataURL("image/png"); l.click(); }
  });
}
function background(g, W, H, art, a, b) {
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, a); grd.addColorStop(1, b); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (art) { g.save(); g.filter = "blur(60px) saturate(1.4)"; g.globalAlpha = .55; g.drawImage(art, -200, -200, W + 400, W + 400); g.restore(); }
  g.fillStyle = "rgba(6,4,16,.35)"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${.2 + Math.random() * .6})`; g.fillRect(Math.random() * W, Math.random() * H * .55, 2, 2); }
}

// the lyric that's on now (and the next one), as a picture
export async function lyricCard(i) {
  const m = Music.meta, L = Music.lyrics;
  if (!m.on) return toast("Play a song first");
  const lines = L && L.lines ? L.lines.filter(l => l.text) : [];
  const at = i != null ? L.lines[i] : L && L.lines[Math.max(0, Music.lineIdx)];
  if (!at || !at.text) return toast(lines.length ? "Wait for a line to show, or click ⤴ on a line" : "This song has no synced lyrics", true);
  const k = L.lines.indexOf(at), next = L.lines.slice(k + 1).find(l => l.text);
  const art = await loadImg($("img[data-np-art]")?.src), color = Music.color || "#5b9cff";
  const c = await card((g, W, H) => {
    background(g, W, H, art, "#1a1035", "#05040c"); city(g, W, H, H - 60, color, 200);
    if (art) { g.save(); g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 40; g.drawImage(art, 90, 110, 170, 170); g.restore(); }
    g.fillStyle = "#fff"; g.font = "700 44px 'Segoe UI'"; g.fillText(m.title.slice(0, 32), 290, 180); g.fillStyle = "rgba(255,255,255,.7)"; g.font = "400 34px 'Segoe UI'"; g.fillText((m.artist || "").slice(0, 40), 290, 232);
    g.font = "700 76px 'Segoe UI'"; g.fillStyle = "#fff"; g.shadowColor = color; g.shadowBlur = 30;
    let y = 470; for (const l of wrap(g, "“" + at.text + "”", W - 180).slice(0, 5)) { g.fillText(l, 90, y); y += 96; }
    g.shadowBlur = 0;
    if (next) { g.font = "400 46px 'Segoe UI'"; g.fillStyle = "rgba(255,255,255,.55)"; for (const l of wrap(g, next.text, W - 180).slice(0, 2)) { y += 10; g.fillText(l, 90, y); y += 60; } }
    g.font = "600 28px 'Segoe UI'"; g.fillStyle = "rgba(255,255,255,.75)"; g.fillText("Skyline", W - 230, H - 50);
  });
  preview(c, "lyric - " + m.title.replace(/[\\/:*?"<>|]/g, ""));
}

/* ---------- Weekly Wrapped ---------- */
export async function wrapped() {
  const [st, pt] = await Promise.all([sky.plays.stats("week").catch(() => null), sky.playtime ? sky.playtime.stats().catch(() => null) : null]);
  if (!st || !st.plays) return toast("No music counted this week yet. Listen to some songs first!");
  const songs = st.songs.slice(0, 5), artist = st.artists[0], game = pt && pt.week[0], gameMins = pt ? pt.week.reduce((a, g) => a + g.mins, 0) : 0;
  const c = await card((g, W, H) => {
    background(g, W, H, null, "#2a0f4a", "#06040f"); city(g, W, H, H - 40, "#f472b6", 120);
    const grd = g.createLinearGradient(0, 0, W, 0); grd.addColorStop(0, "#5b9cff"); grd.addColorStop(1, "#7cc4ff");
    g.fillStyle = grd; g.font = "800 92px 'Segoe UI'"; g.fillText("Your week", 80, 170);
    g.fillStyle = "rgba(255,255,255,.7)"; g.font = "400 34px 'Segoe UI'"; const d0 = new Date(Date.now() - 6 * 864e5); g.fillText(`${d0.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}${Settings.data.name ? " · " + Settings.data.name : ""}`, 84, 225);
    g.fillStyle = "#fff"; g.font = "800 120px 'Segoe UI'"; g.fillText(mins(st.mins).replace(" min", "m").replace(" h", "h"), 80, 390); g.font = "400 34px 'Segoe UI'"; g.fillStyle = "rgba(255,255,255,.7)"; g.fillText("of music", 84, 440);
    if (artist) { g.fillStyle = "#fff"; g.font = "700 50px 'Segoe UI'"; g.fillText(artist.name.slice(0, 26), 580, 365); g.font = "400 30px 'Segoe UI'"; g.fillStyle = "rgba(255,255,255,.7)"; g.fillText("top artist", 582, 410); }
    g.font = "700 40px 'Segoe UI'"; g.fillStyle = "#f9a8d4"; g.fillText("Top songs", 80, 560);
    songs.forEach((s, i) => { const y = 630 + i * 82; g.fillStyle = "rgba(255,255,255,.45)"; g.font = "800 46px 'Segoe UI'"; g.fillText(String(i + 1), 80, y);
      g.fillStyle = "#fff"; g.font = "700 40px 'Segoe UI'"; g.fillText(s.title.slice(0, 34), 140, y - 6); g.fillStyle = "rgba(255,255,255,.6)"; g.font = "400 28px 'Segoe UI'"; g.fillText(`${(s.artist || "").slice(0, 38)} · ${Math.max(1, Math.round(s.secs / 60))} min`, 140, y + 28); });
    if (game) { g.fillStyle = "#67e8f9"; g.font = "700 40px 'Segoe UI'"; g.fillText("" + game.name.replace(/^Minecraft · /, "Minecraft: ").slice(0, 30), 80, 1080); g.fillStyle = "rgba(255,255,255,.7)"; g.font = "400 30px 'Segoe UI'"; g.fillText(`most played · ${mins(gameMins)} of games this week`, 84, 1124); }
    g.font = "600 28px 'Segoe UI'"; g.fillStyle = "rgba(255,255,255,.75)"; g.fillText("Skyline Wrapped", W - 330, H - 40);
  });
  preview(c, "Skyline Wrapped " + ymd(Date.now()));
}

/* ---------- homework focus mode: games and YouTube wait until homework is done ---------- */
function focusGate(v) {
  for (const id of ["games", "youtube"]) {
    const view = $("#view-" + id); if (!view) continue;
    let ov = view.querySelector(".focus-gate");
    const left = School.focusLeft();
    if (!left || v !== id) { if (ov) ov.remove(); continue; }
    if (!ov) { ov = document.createElement("div"); ov.className = "focus-gate"; view.appendChild(ov); }
    ov.innerHTML = `<div class="fg-box glass"><span class="fg-i">${icon("lock")}</span><h2>Homework first</h2><p>Focus mode is on. ${left.length} thing${left.length > 1 ? "s" : ""} to finish before ${id === "games" ? "games" : "YouTube"}:</p>
      <ul>${left.slice(0, 5).map(t => `<li>${esc(t)}</li>`).join("")}</ul><div class="row"><button class="btn primary" data-goto="school">Go to School</button><button class="btn ghost" data-fg="off">Turn focus mode off</button></div></div>`;
    ov.querySelector("[data-fg=off]").onclick = () => { School.setFocus(false); focusGate(v); toast("Focus mode off"); };
  }
}

/* ---------- the neon sign in the city ---------- */
export function paintSign() {   // the neon name sign was removed (1.15.1)
  $("#citySign")?.remove(); return;
  const f = F(), text = (f.sign || Settings.data.name || "").trim().slice(0, 16);
  let s = $("#citySign");
  if (!f.signOn || !text) { if (s) s.remove(); return; }
  if (!s) { s = document.createElement("div"); s.id = "citySign"; $("#scene").appendChild(s); }
  s.textContent = text; s.style.setProperty("--sc", Music.color || "#f472b6");
}

/* ---------- bedtime on school nights ---------- */
function bedtime() {
  const f = F(), now = new Date(), [h, m] = String(f.bedAt || "23:00").split(":").map(Number);
  const school = now.getDay() >= 0 && now.getDay() <= 4, late = (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) || now.getHours() < 4;
  const on = f.bedtime && late && (now.getHours() < 4 ? now.getDay() >= 1 && now.getDay() <= 5 : school);
  document.body.classList.toggle("bedtime", !!on);
  const k = ymd(now.getHours() < 4 ? now - 864e5 : now);
  if (on && store.local("bed-said") !== k) {
    store.local("bed-said", k);
    const name = Settings.data.name ? ", " + Settings.data.name : "";
    const msg = `It's ${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${name}. School tomorrow, so it's time to wind down. Good night.`;
    if (Music.game) sky.app.notify({ title: "Bedtime", body: msg }); else { Assistant.speak(msg); toast("" + msg); }
  }
}

/* ---------- money goals on the Games page ---------- */
async function goals() {
  const box = $("#gGoals"); if (!box) return;
  const d = (await store.read("money")) || {}, list = (d.goals || []).filter(g => g.saved < g.target);
  if (!list.length) { box.innerHTML = `<div class="g-sec-h"><h2>Saving for</h2><span class="ct-note">Saving up for a game, a skin or a Battle Pass? Add a goal on the Money page and it shows up here.</span><span class="sp"></span><button class="btn sm" data-goto="money">Add a goal</button></div>`; return; }
  const money = n => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  box.innerHTML = `<div class="g-sec-h"><h2>Saving for</h2><span class="sp"></span><button class="btn sm" data-goto="money">Add money</button></div>
    <div class="gl-list">${list.map(g => { const p = Math.min(1, g.saved / g.target); return `<div class="gl-row"><b>${esc(g.name)}</b><span class="gl-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></span><span class="gl-left">${money(g.target - g.saved)} to go</span><small>${money(g.saved)} of ${money(g.target)}</small></div>`; }).join("")}</div>`;
}

/* ---------- the Study Helper card (Sky page): pairing code, setup, progress ---------- */
async function helperCard() {
  const box = $("#shCard"); if (!box || box.classList.contains("hidden") || !sky.helper) return;
  const st = await sky.helper.status().catch(() => null); if (!st) return;
  const via = await sky.study.via().catch(() => ""), live = st.seen && Date.now() - st.seen < 10 * 60e3, p = st.progress;
  box.innerHTML = `<div class="sh-head"><b>Study Helper for IXL &amp; Sadlier</b><span class="sp"></span><button class="ibtn xs" data-sh="toggle" title="Close">${icon("x")}</button></div>
    <p class="muted">A side panel in Chrome that reads the question on IXL or Sadlier, gives you a hint and the method, checks your answer, and shows the full solution after you've tried. Sky does the thinking right here in Skyline.</p>
    <div class="sh-grid">
      <div class="sh-code"><small>Pairing code</small><b>${esc(st.code)}</b><div class="row"><button class="btn xs" data-copy="${esc(st.code)}">Copy</button><button class="btn xs ghost" data-sh="code">New code</button></div></div>
      <div class="sh-st"><span class="${live ? "ok" : ""}">${live ? "● Extension connected" : "○ Extension not connected yet"}</span><span class="${via ? "ok" : "bad"}">${via ? "● AI ready (" + (via === "key" ? "Claude key" : via === "claude" ? "your Claude account" : "AI on this PC") + ")" : "○ No AI: sign in to Claude above"}</span><span class="muted">Skyline helper on port ${st.port || "—"}</span></div>
    </div>
    <ol class="sh-steps"><li>In Chrome, open <b>chrome://extensions</b> <button class="btn xs" data-copy="chrome://extensions">Copy</button> (paste it in the address bar) and turn on <b>Developer mode</b> (top right).</li>
      <li>Click <b>Load unpacked</b> (top left). A "Select Folder" window opens:
        <ol class="sh-sub"><li>Click in the address bar at the top of that window, paste this path, and press Enter: <button class="btn xs" data-copy="${esc(st.folder)}">Copy the path</button><br><code>${esc(st.folder)}</code></li>
          <li>You're now inside the folder named <b class="sh-folder">helper-extension</b>. Just click <b>Select Folder</b>.</li></ol>
        <small class="muted">Or click <button class="btn xs" data-sh="folder">Show me the folder</button> to see it in File Explorer (it's the one called <b>helper-extension</b>).</small></li>
      <li>Open IXL or Sadlier, click the <b>Sky Study Helper</b> icon (puzzle piece › pin it), then ⚙ in the panel and enter the code <b>${esc(st.code)}</b>.</li></ol>
    ${p.skills.length ? `<div class="sh-prog"><small>Your progress · ${p.total} answers</small>${(p.weak.length ? p.weak : p.skills).slice(0, 5).map(s => `<div class="sh-sk"><span>${esc(s.name)}</span><i><b style="width:${s.pct}%"></b></i><em>${s.pct}%</em></div>`).join("")}${p.weak.length ? `<small class="bad">Needs work: practise these in the panel's Practice tab</small>` : ""}</div>` : ""}`;
}

/* ---------- updates: a banner when a new version is ready ---------- */
function updates() {
  if (!sky.update) return;
  const paint = s => {
    const note = $("#updNote");
    if (note) note.textContent = s.state === "checking" ? "Checking for updates…" : s.state === "downloading" ? `Downloading Skyline ${s.next || ""}… ${s.pct || 0}%` : s.state === "ready" ? `Skyline ${s.next} is ready: restart to finish` : s.state === "latest" ? `You're on the newest version (${s.version})` : s.state === "error" ? "Couldn't check for updates: " + (s.error || "offline?") : s.state === "dev" ? "Updates work in the installed app" : s.state === "off" ? "Automatic updates aren't switched on yet" : "Updates install by themselves.";
    let b = $("#updBanner");
    if (s.state !== "ready") { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "updBanner"; b.className = "upd-banner glass"; document.body.appendChild(b); }
    b.innerHTML = `<span>Skyline <b>${esc(s.next)}</b> is ready.</span><button class="btn sm primary" data-upd="now">Restart &amp; update</button><button class="ibtn xs" data-upd="later" title="Later (it installs next time Skyline closes)">${icon("x")}</button>`;
  };
  sky.update.onStatus(paint); sky.update.status().then(paint).catch(() => {});
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-upd]"); if (b) { if (b.dataset.upd === "now") sky.update.install(); else { $("#updBanner")?.remove(); toast("It'll update the next time Skyline closes"); } }
    if (e.target.closest("#updCheck")) sky.update.check().then(paint);
  });
}

export const Fun = {
  init(n) {
    nav = { ...nav, ...n }; updates();
    paintSign(); bedtime(); setInterval(bedtime, 30e3);
    // lyric card buttons, the Study Helper card
    document.addEventListener("click", async e => {
      const sh = e.target.closest("[data-sh]");
      if (sh && sh.dataset.sh === "toggle") { $("#shCard").classList.toggle("hidden"); helperCard(); }
      if (sh && sh.dataset.sh === "code") { await sky.helper.newCode(); toast("New pairing code: enter it in the extension's ⚙ Settings"); helperCard(); }
      if (sh && sh.dataset.sh === "folder") sky.helper.folder();
      const cp = e.target.closest("[data-copy]"); if (cp) { try { await sky.copy(cp.dataset.copy); toast("Copied: " + cp.dataset.copy); } catch (er) { toast("Couldn't copy", true); } }
      if (e.target.closest("[data-lycard]")) lyricCard();
      if (e.target.closest("[data-wrapped]")) wrapped();
    });
    document.addEventListener("contextmenu", e => { const p = e.target.closest("[data-lyrics] p[data-i]"); if (p && p.textContent.trim()) { e.preventDefault(); lyricCard(+p.dataset.i); } });   // right-click a line
    // settings
    const sign = $("#setSign"), signOn = $("#setSignOn"), bed = $("#setBed"), bedAt = $("#setBedAt");
    if (sign) { sign.value = F().sign; sign.oninput = () => { F().sign = sign.value; Settings.save(); paintSign(); }; }
    if (signOn) { signOn.checked = F().signOn; signOn.onchange = () => { F().signOn = signOn.checked; Settings.save(); paintSign(); }; }
    if (bed) { bed.checked = F().bedtime; bed.onchange = () => { F().bedtime = bed.checked; Settings.save(); bedtime(); }; }
    if (bedAt) { bedAt.value = F().bedAt; bedAt.onchange = () => { F().bedAt = bedAt.value || "23:00"; store.local("bed-said", ""); Settings.save(); bedtime(); }; }
  },
  onView(v) { focusGate(v); if (v === "games") goals(); paintSign(); },
  wrapped, lyricCard,
};
