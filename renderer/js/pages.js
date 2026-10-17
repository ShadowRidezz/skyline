// The side-bar pages: AI chat, School, Money, YouTube and Minecraft. Everything is saved on this PC.
import { $, $$, esc, sky, toast, dialog, store, debounce, mmss } from "./util.js";
import { icon } from "./social/icons.js";
import { Settings, Widgets } from "./widgets.js";
import { FX } from "./fx.js";
import { Assistant } from "./assistant.js";
import { School } from "./school.js";

const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const day = 864e5;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const parseDay = s => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d).getTime() : 0; };
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const D = {};   // each page's saved data
const save = name => store.write(name, D[name]);
const saveSoon = {};
const saveLater = name => { (saveSoon[name] = saveSoon[name] || debounce(() => save(name), 500))(); };
async function load(name, def) { D[name] = { ...def, ...((await store.read(name)) || {}) }; return D[name]; }
const clean = e => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#f97316"];

/* ================= Money ================= */
const CATS = { food: ["coffee", "Food"], games: ["gamepad", "Games"], fun: ["star", "Fun"], clothes: ["tag", "Clothes"], tech: ["window", "Tech"], transport: ["globe", "Transport"], subs: ["repeat", "Subscriptions"], gifts: ["gift", "Gifts"], other: ["layers", "Other"],
  job: ["wallet", "Job"], allowance: ["dollar", "Allowance"], sold: ["tag", "Sold something"], gift_in: ["gift", "Gift"] };
