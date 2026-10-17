// Background work for the side-bar pages: YouTube search (no account or key), Minecraft server status and
// Modrinth profiles. The pages' own data (notes, school, money...) is saved through the normal store.
const fs = require("fs");
const path = require("path");
const { ipcMain, net, session, shell, app } = require("electron");

const BROWSER = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" };
const txt = r => (r && (r.simpleText || (r.runs || []).map(x => x.text).join(""))) || "";

// YouTube's results page carries its data as JSON (ytInitialData): read the videos out of it. The "Videos" filter
// keeps out Shorts and shelves, and each page ends with a token that fetches the next one (for endless scrolling).
const YT_PAGES = new Map();   // token -> { key, ver }
function ytItems(data, seen) {
  const out = []; let next = "";
  const add = v => { if (v.id && !seen.has(v.id)) { seen.add(v.id); out.push(v); } };
  const walk = o => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o.videoRenderer && o.videoRenderer.videoId) {
      const v = o.videoRenderer;
      add({ id: v.videoId, title: txt(v.title), channel: txt(v.ownerText || v.longBylineText), thumb: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        length: txt(v.lengthText), views: txt(v.shortViewCountText || v.viewCountText), age: txt(v.publishedTimeText), live: !v.lengthText });
      return;
    }
    // YouTube's newer layout (some people get it, as an experiment)
    if (o.lockupViewModel && o.lockupViewModel.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && o.lockupViewModel.contentId) {
      const l = o.lockupViewModel, md = (l.metadata || {}).lockupMetadataViewModel || {};
      const rows = (((md.metadata || {}).contentMetadataViewModel || {}).metadataRows || []).map(r => (r.metadataParts || []).map(p => (p.text || {}).content).filter(Boolean));
      const badge = JSON.stringify(l.contentImage || {}).match(/"thumbnailBadgeViewModel":\{[^}]*?"text":"([^"]+)"/);
      const flat = rows.flat(), live = !!badge && /live/i.test(badge[1]);
      add({ id: l.contentId, title: ((md.title || {}).content) || "", channel: (rows[0] || [])[0] || "", thumb: `https://i.ytimg.com/vi/${l.contentId}/hqdefault.jpg`,
        length: badge && !live ? badge[1] : "", views: flat.find(t => /views?|watching/i.test(t)) || "", age: flat.find(t => /ago$/i.test(t)) || "", live });
      return;
    }
    if (o.compactVideoRenderer && o.compactVideoRenderer.videoId) {
      const v = o.compactVideoRenderer;
      add({ id: v.videoId, title: txt(v.title), channel: txt(v.longBylineText || v.shortBylineText), thumb: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        length: txt(v.lengthText), views: txt(v.shortViewCountText || v.viewCountText), age: txt(v.publishedTimeText), live: !v.lengthText });
      return;
    }
    if (o.continuationItemRenderer) { const t = (((o.continuationItemRenderer.continuationEndpoint || {}).continuationCommand) || {}).token; if (t) next = t; return; }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return { items: out, next };
}
async function ytSearch(q) {
  q = String(q || "").trim().slice(0, 120); if (!q) return { items: [], more: "" };
  const r = await net.fetch(`https://www.youtube.com/results?${new URLSearchParams({ search_query: q, sp: "EgIQAQ%3D%3D", hl: "en", gl: "US" })}`, { headers: BROWSER });
  if (!r.ok) throw new Error("YouTube didn't answer (" + r.status + ")");
  const html = await r.text(), m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error("YouTube changed its page; search isn't available right now");
  const { items, next } = ytItems(JSON.parse(m[1]), new Set());
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1], ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
  if (next && key && ver) { YT_PAGES.set(next, { key, ver }); while (YT_PAGES.size > 200) YT_PAGES.delete(YT_PAGES.keys().next().value); }
  return { items, more: next && key && ver ? next : "" };
}
async function ytMore(token, have) {
  const p = YT_PAGES.get(token); if (!p) return { items: [], more: "" };
  const r = await net.fetch(`https://www.youtube.com/youtubei/v1/search?prettyPrint=false&key=${encodeURIComponent(p.key)}`, { method: "POST", headers: { ...BROWSER, "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: p.ver, hl: "en", gl: "US" } }, continuation: token }) });
  if (!r.ok) throw new Error("YouTube didn't answer (" + r.status + ")");
  const { items, next } = ytItems(await r.json(), new Set(Array.isArray(have) ? have : []));
  if (next) YT_PAGES.set(next, p);
  return { items, more: next || "" };
}

// recommended for you: YouTube's own "up next" picks for the videos you watched lately, mixed together (no account:
// it's built from what you watch in Skyline). Videos you've already seen are left out.
const YT_REL = new Map();   // video id -> { at, items }
async function ytRelatedOne(id) {
  const c = YT_REL.get(id); if (c && Date.now() - c.at < 30 * 60e3) return c.items;
  const r = await net.fetch(`https://www.youtube.com/watch?${new URLSearchParams({ v: id, hl: "en", gl: "US" })}`, { headers: BROWSER });
  if (!r.ok) throw new Error("YouTube didn't answer (" + r.status + ")");
  const m = (await r.text()).match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/); if (!m) return [];
  const data = JSON.parse(m[1]), sec = (((data.contents || {}).twoColumnWatchNextResults || {}).secondaryResults) || data;
  const items = ytItems(sec, new Set([id])).items.filter(v => !v.live).slice(0, 20);
  YT_REL.set(id, { at: Date.now(), items }); while (YT_REL.size > 50) YT_REL.delete(YT_REL.keys().next().value);
  return items;
}
async function ytRelated(ids, skip) {
  ids = (Array.isArray(ids) ? ids : []).filter(x => /^[A-Za-z0-9_-]{11}$/.test(x)).slice(0, 5);
  const seen = new Set(Array.isArray(skip) ? skip : []), lists = await Promise.all(ids.map(id => ytRelatedOne(id).catch(() => [])));
  const out = [];
  for (let i = 0; i < 20; i++) for (const l of lists) { const v = l[i]; if (v && !seen.has(v.id)) { seen.add(v.id); out.push(v); } }   // take turns, so no one video fills the page
  return out.slice(0, 48);
}

async function mcStatus(host) {
  host = String(host || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9.:-]/g, "").slice(0, 100); if (!host) throw new Error("Which server?");
  const r = await net.fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(host)}`, { headers: { "User-Agent": "Skyline/1.0 (desktop dashboard)" } });
  if (!r.ok) throw new Error("The status service didn't answer (" + r.status + ")");
  const j = await r.json();
  return { host, online: !!j.online, players: j.players ? { online: j.players.online || 0, max: j.players.max || 0 } : null, motd: j.motd ? (j.motd.clean || []).join(" ").slice(0, 160) : "",
    version: String(j.version || "").slice(0, 60), icon: /^data:image\/png;base64,/.test(j.icon || "") ? j.icon : "", at: Date.now() };
}

// Modrinth App keeps each profile (instance) in its own folder
const MC_ROOTS = () => [path.join(process.env.APPDATA || "", "ModrinthApp", "profiles"), path.join(process.env.APPDATA || "", "com.modrinth.theseus", "profiles")];
// The Modrinth App's own list (its app.db, read-only): each instance's real id (what its launch link needs, e.g.
// "local:8041…"), its display name, icon and when it was last played.
function mcDb() {
  const out = new Map();
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path.join(app.getPath("appData"), "ModrinthApp", "app.db"), { readOnly: true });
    try { for (const r of db.prepare("select id, path, name, icon_path, last_played, install_stage from instances").all()) out.set(r.path, r); } finally { db.close(); }
  } catch (e) { console.log("[minecraft] couldn't read the Modrinth App's list:", e.message); }
  return out;
}
const iconData = f => { try { const b = fs.readFileSync(f); return b.length < 400e3 ? `data:image/${/\.jpe?g$/i.test(f) ? "jpeg" : /\.webp$/i.test(f) ? "webp" : /\.gif$/i.test(f) ? "gif" : "png"};base64,${b.toString("base64")}` : ""; } catch (e) { return ""; } };
function mcProfiles() {
  const roots = MC_ROOTS(), known = mcDb();
  const out = [];
  for (const root of roots) {
    let dirs = []; try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch (e) { continue; }
    for (const d of dirs) {
      const p = path.join(root, d.name), count = sub => { try { return fs.readdirSync(path.join(p, sub)).filter(f => /\.(jar|zip)$/i.test(f)).length; } catch (e) { return 0; } };
      // when it was last played: the game rewrites its log every launch
      let mtime = 0; for (const f of ["logs/latest.log", "options.txt", "."]) { try { mtime = fs.statSync(path.join(p, f)).mtimeMs; break; } catch (e) {} }
      const k = known.get(d.name) || {};
      if (k.install_stage && k.install_stage !== "installed") continue;   // still installing, or broken
      out.push({ name: d.name, title: k.name || d.name, id: k.id || "", icon: k.icon_path ? iconData(k.icon_path) : "", mods: count("mods"), packs: count("resourcepacks"), shaders: count("shaderpacks"),
        worlds: (() => { try { return fs.readdirSync(path.join(p, "saves")).length; } catch (e) { return 0; } })(), played: k.last_played ? Math.max(k.last_played * 1000, 0) : mtime });
    }
  }
  return out.sort((a, b) => b.played - a.played).slice(0, 30);
}
// only profiles that really exist on this PC can be launched or shown
function mcProfileDir(name) {
  name = String(name || "");
  for (const root of MC_ROOTS()) { const p = path.join(root, name); if (name && !/[\\/]|\.\./.test(name) && fs.existsSync(p)) return p; }
  throw new Error("That profile isn't in the Modrinth App any more");
}
// the Modrinth App's own "launch this instance" link (what its desktop shortcuts use); it signs in and starts the game
async function mcLaunch(name, server) {
  mcProfileDir(name);
  const id = (mcDb().get(name) || {}).id || name;   // newer Modrinth Apps know instances by id, older ones by folder
  const url = `modrinth://launch/instance/${encodeURIComponent(id)}` + (server ? "?" + new URLSearchParams({ server: String(server).slice(0, 100) }) : "");
  await shell.openExternal(url);
  return true;
}

function install() {
  ipcMain.handle("yt:search", (e, q) => ytSearch(q));
  ipcMain.handle("yt:more", (e, token, have) => ytMore(String(token || ""), have));
  ipcMain.handle("yt:related", (e, ids, skip) => ytRelated(ids, skip));
  ipcMain.handle("mc:status", (e, host) => mcStatus(host));
  ipcMain.handle("mc:profiles", () => mcProfiles());
  ipcMain.handle("mc:launch", (e, name, server) => mcLaunch(name, server));
  ipcMain.handle("mc:folder", async (e, name) => { await shell.openPath(mcProfileDir(name)); return true; });
  // YouTube's player refuses to play without a proper web address asking for it; Skyline's pages live at sky://,
  // so its embedded player requests say they come from Skyline's own https identity.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["https://www.youtube-nocookie.com/*", "https://www.youtube.com/embed/*"] }, (d, cb) => {
    const h = d.requestHeaders; if (!h.Referer || /^sky:/i.test(h.Referer)) h.Referer = "https://skyline.app/"; cb({ requestHeaders: h });
  });
}

module.exports = { install, ytSearch };
