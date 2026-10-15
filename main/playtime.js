// Game time: how long you actually play each game (today, this week). A game counts only while its window is the one
// in front (Skyline's helper reports that every second or so), so a game left open in the background doesn't add up.
// Games are recognised by their program: well-known ones by name, anything in your Steam or Epic games folders,
// the programs behind the shortcuts in your library, and Minecraft by the modpack it was started from.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { ipcMain, shell } = require("electron");

const TICK = 60e3;
const KNOWN = {
  "fortniteclient-win64-shipping.exe": "Fortnite", "robloxplayerbeta.exe": "Roblox", "robloxstudiobeta.exe": "Roblox Studio",
  "valorant-win64-shipping.exe": "VALORANT", "minecraft.windows.exe": "Minecraft", "among us.exe": "Among Us", "subnauticazero.exe": "Subnautica: Below Zero",
  "subnautica.exe": "Subnautica", "rocketleague.exe": "Rocket League", "cs2.exe": "Counter-Strike 2", "geometrydash.exe": "Geometry Dash",
  "r5apex.exe": "Apex Legends", "overwatch.exe": "Overwatch 2", "gta5.exe": "GTA V", "gta5_enhanced.exe": "GTA V", "eldenring.exe": "Elden Ring",
  "terraria.exe": "Terraria", "stardew valley.exe": "Stardew Valley", "cemu.exe": "Cemu (Wii U)", "ryujinx.exe": "Ryujinx (Switch)", "bloonstd6.exe": "Bloons TD 6",
  "leagueoflegends.exe": "League of Legends", "league of legends.exe": "League of Legends", "deadlock.exe": "Deadlock", "marvel-win64-shipping.exe": "Marvel Rivals",
};
// launchers and tools: open doesn't mean playing
const NOT_GAMES = /^(wallpaper32|wallpaper64|webwallpaper32|ui32|lossless scaling|losslessscaling|soundpad|steamvr.*|vrserver|vrmonitor|vrcompositor|steam|steamwebhelper|epicgameslauncher|epicwebhelper|riotclientservices|riotclientux|minecraftlauncher|modrinth app|battle\.net|ea ?desktop|eadesktop|origin|galaxyclient|crashpad_handler|unitycrashhandler64|easyanticheat.*|beservice|vgtray|ubisoftconnect|upc)\.exe$/i;

// apps and tools that live in the Steam games folder
const STEAM_TOOLS = /^(wallpaper_engine|wallpaper engine|steamworks shared|steamvr|steam controller configs|lossless scaling|soundpad|spacewar|proton.*|steam linux runtime.*|common redistributables)$/i;
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const titleCase = s => String(s).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();