const money = n => (n < 0 ? "-" : "") + new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Math.abs(n));
const Money = {
  type: "out",
  async init() {
    await load("money", { entries: [], goals: [] });
    const v = $("#view-money");
    v.addEventListener("click", e => {
      const t = e.target.closest("[data-mtype]"); if (t) { this.type = t.dataset.mtype; this.render(); return; }
      const del = e.target.closest("[data-edel]"); if (del) { D.money.entries = D.money.entries.filter(x => x.id !== del.dataset.edel); save("money"); return this.render(); }
      const gadd = e.target.closest("[data-gadd]"); if (gadd) return this.goalAdd(gadd.dataset.gadd);
      const gdel = e.target.closest("[data-gdel]"); if (gdel) { D.money.goals = D.money.goals.filter(x => x.id !== gdel.dataset.gdel); save("money"); return this.render(); }
    });
    v.addEventListener("submit", e => {
      e.preventDefault();
      if (e.target.id === "mAdd") { const f = e.target, amt = Math.abs(parseFloat(f.amt.value)); if (!(amt > 0)) return toast("Enter an amount", true);
        D.money.entries.push({ id: uid("e"), amt: Math.round(amt * 100) / 100, type: this.type, cat: f.cat.value, note: f.note.value.trim().slice(0, 60), date: parseDay(f.date.value) || Date.now() });
        f.amt.value = ""; f.note.value = ""; save("money"); this.render(); FX.sound("success"); }
      if (e.target.id === "mGoal") { const f = e.target, name = f.name.value.trim(), target = parseFloat(f.target.value); if (!name || !(target > 0)) return toast("Give the goal a name and an amount", true);
        D.money.goals.push({ id: uid("g"), name: name.slice(0, 40), target, saved: 0 }); f.reset(); save("money"); this.render(); }
    });
  },
  async goalAdd(id) {
    const g = D.money.goals.find(x => x.id === id); if (!g) return;
    const v = await dialog({ title: `Add to “${g.name}”`, text: "How much did you put aside? (Use a minus to take some out.)", input: "", ok: "Add" }); if (v == null) return;
    const n = parseFloat(v); if (!n) return; g.saved = Math.max(0, Math.round((g.saved + n) * 100) / 100); save("money"); this.render();
    if (g.saved >= g.target) { FX.confetti(innerWidth / 2, innerHeight / 3); toast(`You reached “${g.name}”!`); }
  },
  render() {
    const d = D.money; if (!d) return;
    const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), month = d.entries.filter(e => e.date >= m0);
    const sum = (l, t) => l.filter(e => e.type === t).reduce((a, e) => a + e.amt, 0);
    const bal = sum(d.entries, "in") - sum(d.entries, "out"), mIn = sum(month, "in"), mOut = sum(month, "out");
    $("#mStats").innerHTML = `<div class="pg-stat big ${bal < 0 ? "bad" : "ok"}"><b>${money(bal)}</b><span>Balance (everything you've logged)</span></div>
      <div class="pg-stat ok"><b>${money(mIn)}</b><span>In this month</span></div><div class="pg-stat ${mOut > mIn && mIn ? "warn" : ""}"><b>${money(mOut)}</b><span>Out this month</span></div>`;
    $$("[data-mtype]").forEach(b => b.classList.toggle("on", b.dataset.mtype === this.type));
    const f = $("#mAdd"), cats = (this.type === "in" ? ["job", "allowance", "sold", "gift_in", "other"] : Object.keys(CATS).filter(k => !["job", "allowance", "sold", "gift_in"].includes(k))).map(k => [k, CATS[k]]);
    const keep = f.cat.value; f.cat.innerHTML = cats.map(([k, [, n]]) => `<option value="${k}">${n}</option>`).join(""); if (cats.some(c => c[0] === keep)) f.cat.value = keep;
    if (!f.date.value) f.date.value = ymd(Date.now());
    // where it went this month
    const by = {}; for (const e of month.filter(e => e.type === "out")) by[e.cat] = (by[e.cat] || 0) + e.amt;
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]), max = rows.length ? rows[0][1] : 1;
    $("#mCats").innerHTML = rows.length ? rows.map(([k, v], i) => `<div class="m-bar" style="--w:${(v / max * 100).toFixed(1)}%;--c:${COLORS[i % COLORS.length]}"><span>${icon((CATS[k] || CATS.other)[0])}${(CATS[k] || CATS.other)[1]}</span><i></i><b>${money(v)}</b></div>`).join("")
      : `<div class="pg-empty">Nothing spent this month yet.</div>`;
    const list = d.entries.slice().sort((a, b) => b.date - a.date).slice(0, 40);
    $("#mList").innerHTML = list.length ? list.map(e => `<div class="m-row ${e.type}"><span class="m-ic">${icon((CATS[e.cat] || CATS.other)[0])}</span><span class="m-t"><b>${esc(e.note || (CATS[e.cat] || CATS.other)[1])}</b><small>${new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${(CATS[e.cat] || CATS.other)[1]}</small></span>
      <b class="m-amt">${e.type === "in" ? "+" : "−"}${money(e.amt)}</b><button class="ibtn xs" data-edel="${e.id}" title="Remove">${icon("x")}</button></div>`).join("") : `<div class="pg-empty">Log what you earn and spend, and see where your money goes.</div>`;
    $("#mGoals").innerHTML = d.goals.length ? d.goals.map((g, i) => { const p = Math.min(1, g.saved / g.target);
      return `<div class="m-goal ${p >= 1 ? "reached" : ""}" style="--p:${(p * 100).toFixed(1)}%;--c:${COLORS[(i + 3) % COLORS.length]}"><div class="row"><b>${esc(g.name)}</b><span class="sp"></span><span>${money(g.saved)} of ${money(g.target)}</span></div>
        <div class="m-prog"><i></i></div><div class="row"><small>${p >= 1 ? "Goal reached!" : money(g.target - g.saved) + " to go"}</small><span class="sp"></span><button class="btn xs" data-gadd="${g.id}">Add money</button><button class="ibtn xs" data-gdel="${g.id}" title="Remove goal">${icon("x")}</button></div></div>`; }).join("")
      : `<div class="pg-empty">Saving up for something? Add a goal.</div>`;
  },
};

