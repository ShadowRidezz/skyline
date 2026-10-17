// Extras: the command bar (Ctrl+K), the sleep timer, the daily briefing on Home, play time on the Games page,
// and backup & restore in Settings.
import { $, $$, esc, sky, toast, dialog, store } from "./util.js";
import { icon, hasIcon } from "./social/icons.js";
import { Settings, Widgets } from "./widgets.js";
import { Music } from "./music.js";
import { Games } from "./games.js";
import { Pages } from "./pages.js";
import { School } from "./school.js";
import { Assistant } from "./assistant.js";
import { FX } from "./fx.js";

const S = () => Settings.data;
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mins = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`;
const clean = e => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
let nav = { go: () => {}, ambient: () => {}, shortcuts: () => {} };

/* ================= sleep timer ================= */
export const Sleep = {
  until: 0, endOfSong: "", t: 0,
  active() { return !!(this.until || this.endOfSong); },
  // min > 0: pause after that long; "song": at the end of this song; 0: off
  set(min) {
    clearInterval(this.t); this.until = 0; this.endOfSong = "";
    if (min === "song") { const m = Music.meta; if (!m.on) { toast("Nothing's playing"); this.paint(); return; } this.endOfSong = m.title + "|" + m.artist; toast(`🌙 Music stops after “${m.title}”`); }
    else if (min > 0) { this.until = Date.now() + min * 60e3; toast(`🌙 Music stops in ${mins(min)}`); }
    else toast("Sleep timer off");
    if (this.active()) this.t = setInterval(() => this.tick(), 1000);
    this.paint();
  },
  tick() {
    const m = Music.meta;
    if (this.endOfSong) {
      const same = m.on && m.title + "|" + m.artist === this.endOfSong;
      if (!same || (m.dur > 1 && Music.pos() >= m.dur - 1.5)) return this.stop();   // this song's over (or the next one started)
    } else if (Date.now() >= this.until) return this.stop();
    if (Date.now() % 15000 < 1000) this.paint();
  },
  stop() {
    clearInterval(this.t); this.until = 0; this.endOfSong = "";
    if (Music.meta.on && Music.meta.playing) Music.cmd("pause");
    toast("🌙 Sleep timer: music paused. Good night"); this.paint();
  },
  left() { return this.endOfSong ? "song" : this.until ? Math.max(1, Math.ceil((this.until - Date.now()) / 60e3)) + "m" : ""; },
  paint() { $$("[data-sleep]").forEach(b => { b.classList.toggle("on", this.active()); const l = b.querySelector("i"); if (l) l.textContent = this.left() === "song" ? "♪" : this.left(); b.title = this.active() ? `Sleep timer: ${this.endOfSong ? "after this song" : this.left().replace("m", " min") + " left"}. Click to change` : "Sleep timer"; }); },
  menu(btn) {
    $("#sleepMenu")?.remove();
    const m = document.createElement("div"); m.id = "sleepMenu"; m.className = "sleep-menu glass";
    m.innerHTML = `<b>🌙 Stop the music…</b>${[15, 30, 45, 60, 90].map(n => `<button data-sl="${n}">in ${mins(n)}</button>`).join("")}<button data-sl="song">after this song</button>${this.active() ? `<button data-sl="0" class="off">Turn off</button>` : ""}`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect(); m.style.left = Math.min(innerWidth - 200, Math.max(8, r.left - 80)) + "px"; m.style.top = (r.bottom + 6 + m.offsetHeight > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + "px";
    const close = e => { if (e && m.contains(e.target)) return; m.remove(); document.removeEventListener("mousedown", close, true); };
    setTimeout(() => document.addEventListener("mousedown", close, true), 0);
    m.onclick = e => { const b = e.target.closest("[data-sl]"); if (!b) return; const v = b.dataset.sl; this.set(v === "song" ? "song" : +v); close(); };
  },
  init() { document.addEventListener("click", e => { const b = e.target.closest("[data-sleep]"); if (b) this.menu(b); }); this.paint(); },
};

/* ================= play time (Games page) ================= */
export const PlayTime = {
  t: 0,
  async render() {
    const box = $("#gTime"); if (!box || !sky || !sky.playtime) return;
    const s = await sky.playtime.stats().catch(() => null); if (!s) return;
    const sum = l => l.reduce((a, g) => a + g.mins, 0), today = sum(s.today), week = sum(s.week), max = Math.max(1, ...s.days.map(d => d.mins));
    const label = k => { const d = new Date(k + "T12:00"); return k === ymd(Date.now()) ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" }); };
    this.last = s;
    const html = `<div class="g-sec-h"><h2>⏱ Play time</h2>${s.week.length ? `<button class="btn sm pt-share" data-ptshare title="Make a picture of your week and send it to a friend or a server">📤 Share my week</button>` : ""}<span class="ct-note">${s.now.length ? `<b class="pt-now"><i></i>Playing ${esc(s.now.join(", "))}</b>` : "Counts only while the game is the window you're in, not when it's just open in the background. Nothing leaves your PC."}</span></div>
      <div class="pt">
        <div class="pt-stats"><div><b>${mins(today)}</b><span>today</span></div><div><b>${mins(week)}</b><span>last 7 days</span></div><div><b class="pt-top">${s.week[0] ? esc(s.week[0].name) : "–"}</b><span>most played</span></div></div>
        <div class="pt-chart">${s.days.map(d => `<span title="${esc(label(d.day))}: ${mins(d.mins)}" class="${d.day === ymd(Date.now()) ? "on" : ""}"><em>${d.mins ? mins(d.mins).replace(" min", "m").replace(" h", "h") : ""}</em><i style="height:${Math.max(2, d.mins / max * 100)}%"></i><small>${esc(label(d.day))}</small></span>`).join("")}</div>
        <div class="pt-list">${s.week.length ? s.week.slice(0, 6).map(g => `<div class="pt-row"><span>${esc(g.name)}</span><i><b style="width:${(g.mins / s.week[0].mins * 100).toFixed(1)}%"></b></i><em>${mins(g.mins)}</em></div>`).join("")
          : `<div class="pt-empty"><b>No game time yet this week</b><span>Start a game and Skyline counts the minutes, by itself.</span></div>`}</div>
      </div>`;
    if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  },
  show(on) { clearInterval(this.t); if (on) { this.render(); this.t = setInterval(() => this.render(), 60e3); } },
  // the week as a picture: total, each game's bar, the busiest day
  async card() {
    const s = this.last || await sky.playtime.stats().catch(() => null); if (!s || !s.week.length) return null;
    const W = 1200, H = 675, cv = new OffscreenCanvas(W, H), g = cv.getContext("2d");
    const css = getComputedStyle(document.documentElement), a1 = css.getPropertyValue("--a1").trim() || "#8b5cf6", a2 = css.getPropertyValue("--a2").trim() || "#3b82f6";
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#0b0a18"); bg.addColorStop(1, "#141230"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * .85, H * .1, 10, W * .85, H * .1, 520); glow.addColorStop(0, a1 + "55"); glow.addColorStop(1, "transparent"); g.fillStyle = glow; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${.15 + Math.random() * .5})`; g.fillRect(Math.random() * W, Math.random() * H * .55, 1.5, 1.5); }   // a few stars
    const font = (w, px) => `${w} ${px}px "Segoe UI Variable Display", "Segoe UI", sans-serif`;
    let name = "My"; try { const { S } = await import("./social/state.js"); if (S.me) name = S.me.display_name + "'s"; } catch (e) {}
    const total = s.week.reduce((x, y) => x + y.mins, 0);
    g.fillStyle = "rgba(255,255,255,.6)"; g.font = font(600, 26); g.fillText("SKYLINE · PLAY TIME", 64, 84);
    g.fillStyle = "#fff"; g.font = font(700, 54); g.fillText(`${name} week in games`, 64, 150);
    g.font = font(800, 96); const grad = g.createLinearGradient(64, 0, 520, 0); grad.addColorStop(0, a1); grad.addColorStop(1, a2); g.fillStyle = grad; g.fillText(mins(total), 64, 268);
    g.fillStyle = "rgba(255,255,255,.55)"; g.font = font(500, 26); g.fillText("played in the last 7 days", 64, 312);
    const top = s.week.slice(0, 5), max = top[0].mins, x0 = 64, bw = 640, y0 = 380;
    top.forEach((t, i) => {
      const y = y0 + i * 52;
      g.fillStyle = "#fff"; g.font = font(600, 26); g.fillText(t.name.length > 26 ? t.name.slice(0, 25) + "…" : t.name, x0, y);
      g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.roundRect(x0 + 380, y - 22, bw - 380, 22, 11); g.fill();
      const bar = g.createLinearGradient(x0 + 380, 0, x0 + bw, 0); bar.addColorStop(0, a1); bar.addColorStop(1, a2);
      g.fillStyle = bar; g.beginPath(); g.roundRect(x0 + 380, y - 22, Math.max(22, (bw - 380) * t.mins / max), 22, 11); g.fill();
      g.fillStyle = "rgba(255,255,255,.7)"; g.font = font(600, 22); g.textAlign = "left"; g.fillText(mins(t.mins), x0 + bw + 16, y - 3);
    });
    // the week, day by day
    const dx = 850, dw = 290, dh = 220, dy = 600, dmax = Math.max(1, ...s.days.map(d => d.mins)), cw = dw / 7;
    s.days.forEach((d, i) => { const h = Math.max(4, d.mins / dmax * dh); const bar = g.createLinearGradient(0, dy - h, 0, dy); bar.addColorStop(0, a1); bar.addColorStop(1, a2 + "88");
      g.fillStyle = bar; g.beginPath(); g.roundRect(dx + i * cw + 6, dy - h, cw - 12, h, 8); g.fill();
      g.fillStyle = "rgba(255,255,255,.5)"; g.font = font(600, 18); g.textAlign = "center"; g.fillText(new Date(d.day + "T12:00").toLocaleDateString(undefined, { weekday: "narrow" }), dx + i * cw + cw / 2, dy + 28); });
    g.textAlign = "left"; g.fillStyle = "rgba(255,255,255,.55)"; g.font = font(600, 22); g.fillText("Most played: " + top[0].name, dx - 10, dy - dh - 30 > 300 ? dy - dh - 30 : 340);
    return cv.convertToBlob({ type: "image/png" });
  },
  async share() {
    const blob = await this.card(); if (!blob) return toast("No game time yet this week", true);
    const { shareImage } = await import("./social/share.js");
    shareImage({ title: "Share my week in games", blob, name: "my-week-in-games.png", text: "my week in games 🎮" });
  },
};
document.addEventListener("click", e => { if (e.target.closest("[data-ptshare]")) PlayTime.share(); });

