// How quick links open: in the app when it's installed on this PC (Discord, Spotify, Steam...), otherwise in Chrome
// on the Google account you're using (the Chrome profile you used last), or in a profile / browser you picked.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ipcMain, shell } = require("electron");

const env = k => process.env[k] || "";
const exists = f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; } };

// sites that have a desktop app, and how to open the same place in it
const APPS = [
  { name: "Discord", hosts: /(^|\.)discord(app)?\.com$/, exe: () => path.join(env("LOCALAPPDATA"), "Discord", "Update.exe"),
    open: u => { const p = new URL(u).pathname; return "discord://-" + (/^\/(channels|invite)\//.test(p) ? p : "/"); } },
  { name: "Spotify", hosts: /(^|\.)spotify\.com$/, exe: () => path.join(env("APPDATA"), "Spotify", "Spotify.exe"),
    open: u => { const m = new URL(u).pathname.match(/^\/(?:intl-[a-z]+\/)?(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)/); return m ? `spotify:${m[1]}:${m[2]}` : "spotify:"; } },
  { name: "Steam", hosts: /(^|\.)(steampowered|steamcommunity)\.com$/, exe: () => [path.join(env("ProgramFiles(x86)"), "Steam", "steam.exe"), path.join(env("ProgramFiles"), "Steam", "steam.exe")].find(exists),
    open: u => "steam://openurl/" + u },
  { name: "Roblox", hosts: /(^|\.)roblox\.com$/, exe: () => { const d = path.join(env("LOCALAPPDATA"), "Roblox", "Versions"); try { return fs.readdirSync(d).map(v => path.join(d, v, "RobloxPlayerBeta.exe")).find(exists); } catch (e) { return null; } },
    open: () => "roblox://" },
  { name: "Epic Games", hosts: /(^|\.)(epicgames|fortnite)\.com$/, exe: () => [path.join(env("ProgramFiles(x86)"), "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe"), path.join(env("ProgramFiles"), "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe")].find(exists),
    open: () => "com.epicgames.launcher://store" },
  { name: "Modrinth App", hosts: /(^|\.)modrinth\.com$/, exe: () => path.join(env("LOCALAPPDATA"), "Modrinth App", "Modrinth App.exe"), open: u => null },
];

// Chrome and its profiles (each one a Google account)
function chrome() {
  const exe = [path.join(env("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"), path.join(env("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
    path.join(env("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe")].find(exists);
  if (!exe) return null;
  let st = {}; try { st = JSON.parse(fs.readFileSync(path.join(env("LOCALAPPDATA"), "Google", "Chrome", "User Data", "Local State"), "utf8")).profile || {}; } catch (e) {}
  const profiles = Object.entries(st.info_cache || {}).map(([dir, v]) => ({ dir, name: v.name || dir, account: v.user_name || "", hosted: v.hosted_domain && v.hosted_domain !== "NO_HOSTED_DOMAIN" ? v.hosted_domain : "", active: v.active_time || 0 })).sort((a, b) => b.active - a.active);
  return { exe, profiles, last: st.last_used || (profiles[0] || {}).dir || "Default" };
}

class Links {
  constructor({ getSettings, assistant }) { this.getSettings = getSettings; this.assistant = assistant; }
  // the installed app for this link, if there is one
  appFor(url, name) {
    const h = host(url);
    for (const a of APPS) if (a.hosts.test(h)) { const exe = a.exe(); if (exe && exists(exe)) return { ...a, exePath: exe }; }
    // any other app with the link's exact name (installed apps Skyline knows about, e.g. from the Start menu)
    const label = String(name || "").trim();
    if (label && this.assistant && this.assistant.apps && this.assistant.apps.length) {
      const t = this.assistant.find(label, { kinds: ["app"] });
      if (t && t.score >= .95 && !/chrome|edge|firefox|opera|brave|browser/i.test(t.name)) return { name: t.name, target: t };
    }
    return null;
  }
  async open(url, name) {
    url = String(url || ""); if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error("That isn't a web address");
    const app = this.appFor(url, name), s = this.getSettings() || {};
    if (app && s.linksApps !== false) {
      if (app.target) { await this.assistant.launch(app.target); return { how: "app", name: app.name }; }
      const link = app.open(url);
      if (link) { await shell.openExternal(link); return { how: "app", name: app.name }; }
      const p = spawn(app.exePath, [], { detached: true, stdio: "ignore", windowsHide: false }); p.on("error", () => {}); p.unref();
      return { how: "app", name: app.name };
    }
    const want = s.linksBrowser || "chrome-last";
    const c = want === "default" ? null : chrome();
    if (c) {
      const dir = want.startsWith("chrome:") && c.profiles.some(p => p.dir === want.slice(7)) ? want.slice(7) : c.last;
      const p = spawn(c.exe, [`--profile-directory=${dir}`, url], { detached: true, stdio: "ignore" }); p.on("error", () => shell.openExternal(url)); p.unref();
      return { how: "chrome", profile: (c.profiles.find(p => p.dir === dir) || {}).name || dir };
    }
    await shell.openExternal(url);
    return { how: "browser" };
  }
  install() {
    ipcMain.handle("links:open", (e, url, name) => this.open(url, name));
    ipcMain.handle("links:apps", (e, list) => (Array.isArray(list) ? list : []).slice(0, 60).map(l => { const a = this.appFor(String(l.url || ""), l.name); return a ? a.name : ""; }));
    ipcMain.handle("links:browsers", () => { const c = chrome(); return c ? { chrome: true, last: c.last, profiles: c.profiles.map(({ dir, name, account }) => ({ dir, name, account })) } : { chrome: false, profiles: [] }; });
  }
}

module.exports = { Links, chrome };