/* ================= YouTube ================= */
const YouTube = {
  results: [], playing: null, q: "", more: "", loading: false, gen: 0,
  async init() {
    await load("youtube", { saved: [], recent: [], pos: {} });
    D.youtube.pos = D.youtube.pos || {};
    // the player tells us where it is (YouTube's own embed messages), so a video picks up where you left it
    addEventListener("message", e => {
      if (!/^https:\/\/www\.youtube-nocookie\.com$/.test(e.origin)) return;
      const f = $("#ytPlayer iframe"); if (!f || e.source !== f.contentWindow) return;
      let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch (er) { return; }
      if (m && (m.event === "onReady" || m.event === "infoDelivery") && !this.ready) { this.ready = true; if (this.pending) { this.cmd("loadVideoById", this.pending); this.pending = null; } }
      const info = m && m.event === "infoDelivery" && m.info; if (!info) return;
      if (typeof info.currentTime === "number" || info.playerState != null) this.heard = true;
      if (!this.playing) return;
      if (info.videoData && info.videoData.video_id) this.sure = info.videoData.video_id === this.playing.id;
      if (!this.sure) return;   // until the player says it's on the new video, its messages are about the old one
      if (typeof info.currentTime === "number") this.at = info.currentTime;
      if (typeof info.duration === "number" && info.duration > 0) this.dur = info.duration;
      if (info.playerState === 0) { delete D.youtube.pos[this.playing.id]; this.at = 0; saveLater("youtube"); return; }   // watched to the end: start fresh next time
      if (Date.now() - (this.savedAt || 0) > 4000) this.remember();
    });
    addEventListener("beforeunload", () => this.remember(true));
    const v = $("#view-youtube");
    $("#ytForm").addEventListener("submit", e => { e.preventDefault(); this.search($("#ytQ").value.trim()); });
    v.addEventListener("click", e => {
      const chip = e.target.closest("[data-ytq]"); if (chip) { $("#ytQ").value = chip.dataset.ytq; return this.search(chip.dataset.ytq); }
      const card = e.target.closest("[data-yt]"); if (card) { const [list, i] = card.dataset.yt.split(":"), item = (list === "r" ? this.results : D.youtube[list === "s" ? "saved" : "recent"])[+i]; if (item) this.play(item); return; }
      if (e.target.closest("[data-yt-clear]")) { this.gen++; this.results = []; this.more = ""; this.q = ""; $("#ytQ").value = ""; return this.render(); }
      if (e.target.closest("[data-yt-retry]")) return this.fill();
      const a = e.target.closest("[data-yta]"); if (!a || !this.playing) return;
      if (a.dataset.yta === "close") this.stop();
      if (a.dataset.yta === "full") { const f = $("#ytPlayer iframe"); if (f) f.requestFullscreen().catch(er => toast("Couldn't go full screen: " + er.message, true)); }
      if (a.dataset.yta === "open") sky.openUrl("https://www.youtube.com/watch?v=" + this.playing.id);
      if (a.dataset.yta === "save") { const s = D.youtube.saved, at = s.findIndex(x => x.id === this.playing.id); if (at >= 0) s.splice(at, 1); else s.unshift(this.playing); save("youtube"); this.render(); toast(at >= 0 ? "Removed from saved" : "Saved"); }
    });
    // endless results: when the end of the list comes near the bottom of the screen, the next page loads
    new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) this.fill(); }, { rootMargin: "0px 0px 900px 0px" }).observe($("#ytMore"));
  },
  async search(q) {
    if (!q) return; const gen = ++this.gen; this.q = q; this.more = ""; this.results = [];
    $("#ytSaved").innerHTML = $("#ytRecent").innerHTML = "";
    $("#ytResults").innerHTML = `<div class="g-loading"><i></i><i></i><i></i><span>Searching YouTube…</span></div>`; $("#ytMore").innerHTML = "";
    try { const r = await sky.pages.ytSearch(q); if (gen !== this.gen) return; this.results = r.items || []; this.more = r.more || ""; }
    catch (e) { if (gen !== this.gen) return; toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
    this.render(); this.fill();
  },
  near() { const r = $("#ytMore").getBoundingClientRect(); return r.height >= 0 && r.top < innerHeight + 900 && !!$("#ytMore").offsetParent; },
  async fill() {   // keep loading pages until the screen is full (then scrolling asks for more)
    if (this.loading) return;
    this.loading = true; let failed = false;
    try {
      for (let n = 0; n < 10 && this.more && this.near(); n++) {
        const gen = this.gen; $("#ytMore").innerHTML = `<div class="g-loading"><i></i><i></i><i></i><span>Loading more…</span></div>`;
        let r; try { r = await sky.pages.ytMore(this.more, this.results.map(x => x.id)); }
        catch (e) { failed = true; if (gen === this.gen) $("#ytMore").innerHTML = `<div class="pg-empty">Couldn't load more. <button class="btn xs" data-yt-retry>Try again</button></div>`; return; }
        if (gen !== this.gen) return;
        const start = this.results.length, items = r.items || [];
        this.results.push(...items); this.more = r.more || "";
        const grid = $("#ytResults .yt-grid"); if (grid) grid.insertAdjacentHTML("beforeend", items.map((x, i) => this.card(x, "r:" + (start + i))).join(""));
        if (!items.length && !this.more) break;
      }
    } finally {
      this.loading = false;
      if (!failed) $("#ytMore").innerHTML = this.q && this.results.length && !this.more ? `<div class="pg-empty">That's everything YouTube has for “${esc(this.q)}”.</div>` : "";
    }
  },
  // where you are in the video, kept per video (the last 200)
  remember(now) {
    const p = this.playing; if (!p || !(this.at > 5)) return;
    this.savedAt = Date.now();
    const d = this.dur || 0;
    if (d && this.at > d - 20) delete D.youtube.pos[p.id]; else D.youtube.pos[p.id] = { t: Math.floor(this.at), d: Math.floor(d), at: Date.now() };
    const keys = Object.keys(D.youtube.pos); if (keys.length > 200) keys.sort((a, b) => D.youtube.pos[a].at - D.youtube.pos[b].at).slice(0, keys.length - 200).forEach(k => delete D.youtube.pos[k]);
    if (now) save("youtube"); else saveLater("youtube");
  },
  // The player stays loaded while you're on this page, so a video (or picking up where you left off)
  // starts in about half the time: only the video itself has to load, not YouTube's whole player.
  frame(id, start, autoplay) {
    clearTimeout(this.coolT); this.ready = this.heard = false; this.pending = null; this.warmAt = Date.now();
    $("#ytPlayer").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=${autoplay ? 1 : 0}&rel=0&modestbranding=1&enablejsapi=1${start ? "&start=" + start : ""}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="YouTube player"></iframe>`;
    // say hello until the player is reporting where it is (it needs a hello after it's ready), every half second for up to 20 s
    const f = $("#ytPlayer iframe"); f.addEventListener("load", () => { let n = 0; const hi = () => { if (this.heard || !f.isConnected || n++ > 40) return;
      try { f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "https://www.youtube-nocookie.com"); } catch (e) {} setTimeout(hi, 500); }; hi(); });
  },
  cmd(func, ...args) { const f = $("#ytPlayer iframe"); if (f) try { f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), "https://www.youtube-nocookie.com"); } catch (e) {} },
  warm() {   // open the YouTube page: get the player ready in the background, silently
    clearTimeout(this.coolT);
    if (this.playing || $("#ytPlayer iframe")) return;
    const d = D.youtube, first = d && (d.recent[0] || d.saved[0]);
    this.frame(first ? first.id : "M7lc1UVf-VE", 0, false);
  },
  cool() {   // left the page with nothing playing: let the player go after a while, to free its memory
    clearTimeout(this.coolT);
    this.coolT = setTimeout(() => { if (!this.playing && !$("#view-youtube").offsetParent) { $("#ytPlayer").innerHTML = ""; this.ready = this.heard = false; } }, 120e3);
  },
  play(item) {
    if (this.playing && this.playing.id !== item.id) this.remember(true);
    this.playing = item; this.at = 0; this.dur = 0; this.sure = false;
    const resume = D.youtube.pos[item.id], start = resume && resume.t > 10 && (!resume.d || resume.t < resume.d - 20) ? resume.t : 0;
    if (start) { this.at = start; toast(`Picking up where you left off: ${mmss(start)}`); }
    const r = D.youtube.recent.filter(x => x.id !== item.id); r.unshift(item); D.youtube.recent = r.slice(0, 24); save("youtube");
    // the same ad-free privacy embed as before (youtube-nocookie); enablejsapi lets it report its position and take the next video
    const iframe = $("#ytPlayer iframe"), next = { videoId: item.id, startSeconds: start };
    if (iframe && this.ready) this.cmd("loadVideoById", next);
    else if (iframe && Date.now() - this.warmAt < 15e3) this.pending = next;   // still warming up: it plays the moment the player is ready
    else this.frame(item.id, start, true);
    $("#ytPlayer iframe").title = item.title;
    clearTimeout(this.coolT);
    $("#ytNow").classList.remove("hidden"); this.render();
    $("#ytNow").scrollIntoView({ behavior: "smooth", block: "start" });
  },
  stop() { this.remember(true); this.playing = null; this.pending = null; if (this.ready) this.cmd("stopVideo"); else $("#ytPlayer").innerHTML = ""; $("#ytNow").classList.add("hidden"); this.render(); },
  card(x, key) { const r = D.youtube.pos[x.id], pct = r && r.d ? Math.min(100, r.t / r.d * 100) : 0;
    return `<button class="yt-card" data-yt="${key}" title="${esc(x.title)}${r ? " · left off at " + mmss(r.t) : ""}"><span class="yt-th"><img src="${esc(x.thumb)}" alt="" loading="lazy">${x.live ? `<i class="live">LIVE</i>` : x.length ? `<i>${esc(x.length)}</i>` : ""}<span class="yt-go"><svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg></span>${r ? `<span class="yt-resume"><em style="width:${pct || 8}%"></em></span>` : ""}</span>
      <b>${esc(x.title)}</b><small>${esc([x.channel, x.views, x.age].filter(Boolean).join(" · "))}</small></button>`; },
  render() {
    const d = D.youtube; if (!d) return;
    const p = this.playing;
    if (p) { $("#ytNowT").innerHTML = `<b>${esc(p.title)}</b><small>${esc(p.channel || "")}</small>`; $("[data-yta=save]").textContent = d.saved.some(x => x.id === p.id) ? "Saved" : "Save"; }
    const searching = !!this.q;
    $("#ytResults").innerHTML = searching ? `<div class="pg-h">Results for “${esc(this.q)}” <span class="sp"></span><button class="btn xs ghost" data-yt-clear>Clear search</button></div>`
      + (this.results.length ? `<div class="yt-grid">${this.results.map((x, i) => this.card(x, "r:" + i)).join("")}</div>` : `<div class="pg-empty">No videos found. Try different words.</div>`) : "";
    if (searching) { $("#ytSaved").innerHTML = $("#ytRecent").innerHTML = ""; return; }   // saved and recent come back when the search is cleared
    $("#ytSaved").innerHTML = d.saved.length ? `<h3 class="pg-h">Saved</h3><div class="yt-grid">${d.saved.map((x, i) => this.card(x, "s:" + i)).join("")}</div>` : "";
    $("#ytRecent").innerHTML = d.recent.length ? `<h3 class="pg-h">Recently watched</h3><div class="yt-grid">${d.recent.slice(0, 12).map((x, i) => this.card(x, "h:" + i)).join("")}</div>` : "";
  },
};

/* ================= Minecraft ================= */
const Minecraft = {
  status: {}, timer: 0,
  async init() {
    await load("minecraft", { servers: ["hypixel.net", "donutsmp.net"] });
    const v = $("#view-minecraft");
    v.addEventListener("click", async e => {
      if (e.target.closest("[data-mc=play]")) {   // the big Play: straight into the modpack you played last
        const b = e.target.closest("[data-mc=play]"); b.disabled = true;
        const last = this.lastPack();
        try {
          if (last) { await sky.pages.mcLaunch(last.name); toast(`Starting “${last.title || last.name}”`); FX.sound("success"); D.minecraft.last = last.name; save("minecraft"); }
          else { const r = await sky.assistant.handle("open minecraft", { name: Settings.data.name }, { ai: false }); toast(r.reply.replace(/[“”]/g, "")); }
        } catch (er) { toast(clean(er), true); }
        setTimeout(() => b.disabled = false, 4000); return;
      }
      if (e.target.closest("[data-mc=refresh]")) return this.refresh(true);
      const del = e.target.closest("[data-srvdel]"); if (del) { D.minecraft.servers = D.minecraft.servers.filter(s => s !== del.dataset.srvdel); save("minecraft"); return this.render(); }
      const cp = e.target.closest("[data-srvcopy]"); if (cp) { navigator.clipboard.writeText(cp.dataset.srvcopy); toast("Server address copied: paste it in Minecraft › Multiplayer"); }
      const lk = e.target.closest("[data-mclink]"); if (lk) sky.openUrl(lk.dataset.mclink);
      const fo = e.target.closest("[data-mcfolder]"); if (fo) { e.stopPropagation(); return sky.pages.mcFolder(fo.dataset.mcfolder).catch(er => toast(clean(er), true)); }
      const pr = e.target.closest("[data-mcprof]"); if (pr && !pr.disabled) {
        const name = pr.dataset.mcprof; pr.disabled = true; pr.classList.add("going");
        try { await sky.pages.mcLaunch(name); toast(`Starting “${name}”: Minecraft is loading`); FX.sound("success"); D.minecraft.last = name; save("minecraft"); this.paintPlay(); }
        catch (er) { toast(clean(er), true); }
        setTimeout(() => { pr.disabled = false; pr.classList.remove("going"); }, 4000);
      }
    });
    $("#mcAdd").addEventListener("submit", e => { e.preventDefault(); const h = e.target.host.value.trim().toLowerCase(); if (!h) return;
      if (!D.minecraft.servers.includes(h)) D.minecraft.servers.push(h.slice(0, 80)); e.target.reset(); save("minecraft"); this.render(); this.check(h); });
  },
  async check(h) { this.status[h] = { loading: true }; this.render(); try { this.status[h] = await sky.pages.mcStatus(h); } catch (e) { this.status[h] = { error: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") }; } this.render(); },
  refresh(force) { for (const h of D.minecraft.servers) { const s = this.status[h]; if (force || !s || Date.now() - (s.at || 0) > 60e3) this.check(h); } },
  async show(on) {
    clearInterval(this.timer); if (!on || !D.minecraft) return;
    this.refresh(false); this.timer = setInterval(() => this.refresh(false), 60e3);
    const prof = this.prof = await sky.pages.mcProfiles().catch(() => []);
    this.paintPlay();
    $("#mcProfiles").innerHTML = prof.length ? prof.map(p => `<button class="mc-prof ${p.name === D.minecraft.last ? "last" : ""}" data-mcprof="${esc(p.name)}" title="Play ${esc(p.name)}"><span class="mc-pic">${p.icon ? `<img src="${p.icon}" alt="">` : icon("cube")}</span><span class="mc-pt"><b>${esc(p.title || p.name)}</b><small>${p.mods} mods${p.worlds ? ` · ${p.worlds} world${p.worlds > 1 ? "s" : ""}` : ""}${p.shaders ? ` · shaders` : ""}</small></span>
        <span class="mc-when">${p.played ? ago(p.played) : ""}</span><span class="ibtn xs" data-mcfolder="${esc(p.name)}" title="Open its folder (mods, worlds, screenshots)">${icon("folder")}</span><span class="mc-go">Play</span></button>`).join("")
      : `<div class="pg-empty">No Modrinth profiles found on this PC.</div>`;
  },
  lastPack() { const l = this.prof || []; return l.find(p => p.name === D.minecraft.last) || l[0] || null; },   // the list is newest-played first
  paintPlay() { const b = $("[data-mc=play]"), p = this.lastPack(); if (b) { b.innerHTML = p ? `Play <small>${esc(p.title || p.name)}</small>` : "Play"; b.title = p ? "Start " + (p.title || p.name) : "Open Minecraft"; } },
  render() {
    const d = D.minecraft; if (!d) return;
    $("#mcServers").innerHTML = d.servers.length ? d.servers.map(h => { const s = this.status[h] || {};
      return `<div class="mc-srv ${s.online ? "on" : s.online === false ? "off" : ""}">${s.icon ? `<img src="${s.icon}" alt="">` : `<span class="mc-sic">${icon("server")}</span>`}
        <span class="mc-st"><b>${esc(h)}</b><small>${s.loading ? "Checking…" : s.error ? esc(s.error) : s.online ? esc(s.motd || "Online") : s.online === false ? "Offline / not answering" : "…"}</small></span>
        <span class="mc-pl">${s.online && s.players ? `<i class="dot"></i>${s.players.online.toLocaleString()} / ${s.players.max.toLocaleString()}` : s.online === false ? `<i class="dot"></i>offline` : ""}${s.version ? `<small>${esc(s.version)}</small>` : ""}</span>
        <button class="ibtn xs" data-srvcopy="${esc(h)}" title="Copy address">⧉</button><button class="ibtn xs" data-srvdel="${esc(h)}" title="Remove">${icon("x")}</button></div>`; }).join("")
      : `<div class="pg-empty">Add a server to see if it's online and who's playing.</div>`;
  },
};

/* ================= AI ================= */
const AIPage = {
  async init() {
    await load("aichat", { msgs: [] });
    try { const p = localStorage.getItem("sky-brain"); if (p && p !== "auto") sky.ai.pref(p).catch(() => {}); } catch (e) {}   // the brain you picked last time
    // (the AI page is gone: Sky's brain and the Study Helper live in Settings → AI; Sky itself is the orb and the A key)
    $("#set-ai").addEventListener("click", e => {
      if (e.target.closest("[data-ai=memory]")) Assistant.openMemory();
      if (e.target.closest("[data-ai=signin]")) this.signIn();
      if (e.target.closest("[data-ai=gpt]")) this.gpt();
    });
  },
  async note(force) {
    const [st, b] = await Promise.all([sky.ai.status().catch(() => ({ configured: false })), sky.ai.brain(force).catch(() => ({}))]);
    const signIn = b.claudeInstalled && !b.claude ? ` <button class="btn xs" data-ai="signin">Sign in to Claude</button>` : "";
    const gpt = !b.chatgpt ? ` <button class="btn xs" data-ai="gpt" ${b.chatgptInstalling || this.gptBusy ? "disabled" : ""}>${b.chatgptInstalling || this.gptBusy ? "Setting up ChatGPT…" : "Connect ChatGPT"}</button>` : "";
    const ready = [b.claude && "claude", b.chatgpt && "chatgpt", b.ollama && "ollama"].filter(Boolean);
    const pick = ready.length > 1 && !st.configured ? ` <select class="ai-pick" data-ai="pref" title="Sky's brain"><option value="auto">Auto</option>${ready.map(r => `<option value="${r}" ${b.pref === r ? "selected" : ""}>${r === "claude" ? "Claude" : r === "chatgpt" ? "ChatGPT" : "AI on this PC"}</option>`).join("")}</select>` : "";
    $("#aiNote").innerHTML = st.configured ? `Thinking with Claude (your API key). Ask anything.`
      : b.which === "claude" ? `Thinking with your Claude account. Ask anything, no key needed.${pick}${gpt}`
      : b.which === "chatgpt" ? `Thinking with your ChatGPT account. Ask anything, no key needed.${pick}${signIn}`
      : b.which === "ollama" ? `Thinking with ${esc(b.ollama)}, an AI running on this PC. For smarter answers:${gpt}${signIn}${pick}`
      : `Commands work now (open a game, play a song, remember things). To really talk, give Sky a brain:${gpt}${signIn || ` <button class="btn xs" data-goto="settings:ai">Add a Claude key</button>`}`;
    const sel = $("#aiNote [data-ai=pref]"); if (sel) { sel.value = b.pref || "auto"; sel.onchange = async () => { await sky.ai.pref(sel.value); localStorage.setItem("sky-brain", sel.value); this.note(true); }; }
    return b;
  },
  // ChatGPT: download OpenAI's Codex if needed (about 160 MB, once), then you sign in with your ChatGPT account in the browser
  async gpt() {
    this.gptBusy = true; this.note(); toast("Setting up ChatGPT for Sky (a one-time download from OpenAI)…");
    try { await sky.ai.gpt(); } catch (e) { this.gptBusy = false; this.note(); return toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
    this.gptBusy = false;
    toast("Sign in with your ChatGPT account in the window that opened (it opens your browser). Sky switches over by itself.");
    clearInterval(this.poll); let n = 0;
    this.poll = setInterval(async () => { const b = await this.note(true); if (b.chatgpt || ++n > 40) { clearInterval(this.poll); if (b.chatgpt) toast("Connected. Sky is thinking with ChatGPT now"); } }, 6000);
  },
  async signIn() {
    try { await sky.ai.signIn(); } catch (e) { return toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
    toast("Sign in to Claude in the window that opened. Skyline switches over by itself.");
    clearInterval(this.poll); let n = 0;
    this.poll = setInterval(async () => { const b = await this.note(true); if (b.which === "claude" || ++n > 40) { clearInterval(this.poll); if (b.which === "claude") toast("Signed in. I'm thinking with Claude now"); } }, 6000);
  },
  async send(text) {
    const m = D.aichat.msgs; m.push({ who: "me", text, at: Date.now() }); m.push({ who: "ai", text: "", busy: true, at: Date.now() }); this.render();
    let r; try { r = await Assistant.converse(text); } catch (e) { r = { reply: String(e.message || e), chips: [] }; }
    const last = m[m.length - 1]; last.busy = false; last.text = r.reply; last.chips = r.chips || [];
    D.aichat.msgs = m.slice(-120); save("aichat"); this.render();
    if (r.needBrain) this.note(true);
  },
  async render() {
    const d = D.aichat; if (!d) return;
    this.note();
    const box = $("#aiMsgs");
    box.innerHTML = d.msgs.length ? d.msgs.map(m => `<div class="ai-m ${m.who}"><div class="ai-b">${m.busy ? `<span class="ai-dots"><i></i><i></i><i></i></span>` : esc(m.text).replace(/\n/g, "<br>")}</div>${(m.chips || []).length ? `<div class="ai-chips">${m.chips.map(c => `<span class="as-done">${c}</span>`).join("")}</div>` : ""}</div>`).join("")
      : `<div class="ai-hello"><div class="ai-orb"></div><h2>Hey${Settings.data.name ? " " + esc(Settings.data.name) : ""}, I'm Sky. What's up?</h2><p>Talk or type. I can open your games and apps, play music, set timers, add tasks, switch your background, remember things, and more.</p>
        <div class="ai-sug">${["Open Minecraft", "Play my liked songs", "What's the weather?", "Set a timer for 25 minutes", "Remember that I use Modrinth App for Minecraft", "Switch to Akihabara Overhead"].map(s => `<button class="as-chip" data-aiq="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
    box.scrollTop = box.scrollHeight;
  },
};

export const Pages = {
  async init() {
    if (!sky) return;
    await Promise.all([School.init(), Money.init(), YouTube.init(), Minecraft.init(), AIPage.init()]);
    const open = $(".view:not(.hidden)"); if (open) this.show(open.id.replace("view-", ""));   // a page opened while loading
  },
  show(v) {
    if (v === "school") School.show();
    if (v === "money") Money.render();
    if (v === "youtube") { YouTube.render(); YouTube.warm(); } else YouTube.cool();
    if (v === "minecraft") { Minecraft.render(); }
    Minecraft.show(v === "minecraft");
    if (v !== "youtube" && YouTube.playing) { /* keeps playing in the background, like a mini player */ }
  },
  addHomework(text, cls) { return School.addHomework(text, cls); },
  school: () => School.brief(),
  aiNote: () => AIPage.note(),
};