/* ================= the clip saver (Games page) ================= */
const KEYS = ["Alt+Shift+C", "Alt+F9", "Ctrl+Shift+F9", "F8"];
const size = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
export const ClipsUI = {
  st: null,
  async render() {
    const box = $("#gClips"); if (!box || !sky || !sky.clips) return;
    const r = await sky.clips.status().catch(() => null); if (!r || !r.ok) return; const s = this.st = r.data;
    box.innerHTML = `<div class="g-sec-h"><h2>🎬 Clips</h2><span class="ct-note">${s.on ? (s.recording ? `<b class="pt-now"><i></i>Ready: press <kbd>${esc(s.key)}</kbd> to save the last 30-60 seconds</b>` : `Starts recording by itself when you open a game. Press <kbd>${esc(s.key)}</kbd> to save a clip.`) : "Save the last 30-60 seconds of your game with one key, then send it to a friend."}</span></div>
      <div class="cl-set">
        <label class="toggle"><input type="checkbox" data-clip="on" ${s.on ? "checked" : ""}><span class="sw"></span><span class="t"><b>Clip saver</b><small>Keeps the last minute of your screen and game sound in memory while you play. Uses some graphics power.</small></span></label>
        <label class="cl-opt"><span>Clip key</span><select data-clip="key">${KEYS.map(k => `<option ${k === s.key ? "selected" : ""}>${k}</option>`).join("")}</select></label>
        <label class="cl-opt"><span>Quality</span><select data-clip="quality"><option value="720" ${s.quality === "720" ? "selected" : ""}>720p (fits in a chat)</option><option value="1080" ${s.quality === "1080" ? "selected" : ""}>1080p (sharper, bigger)</option></select></label>
        <label class="cl-opt"><span>Smoothness</span><select data-clip="fps"><option value="60" ${s.fps == 60 ? "selected" : ""}>60 fps</option><option value="30" ${s.fps == 30 ? "selected" : ""}>30 fps</option></select></label>
        <button class="btn sm ghost" data-clipopen>📂 Open clips folder</button>
      </div>
      <div class="cl-list">${s.list.length ? s.list.map(c => `<div class="cl-row"><span class="cl-ic">🎞</span><span class="cl-t"><b>${esc(c.name.replace(/\.(mp4|webm)$/i, ""))}</b><small>${size(c.size)} · ${new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span>
          <button class="btn xs primary" data-clipsend="${esc(c.name)}" ${c.size > 25 * 1048576 ? `disabled title="Over 25 MB: too big to send in a chat"` : ""}>📤 Send</button><button class="btn xs" data-clipshow="${esc(c.name)}">Show</button><button class="btn xs ghost" data-clipdel="${esc(c.name)}" title="Move to the Recycle Bin">🗑</button></div>`).join("")
        : `<div class="pt-empty"><b>No clips yet</b><span>Turn the clip saver on, play, and press your clip key when something cool happens.</span></div>`}</div>`;
  },
  async send(name) {
    const r = await sky.clips.read(name); if (!r || !r.ok) return toast("Couldn't open that clip", true);
    const type = /\.mp4$/i.test(name) ? "video/mp4" : "video/webm";
    const { shareImage } = await import("./social/share.js");
    shareImage({ title: "Send a clip", blob: new Blob([r.data], { type }), name, text: "" });
  },
  init() {
    if (!sky || !sky.clips) return;
    document.addEventListener("change", async e => {
      const t = e.target.closest("[data-clip]"); if (!t || !t.closest("#gClips")) return;
      const k = t.dataset.clip, v = t.type === "checkbox" ? t.checked : t.value;
      const r = await sky.clips.set({ [k]: v }); if (r && r.ok) { if (k === "on") toast(v ? "🎬 Clip saver on: it records while you play" : "Clip saver off"); this.render(); }
    });
    document.addEventListener("click", async e => {
      const b = e.target.closest("[data-clipsend], [data-clipshow], [data-clipdel], [data-clipopen]"); if (!b || !b.closest("#gClips, #toast, .clip-toast")) return;
      if (b.dataset.clipsend) return this.send(b.dataset.clipsend);
      if (b.dataset.clipshow) return sky.clips.open(b.dataset.clipshow);
      if (b.hasAttribute("data-clipopen")) return sky.clips.open();
      if (b.dataset.clipdel && await dialog({ title: "Delete this clip?", text: "It goes to the Recycle Bin.", ok: "Delete", danger: true })) { await sky.clips.del(b.dataset.clipdel); this.render(); }
    });
    sky.clips.onStatus(() => { if ($("#gClips") && !$("#view-games").classList.contains("hidden")) this.render(); });
    sky.clips.onSaved(c => { this.render(); toast(`🎬 Clip saved${c.game ? " · " + c.game : ""}`); });
  },
};
ClipsUI.init();

/* ================= backup & restore (Settings › App) ================= */
const Backup = {
  init() {
    const save = $("#bkSave"), restore = $("#bkRestore"); if (!save || !sky || !sky.backup) return;
    save.onclick = async () => {
      save.disabled = true;
      try { const r = await sky.backup.save(); if (r) { $("#bkNote").textContent = `✓ Saved ${r.files} files${r.games ? ` (including ${r.games} game${r.games > 1 ? "s" : ""} you made)` : ""} to ${r.path}`; toast("💾 Backup saved"); } }
      catch (e) { toast(clean(e), true); } finally { save.disabled = false; }
    };
    restore.onclick = async () => {
      let r; try { r = await sky.backup.pick(); } catch (e) { return toast(clean(e), true); } if (!r) return;
      const when = r.created ? new Date(r.created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "an unknown date";
      if (!await dialog({ title: "Restore this backup?", text: `From ${when} (Skyline ${r.version || "?"}): ${r.files} files${r.games ? `, ${r.games} game${r.games > 1 ? "s" : ""}` : ""}. Your themes, notes, school, money, memory and stats are replaced with the backup's. Your sign-ins and keys stay as they are. Skyline restarts.`, ok: "Restore and restart", danger: true })) return;
      try { await sky.backup.restore(); toast("Restoring… Skyline restarts in a moment"); } catch (e) { toast(clean(e), true); }
    };
  },
};

/* ================= the daily briefing (Home, once a day) ================= */
export const Briefing = {
  text: "",
  async show(force) {
    const box = $("#brief"); if (!box || !sky) return;
    const k = ymd(Date.now());
    if (!force && (S().brief === false || store.local("brief-done") === k || new Date().getHours() < 4)) { box.classList.add("hidden"); return; }
    const greet = ($("[data-greet]")?.textContent || "").split(",")[0].trim(), h = new Date().getHours(), hi = `${/^good /i.test(greet) ? greet.toLowerCase().replace(/^\w/, c => c.toUpperCase()) : `Good ${h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"}`}${S().name ? ", " + S().name : ""}`;   // the same greeting as the clock
    const [plays, pt] = await Promise.all([sky.plays ? sky.plays.stats("week").catch(() => null) : null, sky.playtime ? sky.playtime.stats().catch(() => null) : null]);
    const lines = [], say = [];
    const wx = Widgets.weatherText ? Widgets.weatherText() : ""; if (wx) { lines.push(["cloud", `It's ${esc(wx)}`]); say.push(`It's ${wx}`); }
    const sc = School.brief();
    if (sc) {
      const list = l => l.slice(0, 3).join(", ") + (l.length > 3 ? ` and ${l.length - 3} more` : "");
      if (sc.now) lines.push(["cap", `You're in <b>${esc(sc.now)}</b> right now.`]);
      if (sc.overdue.length) { lines.push(["alert", `<b>${sc.overdue.length} overdue:</b> ${esc(list(sc.overdue))}`]); say.push(`${sc.overdue.length} thing${sc.overdue.length > 1 ? "s are" : " is"} overdue: ${list(sc.overdue)}.`); }
      if (sc.today.length) { lines.push(["pin", `<b>Due today:</b> ${esc(list(sc.today))}`]); say.push(`Due today: ${list(sc.today)}.`); }
      if (sc.tomorrow.length) { lines.push(["book", `<b>Due tomorrow:</b> ${esc(list(sc.tomorrow))}`]); say.push(`Due tomorrow: ${list(sc.tomorrow)}.`); }
      if (sc.test && sc.test.days <= 7) { const d = sc.test.days === 0 ? "today" : sc.test.days === 1 ? "tomorrow" : `in ${sc.test.days} days`; lines.push(["flask", `<b>${esc(sc.test.name)}</b> is ${d}.`]); say.push(`${sc.test.name} is ${d}.`); }
      if (!sc.overdue.length && !sc.today.length && !sc.tomorrow.length) { lines.push(["checkCircle", "Nothing due today or tomorrow."]); say.push("Nothing's due today or tomorrow."); }
      if (sc.streak > 1) lines.push(["flame", `${sc.streak}-day homework streak.`]);
    }
    const cd = (S().countdowns || []).map(c => { const t = c.yearly ? (() => { const [y, m, d] = c.date.split("-").map(Number), n = new Date(); let x = new Date(n.getFullYear(), m - 1, d); if (x < new Date(n.getFullYear(), n.getMonth(), n.getDate())) x = new Date(n.getFullYear() + 1, m - 1, d); return x.getTime(); })() : new Date(c.date + "T00:00").getTime(); return { name: c.name, days: Math.round((t - new Date().setHours(0, 0, 0, 0)) / 864e5) }; }).filter(c => c.days >= 0).sort((a, b) => a.days - b.days)[0];
    if (cd) { lines.push(["clock", cd.days === 0 ? `<b>${esc(cd.name)}</b> is today.` : `<b>${cd.days}</b> day${cd.days > 1 ? "s" : ""} until ${esc(cd.name)}.`]); say.push(cd.days === 0 ? `${cd.name} is today!` : `${cd.days} day${cd.days > 1 ? "s" : ""} until ${cd.name}.`); }
    const top = plays && (plays.songs || plays.top || [])[0];
    // the song you listened to the longest this week (once there's enough listening to say)
    if (top && (top.title || top.name) && plays.mins >= 10) lines.push(["music", `Your most-played song this week: <b>${esc(top.title || top.name)}</b>${top.artist ? " by " + esc(top.artist) : ""} (${mins(Math.max(1, Math.round((top.secs || 0) / 60)))}) · ${mins(plays.mins)} of music in all.`]);
    if (pt && pt.days && pt.days.length > 1) { const y = pt.days[pt.days.length - 2]; if (y.mins >= 5) lines.push(["gamepad", `${mins(y.mins)} of games yesterday.`]); }
    this.text = [hi + ".", ...say].join(" ");
    box.innerHTML = `<div class="br-h"><span class="br-hi">Today</span><span class="sp"></span><button class="ibtn xs" data-br="say" title="Read it to me" aria-label="Read it to me">${icon("volume")}</button><button class="ibtn xs" data-br="off" title="Hide for today" aria-label="Hide for today">${icon("x")}</button></div>
      <div class="br-l">${lines.map(([i, t]) => `<div><span>${icon(i)}</span><p>${t}</p></div>`).join("") || `<div><span>${icon("sun")}</span><p>Have a good one.</p></div>`}</div>`;
    box.classList.remove("hidden");
    if (force) FX.cascade(box.parentElement, "#brief");
    if (!wx && !this.retried) { this.retried = true; setTimeout(() => { if (!box.classList.contains("hidden")) this.show(force); }, 6000); }   // the weather loads a moment after start
  },
  init() {
    const box = $("#brief"); if (!box) return;
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-br]"); if (!b) return;
      if (b.dataset.br === "say") Assistant.speak(this.text);
      if (b.dataset.br === "off") { store.local("brief-done", ymd(Date.now())); box.classList.add("hidden"); }
    });
  },
};