class Playtime {
  constructor(dataDir, games, media) {
    this.file = path.join(dataDir, "playtime.json"); this.games = games; this.data = this.read(); this.now = []; this.shortcuts = null;
    // seconds each program spent in front since the last tick
    this.fgSecs = new Map(); this.fg = null;
    if (media) media.on("fg", pid => this.front(pid));
  }
  front(pid, t = Date.now()) {
    if (this.fg) this.fgSecs.set(this.fg.pid, (this.fgSecs.get(this.fg.pid) || 0) + (t - this.fg.since) / 1000);
    this.fg = { pid, since: t };
  }
  read() { try { const d = JSON.parse(fs.readFileSync(this.file, "utf8")); return d && d.days ? d : { days: {} }; } catch (e) { return { days: {} }; } }
  save() { const tmp = this.file + ".tmp"; try { fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); } catch (e) {} }

  // program file -> library game name, from the shortcuts in your library (looked up once, refreshed hourly)
  libraryPrograms() {
    if (this.shortcuts && Date.now() - this.shortcuts.at < 3600e3) return this.shortcuts.map;
    const map = {};
    for (const g of (this.games && this.games.lib()) || []) {
      if (!g.path || !/\.lnk$/i.test(g.path)) continue;
      try { const t = shell.readShortcutLink(g.path).target; if (t && /\.exe$/i.test(t)) { const b = path.basename(t).toLowerCase(); if (!NOT_GAMES.test(b)) map[b] = g.name; } } catch (e) {}
    }
    this.shortcuts = { at: Date.now(), map };
    return map;
  }
  async processes() {
    const parse = l => { const [name, exe, pid, cmd] = l.split("\t"); return { name: (name || "").toLowerCase(), exe: exe || "", pid: +pid || 0, cmd: cmd || "" }; };
    const fromHelper = this.media && this.media.procs ? await this.media.procs().catch(() => null) : null;
    if (fromHelper && fromHelper.length) return fromHelper.filter(Boolean).map(parse);
    return new Promise(res => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { $_.Name + [char]9 + $_.ExecutablePath + [char]9 + $_.ProcessId + [char]9 + $(if ($_.Name -match '^javaw?\\.exe$') { $_.CommandLine } else { '' }) }"],
      { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => res(e ? [] : String(out).split(/\r?\n/).filter(Boolean).map(l => { const [name, exe, pid, cmd] = l.split("\t"); return { name: (name || "").toLowerCase(), exe: exe || "", pid: +pid || 0, cmd: cmd || "" }; }))));
  }
  // which games are running right now
  detect(procs) { return [...this.detectPids(procs).keys()]; }
  detectPids(procs) {
    const lib = this.libraryPrograms(), found = new Map();
    const add = (name, p) => { if (!found.has(name)) found.set(name, new Set()); found.get(name).add(p.pid); };
    for (const p of procs) {
      if (!p.name || NOT_GAMES.test(p.name)) continue;
      if (/^javaw?\.exe$/.test(p.name)) {   // Minecraft (Java): which Modrinth modpack, if any
        if (!/net\.minecraft|minecraft\.client|\.minecraft|modrinth/i.test(p.cmd)) continue;
        const pack = p.cmd.match(/ModrinthApp[\\/]+profiles[\\/]+([^\\/"]+)/i) || p.cmd.match(/--gameDir\s+"?[^"]*[\\/]profiles[\\/]+([^\\/"]+)/i);
        add(pack ? `Minecraft · ${pack[1]}` : "Minecraft", p); continue;
      }
      if (KNOWN[p.name]) { add(KNOWN[p.name], p); continue; }
      if (lib[p.name]) { add(lib[p.name], p); continue; }
      const steam = p.exe.match(/[\\/]steamapps[\\/]common[\\/]([^\\/]+)[\\/]/i); if (steam && !STEAM_TOOLS.test(steam[1])) { add(titleCase(steam[1]), p); continue; }
      const epic = p.exe.match(/[\\/]Epic Games[\\/]([^\\/]+)[\\/]/i); if (epic && !/launcher|directx|unreal|online services|epic online/i.test(epic[1])) { add(titleCase(epic[1]), p); continue; }
    }
    // one Minecraft: a modpack's name wins over plain "Minecraft" (its helper processes look like Minecraft too)
    if ([...found.keys()].some(k => k.startsWith("Minecraft · ")) && found.has("Minecraft")) { const extra = found.get("Minecraft"); found.delete("Minecraft"); const k = [...found.keys()].find(k => k.startsWith("Minecraft · ")); for (const id of extra) found.get(k).add(id); }
    return found;
  }
  async tick() {
    const games = this.detectPids(await this.processes()), t = Date.now();
    this.front(this.fg ? this.fg.pid : 0, t);   // close the current stretch in front
    const secs = this.fgSecs; this.fgSecs = new Map();
    this.now = [...games.keys()];
    if (!games.size) return;
    const credit = {};
    for (const [name, pids] of games) {
      // without the helper (it never said what's in front), fall back to counting the minute the game was open
      const s = this.fg && this.fg.pid !== undefined && this.fgKnown() ? [...pids].reduce((a, id) => a + (secs.get(id) || 0), 0) : TICK / 1000;
      if (s >= 1) credit[name] = Math.min(s, TICK / 1000 * 1.5);
    }
    this.playing = Object.keys(credit);
    if (!this.playing.length) return;
    const d = this.data.days[dayKey()] = this.data.days[dayKey()] || {};
    for (const [g, s] of Object.entries(credit)) d[g] = Math.round((d[g] || 0) + s);
    const keep = Object.keys(this.data.days).sort().slice(-120); for (const k of Object.keys(this.data.days)) if (!keep.includes(k)) delete this.data.days[k];   // ~4 months
    this.save();
  }
  fgKnown() { return this.fgSeen || (this.fgSeen = !!(this.fg && this.fg.pid)); }
  stats() {
    const today = dayKey(), week = [], perWeek = {}, perToday = this.data.days[today] || {};
    for (let i = 6; i >= 0; i--) { const k = dayKey(Date.now() - i * 864e5), d = this.data.days[k] || {}; week.push({ day: k, mins: Math.round(Object.values(d).reduce((a, b) => a + b, 0) / 60) });
      for (const [g, s] of Object.entries(d)) perWeek[g] = (perWeek[g] || 0) + s; }
    const list = o => Object.entries(o).map(([name, s]) => ({ name, mins: Math.round(s / 60) })).filter(x => x.mins > 0).sort((a, b) => b.mins - a.mins);
    return { now: this.now, today: list(perToday), week: list(perWeek), days: week };
  }
  install(testing) {
    ipcMain.handle("playtime:stats", () => this.stats());
    ipcMain.handle("playtime:scan", async () => { const p = await this.processes(); return { running: this.detect(p), processes: p.length }; });
    if (testing) return;
    setTimeout(() => this.tick().catch(() => {}), 15e3);
    setInterval(() => this.tick().catch(() => {}), TICK);
  }
}

module.exports = { Playtime, dayKey };