/* ================= the command bar (Ctrl+K) ================= */
const PAGES = [["home", "home", "Home"], ["music", "music", "Music & lyrics"], ["games", "gamepad", "Games"], ["school", "cap", "School"], ["money", "wallet", "Money"], ["youtube", "play", "YouTube"], ["minecraft", "cube", "Minecraft"], ["settings", "settings", "Settings"]];
const SECTIONS = [["appearance", "Theme Studio (backgrounds)"], ["home", "Home widgets"], ["music", "Music settings"], ["assistant", "Assistant & voice"], ["ai", "AI builder & key"], ["ui", "Interface"], ["auto", "Automations"], ["app", "App, startup & backup"], ["about", "About Skyline"]];
function score(text, q) {   // how well "q" matches: start of the name > start of a word > anywhere > letters in order
  const t = text.toLowerCase(); if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length / 100;
  const i = t.indexOf(" " + q); if (i >= 0) return 80 - i / 100;
  const j = t.indexOf(q); if (j >= 0) return 60 - j / 100;
  let k = 0; for (const c of t) if (c === q[k]) k++; return k === q.length && q.length > 1 ? 20 - t.length / 100 : 0;
}
function calc(q) {   // quick maths: "12*8+3", "2^10", "(5+3)/4", "-3*(2+1)"
  if (!/^[\d\s+\-*/().^,x×÷]+$/i.test(q) || !/\d\s*[+\-*/^x×÷]\s*[\d(.-]/i.test(q)) return null;
  const t = q.replace(/,/g, "").replace(/[x×]/gi, "*").replace(/÷/g, "/").match(/\d*\.?\d+|[+\-*/^()]/g) || []; let i = 0;
  const num = () => { const k = t[i++]; if (k === "(") { const v = add(); if (t[i++] !== ")") throw 0; return v; } if (k === "-") return -pow(); if (k === "+") return pow(); const v = parseFloat(k); if (isNaN(v)) throw 0; return v; };
  const pow = () => { const b = num(); if (t[i] === "^") { i++; return Math.pow(b, unary()); } return b; };
  const unary = () => pow();
  const mul = () => { let v = pow(); while (t[i] === "*" || t[i] === "/") { const o = t[i++], r = pow(); v = o === "*" ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (t[i] === "+" || t[i] === "-") { const o = t[i++], r = mul(); v = o === "+" ? v + r : v - r; } return v; };
  try { const v = add(); return i === t.length && isFinite(v) ? +v.toFixed(10) : null; } catch (e) { return null; }
}
export const CmdK = {
  sel: 0, list: [], extra: [],
  async open() {
    if ($("#cmdk")) return $("#cmdkIn").focus();
    const box = document.createElement("div"); box.id = "cmdk"; box.className = "cmdk";
    box.innerHTML = `<div class="ck glass"><label class="ck-in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="cmdkIn" placeholder="Go anywhere, open a game, play a song, do maths…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label><div class="ck-list" id="cmdkList"></div>
      <div class="ck-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> go</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere</span></div></div>`;
    document.body.appendChild(box);
    const inp = $("#cmdkIn"); inp.focus();
    inp.oninput = () => { this.sel = 0; this.render(); };
    inp.onkeydown = e => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.sel = Math.min(this.list.length - 1, this.sel + 1); this.paintSel(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.sel = Math.max(0, this.sel - 1); this.paintSel(); }
      else if (e.key === "Enter") { e.preventDefault(); this.run(this.list[this.sel]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); }
    };
    box.addEventListener("mousedown", e => { if (e.target === box) this.close(); });
    box.addEventListener("click", e => { const r = e.target.closest("[data-ck]"); if (r) this.run(this.list[+r.dataset.ck]); });
    box.addEventListener("mousemove", e => { const r = e.target.closest("[data-ck]"); if (r && +r.dataset.ck !== this.sel) { this.sel = +r.dataset.ck; this.paintSel(); } });
    this.render();
    this.extra = await this.gather(); if ($("#cmdk")) this.render();
  },
  close() { $("#cmdk")?.remove(); },
  // things that need a look on disk: modpacks, notes, homework, flashcard decks
  async gather() {
    const out = [];
    try { for (const p of (await sky.pages.mcProfiles()) || []) out.push({ i: "cube", t: p.title || p.name, s: "Minecraft modpack · play", run: () => sky.pages.mcLaunch(p.name).then(() => toast(`Starting ${p.title || p.name}…`)).catch(e => toast(clean(e), true)) }); } catch (e) {}
    for (const x of School.search()) out.push({ i: x.i, t: x.t, s: x.s, run: () => { School.reveal(x); nav.go("school"); } });
    return out;
  },
  items(q) {
    const r = [];
    const c = calc(q); if (c != null) r.push({ i: "calc", t: `= ${c.toLocaleString(undefined, { maximumFractionDigits: 10 })}`, s: "Enter copies it", score: 1000, run: () => { navigator.clipboard.writeText(String(c)).catch(() => {}); toast(`Copied ${c}`); } });
    for (const [v, i, t] of PAGES) r.push({ i, t, s: "Page", run: () => nav.go(v) });
    for (const [v, t] of SECTIONS) r.push({ i: "settings", t, s: "Settings", run: () => nav.go("settings", v) });
    const playing = Music.meta.on && Music.meta.playing;
    r.push({ i: playing ? "pause" : "play", t: playing ? "Pause music" : "Play music", s: "Music · Space", run: () => Music.cmd("toggle") },
      { i: "next", t: "Next song", s: "Music · N", run: () => Music.cmd("next") }, { i: "prev", t: "Previous song", s: "Music · P", run: () => Music.cmd("prev") },
      { i: "pip", t: "Mini player", s: "M", run: () => sky.mini.toggle() }, { i: "moon", t: "Ambient mode", s: "", run: () => nav.ambient(true) },
      { i: "mic", t: "Talk to Sky", s: "A", run: () => Assistant.listen() },
      { i: "moon", t: "Sleep timer: 30 minutes", s: "Music stops by itself", run: () => Sleep.set(30) }, { i: "moon", t: "Sleep timer: after this song", s: "Music stops by itself", run: () => Sleep.set("song") },
      ...(Sleep.active() ? [{ i: "moon", t: "Turn off the sleep timer", s: "", run: () => Sleep.set(0) }] : []),
      { i: "timer", t: "Focus timer: 25 minutes", s: "Study / work session", run: () => { Widgets.timer(25); toast("25-minute focus timer started"); } },
      { i: "gift", t: "Weekly Wrapped", s: "Your week in music and games, as a picture", run: () => import("./fun.js").then(m => m.wrapped()) },
      { i: "image", t: "Share this lyric", s: "The line that's playing, as a picture", run: () => import("./fun.js").then(m => m.lyricCard()) },
      { i: "sun", t: "Daily briefing", s: "Weather, school, countdowns", run: () => { nav.go("home"); setTimeout(() => Briefing.show(true), 350); } },
      { i: "search", t: "Search games", s: "G", run: () => Games.search() }, { i: "save", t: "Back up Skyline", s: "Settings › App", run: () => { nav.go("settings", "app"); setTimeout(() => $("#bkSave")?.click(), 400); } },
      { i: "keyboard", t: "Keyboard shortcuts", s: "?", run: () => nav.shortcuts() });
    for (const g of Games.items()) r.push({ i: g.kind === "made" ? "sparkle" : "gamepad", t: g.name, s: g.kind === "made" ? "Your game · play" : "Game · play", run: () => Games.play(g.kind, g.id) });
    r.push(...this.extra);
    const ql = q.toLowerCase().trim();
    const hits = ql ? r.map(x => ({ ...x, score: x.score || score(x.t, ql) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 9) : r.filter(x => x.s === "Page").concat(r.filter(x => /Daily briefing|Sleep timer: 30|Focus timer/.test(x.t)));
    if (ql) {   // and always: ask for it
      hits.push({ i: "play", t: `Play “${q.trim()}”`, s: "Music · Spotify, YouTube or your songs", run: () => this.ask("play " + q.trim()) },
        { i: "sparkle", t: `Ask Sky: “${q.trim()}”`, s: "Assistant", run: () => this.ask(q.trim()) },
        { i: "globe", t: `Search the web for “${q.trim()}”`, s: "Google", run: () => sky.openUrl("https://www.google.com/search?q=" + encodeURIComponent(q.trim())) });
    }
    return hits;
  },
  async ask(text) { toast(text); try { const r = await Assistant.converse(text); if (r && r.reply) toast(r.reply.slice(0, 160)); } catch (e) { toast(clean(e), true); } },
  render() {
    const q = $("#cmdkIn")?.value || ""; this.list = this.items(q);
    const box = $("#cmdkList"); if (!box) return;
    box.innerHTML = this.list.map((x, n) => `<button class="ck-r" data-ck="${n}"><span class="ck-i">${hasIcon(x.i) ? icon(x.i) : esc(x.i || "")}</span><span class="ck-t">${esc(x.t)}</span><small>${esc(x.s || "")}</small></button>`).join("") || `<div class="ck-none">Nothing found</div>`;
    this.paintSel();
  },
  paintSel() { $$("#cmdkList [data-ck]").forEach(b => b.classList.toggle("on", +b.dataset.ck === this.sel)); const on = $("#cmdkList .on"); if (on) on.scrollIntoView({ block: "nearest" }); },
  run(x) { if (!x) return; this.close(); try { const r = x.run(); if (r && r.catch) r.catch(e => toast(clean(e), true)); } catch (e) { toast(clean(e), true); } },
};

export const Extras = {
  init(n) {
    nav = { ...nav, ...n };
    Sleep.init(); Backup.init(); Briefing.init();
  },
  onView(v) {
    PlayTime.show(v === "games");
    if (v === "games") ClipsUI.render();
    if (v === "home") Briefing.show(false);
  },
};
