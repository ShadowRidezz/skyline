// Skyline's assistant: listens (Windows' offline speech recognizer, voice.ps1), understands, and acts.
// Everyday commands ("open Minecraft", "pause", "next song", "play Blinding Lights") are understood
// right here, instantly and offline. Anything else goes to Claude: with an API key if there is one, otherwise
// the Claude account signed in on this PC or an AI model running in Ollama (brain.js), like Jarvis.
// Memory: things you tell it to remember, e.g. "I use Modrinth App for Minecraft" -> "open Minecraft"
// opens Modrinth App.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { spawn, execFile } = require("child_process");
const { ipcMain, shell } = require("electron");
const Anthropic = require("@anthropic-ai/sdk");
const AnthropicClient = Anthropic.default || Anthropic;
const { gameName } = require("./art");
const { Brain, parsePlan } = require("./brain");

const MODELS = { "claude-opus-5-5": "Claude Opus 5.5 · smartest (recommended)", "claude-sonnet-5-5": "Claude Sonnet 5.5 · balanced", "claude-haiku-5-5": "Claude Haiku 5.5 · fastest replies" };
const norm = s => String(s || "").toLowerCase().replace(/[™®©]/g, "").replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const cap = s => String(s || "").replace(/^./, c => c.toUpperCase());
// "I use Modrinth" -> "you use Modrinth", for reading memories back
const toYou = t => String(t || "").replace(/\b(I am|I'm)\b/g, "you're").replace(/\bI\b/g, "you").replace(/\b[Mm]y\b/g, "your").replace(/\b[Mm]ine\b/g, "yours").replace(/\bme\b/g, "you")
  .replace(/^(Their|The user's|User's) /i, "your ").replace(/^(They|The user) /i, "you ");
const SITES = { youtube: "https://www.youtube.com", "youtube music": "https://music.youtube.com", google: "https://www.google.com", gmail: "https://mail.google.com",
  netflix: "https://www.netflix.com", twitch: "https://www.twitch.tv", reddit: "https://www.reddit.com", twitter: "https://x.com", x: "https://x.com",
  github: "https://github.com", instagram: "https://www.instagram.com", tiktok: "https://www.tiktok.com", amazon: "https://www.amazon.com",
  "google maps": "https://maps.google.com", maps: "https://maps.google.com", chatgpt: "https://chatgpt.com", claude: "https://claude.ai", wikipedia: "https://www.wikipedia.org",
  "disney plus": "https://www.disneyplus.com", hulu: "https://www.hulu.com", "prime video": "https://www.primevideo.com", outlook: "https://outlook.live.com",
  "google drive": "https://drive.google.com", "google docs": "https://docs.google.com", facebook: "https://www.facebook.com", pinterest: "https://www.pinterest.com", kick: "https://kick.com" };
const PAGES = { home: "home", music: "music", "the music": "music", lyrics: "music", games: "games", "my games": "games", "game builder": "games",
  settings: "settings", "theme studio": "settings:appearance", themes: "settings:appearance", "the settings": "settings", memory: "settings:assistant", "your memory": "settings:assistant",
  school: "school", homework: "school", "my homework": "school", money: "money", "my money": "money", budget: "money", "my budget": "money",
  "savings goals": "money", "ai settings": "settings:ai", "social": "social", "friends": "social", "messages": "social" };
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, "twenty five": 25, thirty: 30, forty: 40, "forty five": 45, fifty: 50, sixty: 60, ninety: 90, hundred: 100, "a hundred": 100 };
const num = s => { s = norm(s); if (/^\d+$/.test(s)) return +s; return NUM[s] ?? (NUM[s.replace(/^an? /, "")] ?? null); };

function lev(a, b) {   // edit distance, for names Windows heard slightly wrong
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
// How well does what was said match a name? 0..1
function score(said, name) {
  const a = norm(said), full = norm(name), b = norm(gameName(name));
  if (!a || !b) return 0;
  if (a === full || a === b) return 1;
  const squash = s => s.replace(/ /g, "");
  if (squash(a) === squash(b) || squash(a) === squash(full)) return .97;
  if (full.startsWith(a + " ") || b.startsWith(a + " ")) return .9 - Math.min(.2, (full.length - a.length) / 80);
  if (a.startsWith(b + " ") && b.length > 3) return .82;
  const ta = a.split(" "), tb = full.split(" "), hit = ta.filter(t => tb.includes(t)).length;
  const jac = hit / new Set([...ta, ...tb]).size;
  const sim = 1 - lev(squash(a), squash(b)) / Math.max(squash(a).length, squash(b).length);
  return Math.max(jac * .85, sim > .74 ? sim * .9 : 0);
}

// How Skyline talks: a chill late-night friend. Every reply comes from here, a little different each time.
const LINES = {
  open: ["Firing up {x}. Have fun out there.", "{x}, coming right up.", "Opening {x} for you.", "On it. {x}'s loading.", "There you go, {x} is starting up.", "{x}. Enjoy."],
  openMem: ["Firing up {x}, your {say} setup.", "{x} it is, your go-to for {say}.", "Opening {x}, just how you like it.", "Got you. {x}, for {say}."],
  openFail: ["Hmm, {x} wouldn't open. {err}", "{x} didn't want to start. {err}"],
  pause: ["Paused.", "Got it, putting that on hold.", "Pausing it for you.", "Music's on pause."],
  play: ["And we're back.", "Resuming.", "Back to the vibes."],
  next: ["Skipping this one.", "Next track.", "On to the next one.", "Not feeling it? Skipped."],
  prev: ["Running it back.", "Going back one.", "Back to the last one."],
  shuffle: ["Shuffle's on. Let's see what comes up.", "Shuffling things up."],
  louder: ["Turning it up.", "A little louder.", "Cranking it up a notch."],
  quieter: ["Bringing it down a bit.", "Turning it down.", "A little quieter."],
  mute: ["Muted.", "Shh. Muted."], unmute: ["Sound's back.", "And we're loud again."],
  vol: ["Volume at {x} percent.", "Set it to {x} percent."],
  nowPlaying: ["This is {x}.", "You're listening to {x}.", "That's {x}. Good one."],
  nothing: ["Nothing's playing right now. Want me to put something on?", "It's quiet right now. Say play my songs, or name a track."],
  time: ["It's {x}.", "{x} right now."],
  timeLate: ["It's {x}. Late one tonight, huh?", "{x}. The city's still up, and so are you.", "It's {x}. Don't stay up too late."],
  date: ["It's {x}.", "Today's {x}."],
  weather: ["Right now it's {x}", "Looks like {x}"],
  noCity: ["I don't know where you are yet. Pick your city in Settings and I'll keep an eye on the sky for you."],
  page: ["Here's {x}.", "Pulling up {x}."], home: ["Home sweet home.", "Back home."],
  ambientOn: ["Ambient mode. Just you and the city.", "Lights down. Enjoy the view."], ambientOff: ["Back to it.", "Okay, lights back up."],
  theme: ["Switching to {x}. Beautiful choice.", "{x}. Love this one.", "Taking you to {x}."], themeRandom: ["How about {x}?", "Let's try {x} tonight."],
  timer: ["Focus timer set for {x}. You've got this.", "{x} on the clock. Go get it.", "Timer's running, {x}. Lock in."],
  timerStart: ["Focus timer's running. Lock in.", "Timer started. You've got this."], timerStop: ["Timer stopped.", "Okay, timer's off."],
  task: ["Added {x} to your list.", "Got it, {x} is on your list.", "Noted. {x}."],
  search: ["Looking up {x}.", "Searching for {x}."],
  mySongs: ["Putting on your music. Enjoy.", "Your songs, coming up.", "Here's your music."],
  song: ["Playing {x}. Good pick.", "{x}, coming up.", "Here's {x}."], artist: ["Playing some {x}.", "Here's some {x} for you."],
  notInSongs: ["I couldn't find {x} in your songs. You can add it on the Music page."],
  spotify: ["Playing {x} on Spotify. Good pick.", "{x}, on Spotify. Enjoy.", "Here's {x} on Spotify."], spotifyOpen: ["Opening {x} in Spotify for you."],
  spotifySearch: ["Searching Spotify for {x}."], youtube: ["Pulling up {x} on YouTube.", "Playing {x} on YouTube."],
  site: ["Opening {x}.", "Pulling up {x}."],
  linked: ["Got it. From now on, {say} means {x}.", "Noted. When you say {say}, I'll open {x}.", "Done. {say} means {x} from now on."],
  remembered: ["Got it, I'll remember that.", "Noted. I won't forget.", "Okay, I'll keep that in mind."],
  forgot: ["Done. Forgotten.", "Gone. I've let that go."], noMemory: ["I don't have anything about {x}."],
  memories: ["Here's what I remember: {x}.", "What I know so far: {x}."], noMemories: ["Nothing yet. Tell me to remember something and I'll keep it."],
  okay: ["Okay.", "No worries.", "All good."],
  unknown: ["Hmm, I'm not sure how to do that one yet. Ask me to open a game, play a song, or remember something.", "That one's beyond me for now. I can open your games, play music, or remember things for you."],
  noHear: ["I didn't catch anything. Try again?"],
};
let lastLine = {};
function vibe(key, vars = {}, ctx = {}) {
  const hour = new Date().getHours(), set = LINES[key === "time" && (hour >= 23 || hour < 5) ? "timeLate" : key] || [key];
  let pick = set[(Math.random() * set.length) | 0]; if (set.length > 1 && pick === lastLine[key]) pick = set[(set.indexOf(pick) + 1) % set.length];
  lastLine[key] = pick;
  let s = pick.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? String(vars[k]) : "");
  // now and then, use their name, like a friend would
  const name = String(ctx.name || "").trim();
  if (name && Math.random() < .28 && !/\{x\}\?$/.test(pick)) { const m2 = s.match(/^(.{4,46}?)([.!?])(\s|$)/); if (m2) s = `${m2[1]}, ${name}${m2[2]}${s.slice(m2[0].length - m2[3].length)}`; }
  return s.replace(/\s+/g, " ").replace(/\s([.,!?])/g, "$1").trim();
}

class Assistant {
  constructor(dataDir, { games, songs, spotify, ai, media, getWin }) {
    this.dir = dataDir; this.games = games; this.songs = songs; this.spotify = spotify; this.ai = ai; this.media = media; this.getWin = getWin;
    this.memFile = path.join(dataDir, "memory.json");
    this.apps = []; this.appsAt = 0; this.voice = null; this.voiceReady = false; this.wake = false; this.history = [];
    this.brain = new Brain();
    this.brain.gpt = new (require("./chatgpt").ChatGPT)(dataDir);   // ChatGPT, signed in with your account (no key)
  }

  /* ---------- memory ---------- */
  memory() { try { return JSON.parse(fs.readFileSync(this.memFile, "utf8")); } catch (e) { return []; } }
  saveMemory(m) { fs.writeFileSync(this.memFile, JSON.stringify(m.slice(-300), null, 1), "utf8"); this.pushNames(); return m; }
  remember({ text, say, target }) {
    text = String(text || "").trim().slice(0, 400); if (!text && !say) throw new Error("Nothing to remember");
    const m = this.memory();
    const item = { id: "m" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex"), text: text || `When I say “${say}”, open ${target && target.name}`, at: Date.now() };
    if (say && target && target.name) { item.say = String(say).slice(0, 80); item.target = { kind: target.kind, id: target.id, name: String(target.name).slice(0, 120) };
      for (let i = m.length - 1; i >= 0; i--) if (m[i].say && norm(m[i].say) === norm(say)) m.splice(i, 1); }   // the newest link for a phrase wins
    m.push(item); this.saveMemory(m); return item;
  }
  forget(id) { this.saveMemory(this.memory().filter(x => x.id !== id)); return true; }
  updateMemory(id, patch) {
    const m = this.memory(), it = m.find(x => x.id === id); if (!it) return null;
    if (patch.text != null) it.text = String(patch.text).slice(0, 400);
    if (patch.say !== undefined) { if (patch.say && patch.target) { it.say = String(patch.say).slice(0, 80); it.target = patch.target; } else { delete it.say; delete it.target; } }
    this.saveMemory(m); return it;
  }

  /* ---------- everything that can be opened ---------- */
  async loadApps(force) {
    if (!force && this.apps.length && Date.now() - this.appsAt < 10 * 60e3) return this.apps;
    if (this.appsJob) return this.appsJob;
    this.appsJob = new Promise(res => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"],
        { windowsHide: true, maxBuffer: 8e6, timeout: 20000 }, (err, out) => {
          let list = []; try { list = [].concat(JSON.parse(out)); } catch (e) {}
          const skip = /^(uninstall|readme|help|license|release notes|website|documentation|support)|uninstall/i;
          this.apps = list.filter(a => a && a.Name && a.AppID && !skip.test(a.Name) && !/^https?:/i.test(a.AppID)).map(a => ({ kind: "app", id: a.AppID, name: a.Name.replace(/\s*\(\d+\)$/, "") }));
          const seen = new Set(); this.apps = this.apps.filter(a => { const k = norm(a.name); if (seen.has(k)) return false; seen.add(k); return true; });
          this.appsAt = Date.now(); this.appsJob = null; this.pushNames(); res(this.apps);
        });
    });
    return this.appsJob;
  }
  targets() {
    const lib = this.games.lib().filter(x => x.kind !== "web" || x.url).map(x => ({ kind: "game", id: x.id, name: x.name, source: x.source }));
    return [...lib, ...this.apps];
  }
  find(said, { kinds } = {}) {   // -> best target or null
    let best = null, bs = 0;
    for (const t of this.targets()) {
      if (kinds && !kinds.includes(t.kind)) continue;
      let s = score(said, t.name);
      if (t.kind === "game") s += .04;   // your library first
      if (/launcher|installer|setup|updater|\bhelp\b|support center|uninstall/i.test(t.name) && !/launcher/.test(norm(said))) s -= .03;
      if (s > bs) { bs = s; best = t; }
    }
    return bs >= .62 ? { ...best, score: bs } : null;
  }
  fromMemory(said) {
    const m = this.memory().filter(x => x.say && x.target);
    let best = null, bs = 0;
    for (const x of m) { const s = score(said, x.say); if (s > bs) { bs = s; best = x; } }
    return bs >= .8 ? best : null;
  }
  async launch(t) {
    if (this.dry) { console.log("[assistant] would open", t.kind, t.name || t.id); return; }
    if (t.kind === "game") { const it = this.games.lib().find(x => x.id === t.id); if (it && it.kind === "web") { await shell.openExternal(it.url); return; } await this.games.launch(t.id); return; }
    if (t.kind === "url") { if (!/^https?:\/\//i.test(t.id)) throw new Error("Bad address"); await shell.openExternal(t.id); return; }
    if (t.kind === "app") {
      if (/^[a-z]:\\/i.test(t.id) && /\.exe$/i.test(t.id) && fs.existsSync(t.id)) { const e = await shell.openPath(t.id); if (e) throw new Error(e); return; }
      const p = spawn("explorer.exe", ["shell:AppsFolder\\" + t.id], { detached: true, stdio: "ignore", windowsHide: true }); p.on("error", () => {}); p.unref(); return;
    }
    throw new Error("I don't know how to open that");
  }

  /* ---------- the ears ---------- */
  startVoice() {
    if (this.voice || process.platform !== "win32") return;
    const src = fs.readFileSync(path.join(__dirname, "voice.ps1"), "utf8"), file = path.join(this.dir, "voice.ps1");
    try { if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== src) fs.writeFileSync(file, src, "utf8"); } catch (e) {}
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.voice = p; this.voiceReady = false;
    p.stdin.on("error", () => {}); p.on("error", e => this.emit({ t: "error", fatal: true, msg: "Couldn't start listening: " + e.message }));
    readline.createInterface({ input: p.stdout }).on("line", line => {
      let m; try { m = JSON.parse(line); } catch (e) { return; }
      if (m.t === "ready") { this.voiceReady = true; this.pushNames(); if (this.wake) this.send("wake 1"); if (this.queued) { const q = this.queued; this.queued = null; this.send(q); } }
      this.emit(m);
    });
    p.on("exit", () => { if (this.voice === p) { this.voice = null; this.voiceReady = false; } });
  }
  send(cmd) { if (!this.voice) this.startVoice(); if (!this.voiceReady) { if (cmd !== "names" && !cmd.startsWith("names ")) this.queued = cmd; return; } try { this.voice.stdin.write(cmd + "\n"); } catch (e) {} }
  emit(m) { const w = this.getWin(); if (w && !w.isDestroyed()) w.webContents.send("asst:voice", m); }
  pushNames() {
    if (!this.voice || !this.voiceReady) return;
    const names = new Set();
    for (const t of this.targets()) { const n = t.name.replace(/[^\w '&.:+-]/g, "").trim(); if (n) { names.add(n); const g = gameName(n); if (g && g !== n) names.add(g); } }
    for (const m of this.memory()) if (m.say) names.add(m.say);
    for (const s of (this.songs ? this.songs.list() : []).slice(0, 600)) if (s.title && s.title.length < 50) names.add(s.title.replace(/[^\w '&.-]/g, "").trim());
    for (const k of Object.keys(SITES)) names.add(k);
    for (const extra of (this.extraNames || [])) names.add(extra);
    try { this.voice.stdin.write("names " + [...names].filter(n => n.length > 1).slice(0, 1500).join("\u001f") + "\n"); } catch (e) {}
  }
  setWake(on) { this.wake = !!on; if (on) this.send("wake 1"); else if (this.voice) this.send("wake 0"); }

  /* ---------- understanding ---------- */
  // ctx (from the page): { themes:[{id,name}], weather, playing:{title,artist,on,playing}, localSongs: bool, timeZone, service }
  async handle(text, ctx = {}, opts = {}) {
    const said = String(text || "").trim().slice(0, 500);
    this.ctx = ctx;
    if (!said) return { reply: vibe("noHear", {}, ctx), actions: [] };
    this.dry = !!(opts.dry && this.testing);   // the test harness checks what would open, without opening it
    let r = await this.rules(said, ctx);
    if (!r && opts.ai !== false) {
      if (this.ai.key().key) {
        try { r = await this.askClaude(said, ctx, opts); }
        catch (e) { r = { reply: "I couldn't reach Claude: " + String(e.message || e).slice(0, 140), actions: [] }; }
      } else r = await this.askLocal(said, ctx, opts);
    }
    if (!r) r = { reply: vibe("unknown", {}, ctx), actions: [], unknown: true };
    this.history.push({ said, reply: r.reply, at: Date.now() }); this.history = this.history.slice(-8);
    return r;
  }

  async rules(said, ctx) {
    let q = norm(said).replace(/^(hey |ok |okay )?skyline /, "").replace(/^(please |can you |could you |would you |will you |i want to |i wanna |lets |let s )+/, "")
      .replace(/ (please|for me|right now|now|thanks|thank you)$/g, "").trim();
    if (!q || /^(never ?mind|cancel|nothing|stop listening)$/.test(q)) return { reply: vibe("okay", {}, ctx), actions: [], quiet: true };
    const A = (reply, ...actions) => ({ reply, actions }), V = (k, o) => vibe(k, o, ctx);
    const playing = ctx.playing || {};

    // memory
    let m = said.match(/^(?:(?:hey |ok )?skyline,?\s+)?(?:please\s+)?(?:remember|note|don'?t forget)(?:\s+that)?\s+(.+)$/i);
    if (m) return this.learn(m[1].trim());
    if (/^(forget|delete|remove) (everything|all (of )?(your|my|the) memor(y|ies))/.test(q)) return A("To clear everything, open Settings › Assistant and remove the memories there.", { type: "go", view: "settings:assistant" });
    m = q.match(/^forget (?:about |that )?(.+)$/);
    if (m) {
      const mem = this.memory(); let best = null, bs = 0;
      for (const x of mem) { const s = Math.max(score(m[1], x.say || ""), score(m[1], x.text) * .9, norm(x.text).includes(norm(m[1])) ? .85 : 0); if (s > bs) { bs = s; best = x; } }
      if (best && bs > .6) { this.forget(best.id); return A(V("forgot"), { type: "memory" }); }
      return A(V("noMemory", { x: m[1] }));
    }
    if (/^what (do you|did you) (remember|know about me)|^(show|list) (my |your )?memor/.test(q)) {
      const mem = this.memory();
      return A(mem.length ? V("memories", { x: mem.slice(-5).map(x => toYou(x.text.replace(/[.!]+$/, ""))).join("; ") }) : V("noMemories"), { type: "go", view: "settings:assistant" });
    }

    // music controls
    if (/^(pause|stop)( (the )?(music|song|it|playback|this))?$|^(pause|stop) (spotify|youtube)$|^be quiet$|^shut up$/.test(q)) return A(V("pause"), { type: "media", cmd: "pause" });
    if (/^(resume|unpause|continue|play|keep playing)( (the )?(music|song|it|playback))?$/.test(q)) return A(V("play"), { type: "media", cmd: "play" });
    if (/^(next|skip)( (song|track|one|this( song)?))?$|^play (the )?next (song|track)$/.test(q)) return A(V("next"), { type: "media", cmd: "next" });
    if (/^(previous|last|go back|back)( (song|track|one))?$|^play (the )?(previous|last) (song|track)$/.test(q)) return A(V("prev"), { type: "media", cmd: "prev" });
    if (/^(shuffle|turn on shuffle)( (the )?(music|songs|my songs))?$/.test(q)) return A(V("shuffle"), { type: "media", cmd: "shuffle" });
    if (/^(volume up|turn (it|the volume|the music) up|louder|raise the volume)$/.test(q)) return A(V("louder"), { type: "volume", delta: 12 });
    if (/^(volume down|turn (it|the volume|the music) down|quieter|softer|lower the volume)$/.test(q)) return A(V("quieter"), { type: "volume", delta: -12 });
    if (/^mute( (the )?(sound|volume|audio|music))?$/.test(q)) return A(V("mute"), { type: "volume", mute: true });
    if (/^unmute/.test(q)) return A(V("unmute"), { type: "volume", mute: false });
    m = q.match(/^(?:set |turn )?(?:the )?volume (?:to |at )?(.+?)( percent)?$/);
    if (m && num(m[1]) != null) { const v = Math.max(0, Math.min(100, num(m[1]))); return A(V("vol", { x: v }), { type: "volume", value: v }); }
    if (/^(whats|what is) (playing|this song|the song)|^what song is (this|playing)|^who sings this/.test(q))
      return A(playing.on ? V("nowPlaying", { x: `${playing.title}${playing.artist ? " by " + playing.artist : ""}` }) : V("nothing"));

    // time, date, weather
    if (/^(whats |what is )?(the )?time( is it)?$|^what time is it/.test(q)) return A(V("time", { x: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }));
    if (/^(whats |what is )?(the |todays )?date( today)?$|^what day is (it|today)/.test(q)) return A(V("date", { x: new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) }));
    if (/weather|temperature|is it (raining|cold|hot|snowing)|do i need (a jacket|an umbrella)/.test(q))
      return A(ctx.weather ? V("weather", { x: ctx.weather }) : V("noCity"), ...(ctx.weather ? [] : [{ type: "go", view: "settings:home" }]));

    // Skyline itself
    m = q.match(/^(?:go to|open|show(?: me)?|take me to|switch to) (?:the )?(.+?)(?: page| tab| screen)?$/);
    if (m && PAGES[m[1]]) return A(V("page", { x: m[1].replace(/^the /, "") }), { type: "go", view: PAGES[m[1]] });
    if (/^go home$|^home$/.test(q)) return A(V("home"), { type: "go", view: "home" });
    if (/^(what (can|do) you do|what are you|help( me)?|what can i (say|ask))\??$/.test(q)) return A("I can open your games and apps, play songs from your library or Spotify, pause and skip, change the volume, switch your background, set timers, add tasks, check the weather, open any page here like Notes or School, and remember things about you. Add a Claude key in Settings and I can chat about anything.");
    m = q.match(/^(?:go to|open|show(?: me)?|take me to|switch to) (?:the |my )?(youtube|minecraft) (?:page|tab|screen)$/);
    if (m) return A(V("page", { x: m[1] }), { type: "go", view: m[1] });
    if (/^(enter |start |turn on |go to )?ambient( mode)?( on)?$/.test(q)) return A(V("ambientOn"), { type: "ambient", on: true });
    if (/^(exit|leave|stop|turn off|close) ambient( mode)?$|^ambient( mode)? off$/.test(q)) return A(V("ambientOff"), { type: "ambient", on: false });
    m = q.match(/^(?:switch|change|set)(?: the)? (?:theme|background|wallpaper|scene)(?: to)? (.+)$|^(?:switch to|use|show) (?:the )?(.+?) (?:theme|background|scene)$/);
    if (m) { const name = m[1] || m[2], th = this.best(name, ctx.themes || []); if (th) return A(V("theme", { x: th.name }), { type: "theme", id: th.id }); }
    m = q.match(/^(?:switch to|change to|go to|use|show me|put on|set) (?:the )?(.+?)(?: theme| background| scene| wallpaper)?$/);
    if (m && !PAGES[m[1]]) { const th = this.best(m[1], ctx.themes || []); if (th && score(m[1], th.name) >= .75) return A(V("theme", { x: th.name }), { type: "theme", id: th.id }); }
    if (/^(next|another|different|random) (theme|background|scene)$|^surprise me$/.test(q) && (ctx.themes || []).length) { const t = ctx.themes[(Math.random() * ctx.themes.length) | 0]; return A(V("themeRandom", { x: t.name }), { type: "theme", id: t.id }); }

    // timers and tasks
    m = q.match(/^(?:set|start)(?: a| an)?(?: focus)? timer(?: for)? (.+?) (minutes?|mins?|hours?)$/) || q.match(/^(?:focus|start focusing) for (.+?) (minutes?|mins?|hours?)$/);
    if (m && num(m[1]) != null) { const n = num(m[1]) * (/hour/.test(m[2]) ? 60 : 1); return A(V("timer", { x: `${n} minute${n > 1 ? "s" : ""}` }), { type: "timer", minutes: n }); }
    if (/^(start|begin)( a| the)? focus( timer| session)?$|^start (a |the )?timer$/.test(q)) return A(V("timerStart"), { type: "timer", minutes: 0 });
    if (/^(stop|cancel|end|reset) (the )?(focus )?timer$/.test(q)) return A(V("timerStop"), { type: "timer", stop: true });
    m = said.match(/^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+)?(?:task|to-?do|todo)s?(?:\s+list)?\.?$/i) || said.match(/^(?:add (?:a )?task|remind me to|new task)[:,]?\s+(.+)$/i);
    if (m) return A(V("task", { x: m[1].trim() }), { type: "task", text: m[1].trim() });

    // web search
    m = said.match(/^(?:search(?: the web| google| online)?(?: for)?|google|look up)\s+(.+)$/i);
    if (m) { const url = "https://www.google.com/search?q=" + encodeURIComponent(m[1].trim()); await shell.openExternal(url); return A(V("search", { x: m[1].trim() })); }

    // open / play
    await this.loadApps();
    m = q.match(/^(?:open|launch|start|run|load|boot up|boot|fire up|go on|get on|hop on|jump on)(?: up)? (.+)$/);
    if (m) return this.openThing(m[1], ctx);
    m = q.match(/^(?:play|put on|listen to|throw on)(?: some)? (.+)$/);
    if (m && /\b(themes?|backgrounds?|wallpapers?|scenes?)\b/.test(m[1]) && !/^play /.test(q)) m = null;   // "put on a rainy background" is about the look, not music
    if (m) {
      let what = m[1], service = "";
      const sv = what.match(/^(.+?) (?:on|in|from|with) (youtube|spotify|my (?:songs|music|library)|skyline)$/);
      if (sv) { what = sv[1]; service = /youtube/.test(sv[2]) ? "youtube" : /spotify/.test(sv[2]) ? "spotify" : "local"; }
      // "play minecraft" means the game; "play blinding lights" means the song
      const mem = this.fromMemory(what); if (mem && !service) return this.openTarget(mem.target, what, mem);
      const game = !service && this.find(what, { kinds: ["game"] }) || (!service && this.find(what, { kinds: ["app"] }));
      if (game && game.score > .85 && !/music|songs?|playlist|album|radio/.test(what)) return this.openTarget(game, what);
      if (/^(music|some music|my music|my songs|songs|something)$/.test(what)) return A(V("mySongs"), { type: "playLocal", query: "", shuffle: true });
      return this.playSong(what, service || this.preferredService(), ctx);
    }
    // just a name: "minecraft", "spotify"
    const mem = this.fromMemory(q); if (mem) return this.openTarget(mem.target, q, mem);
    const direct = this.find(q); if (direct && direct.score > .9 && q.split(" ").length <= 5) return this.openTarget(direct, q);
    return null;
  }
  best(name, list) { let best = null, bs = 0; for (const t of list) { const s = score(name, t.name); if (s > bs) { bs = s; best = t; } } return bs > .6 ? best : null; }
  preferredService() {
    const t = this.memory().map(x => norm(x.text)).join(" | ");
    if (/\b(i use|i listen (on|to|with)|i prefer|play (my )?(music|songs) (on|in|with)) spotify/.test(t) || /spotify (for|is my) music/.test(t)) return "spotify";
    if (/\b(i use|i listen (on|to|with)|i prefer|play (my )?(music|songs) (on|in|with)) youtube/.test(t)) return "youtube";
    return "auto";
  }
  async openThing(what, ctx) {
    const mem = this.fromMemory(what); if (mem) return this.openTarget(mem.target, what, mem);
    const site = Object.keys(SITES).find(k => norm(what) === k || norm(what) === k + " com" || norm(what) === k.replace(/ /g, ""));
    const t = this.find(what);
    if (t && (t.score >= .9 || !site)) return this.openTarget(t, what);
    if (site) { await shell.openExternal(SITES[site]); return { reply: vibe("site", { x: cap(site) }, this.ctx), actions: [] }; }
    if (/^[a-z0-9-]+( dot |\.)(com|org|net|io|gg|tv|ai|co|app|dev)$/.test(norm(what).replace(/ (com|org|net|io|gg|tv|ai|co|app|dev)$/, ".$1"))) {
      const host = norm(what).replace(/ dot /g, ".").replace(/ (com|org|net|io|gg|tv|ai|co|app|dev)$/, ".$1").replace(/ /g, "");
      await shell.openExternal("https://" + host); return { reply: vibe("site", { x: host }, this.ctx), actions: [] };
    }
    const page = PAGES[norm(what)]; if (page) return { reply: vibe("page", { x: what }, this.ctx), actions: [{ type: "go", view: page }] };
    return null;
  }
  async openTarget(t, said, mem) {
    try { await this.launch(t); } catch (e) { return { reply: vibe("openFail", { x: t.name, err: String(e.message || e).slice(0, 120) }, this.ctx), actions: [] }; }
    const why = mem ? ` (you told me you use it for ${mem.say})` : "";
    return { reply: mem ? vibe("openMem", { x: t.name, say: mem.say }, this.ctx) : vibe("open", { x: t.name }, this.ctx), actions: [{ type: "opened", name: t.name, kind: t.kind, id: t.id }] };
  }
  async playSong(what, service, ctx) {
    const songs = this.songs ? this.songs.list() : [];
    let best = null, bs = 0;
    const by = what.match(/^(.+?) by (.+)$/);
    for (const s of songs) {
      const sc = by ? Math.min(score(by[1], s.title), Math.max(score(by[2], s.artist), .5)) * 1.05 : Math.max(score(what, s.title), score(what, `${s.title} ${s.artist}`), score(what, s.artist) * .92, score(what, s.album) * .85);
      if (sc > bs) { bs = sc; best = s; }
    }
    if (service !== "youtube" && service !== "spotify" && best && bs >= .78) {
      const artistOnly = !by && score(what, best.artist) > score(what, best.title);
      return { reply: artistOnly ? vibe("artist", { x: best.artist }, this.ctx) : vibe("song", { x: `${best.title}${best.artist ? " by " + best.artist : ""}` }, this.ctx), actions: [{ type: "playLocal", id: artistOnly ? "" : best.id, artist: artistOnly ? best.artist : "" }] };
    }
    if (service === "local") return { reply: vibe("notInSongs", { x: what }, this.ctx), actions: [{ type: "go", view: "music" }] };
    const q = what.replace(/ by /, " ");
    const spOn = this.spotify && this.spotify.status().connected;
    if (!spOn && service !== "youtube" && this.songs.hasSpotify()) {   // Spotify on this PC: no setup needed, it just plays
      if (this.dry) return { reply: vibe("spotify", { x: what }, this.ctx), actions: [] };
      try { const r = await this.songs.spotifyPlay(q, by ? by[1] : what);
        if (r.how === "played") return { reply: vibe("spotify", { x: r.title || what }, this.ctx), actions: [{ type: "spotify", title: r.title || what }] };
        if (r.how === "opened") return { reply: vibe("spotifyOpen", { x: r.title || what }, this.ctx), actions: [] };
        return { reply: vibe("spotifySearch", { x: what }, this.ctx), actions: [] };
      } catch (e) { /* fall through to YouTube */ }
    }
    if (spOn && service !== "youtube") {   // connected to Spotify: find it and play it there
      if (this.dry) return { reply: vibe("spotify", { x: what }, this.ctx), actions: [] };
      try { const r = await this.spotify.playQuery(q); const t = r.track;
        return { reply: vibe(r.how === "played" ? "spotify" : "spotifyOpen", { x: `${t.title} by ${t.artist}` }, this.ctx), actions: [{ type: "spotify", title: t.title }] };
      } catch (e) { return { reply: String(e.message || e), actions: [] }; }
    }
    if (service === "spotify") { await this.songs.spotify(q); return { reply: vibe("spotifySearch", { x: what }, this.ctx), actions: [] }; }
    await this.songs.youtube(q);
    return { reply: vibe("youtube", { x: what }, this.ctx), actions: [] };
  }
  async learn(fact) {
    const f = fact.replace(/[.!]+$/, "");
    let say = "", target = null;
    let m = f.match(/^(?:i (?:always |usually )?use|use|i play with|i prefer|i open)\s+(?:the\s+)?(.+?)\s+(?:for|instead of|not|rather than|to play|when i say)\s+(?:the\s+)?(?:normal|regular|default|official)?\s*(.+?)(?:\s+(?:launcher|app))?$/i);
    if (m) { target = this.find(m[1]); say = m[2]; }
    else if ((m = f.match(/^when i say\s+(.+?)\s*,?\s+(?:open|launch|start|play|i mean)\s+(.+)$/i))) { say = m[1]; target = this.find(m[2]); }
    else if ((m = f.match(/^(.+?)\s+(?:means|is)\s+(?:the\s+)?(.+?)(?:\s+(?:app|launcher))?$/i)) && this.find(m[2]) && m[1].split(" ").length <= 4) { say = m[1]; target = this.find(m[2]); }
    if (say && target) {
      say = say.replace(/^the\s+/i, "").replace(/\s+(launcher|app|game)$/i, "").trim();
      const item = this.remember({ text: cap(f), say, target });
      return { reply: vibe("linked", { say, x: target.name }, this.ctx), actions: [{ type: "memory", item }] };
    }
    const item = this.remember({ text: cap(f) });
    return { reply: vibe("remembered", {}, this.ctx), actions: [{ type: "memory", item }] };
  }

  /* ---------- Claude, for everything else ---------- */
  persona(ctx, how) {
    return `You are Sky, the AI assistant built into Skyline on the user's Windows PC. Your name is Sky (not Skyline: Skyline is the app, a night-city dashboard with music, games, school, money, YouTube, Minecraft and notes pages). If asked who you are, you're Sky.
You're a chill late-night friend: warm, laid-back, a little playful, never robotic or formal. Talk like a person, not a computer. Your reply is spoken aloud, so keep it to one to three short, natural sentences unless they ask you to explain something or want detail. No markdown, no lists, no emoji.${ctx.name ? ` The user's name is ${ctx.name}; use it now and then, not every time.` : ""}
${how} Only open things that exist in the lists below; pick the closest real name. Follow the user's memories: they override defaults (e.g. a memory "I use Modrinth App for Minecraft" means "open Minecraft" opens Modrinth App).
If a request is unsafe, destructive (deleting files, closing or killing programs, changing system settings, buying things, sending messages) or impossible with your actions, say so briefly instead.`;
  }
  knowledge(ctx, small) {
    const mem = this.memory(), lib = this.games.lib(), apps = this.apps.map(a => a.name).slice(0, small ? 150 : 400);
    return `# The user's memories
${mem.length ? mem.map(x => `- [${x.id}] ${x.text}${x.say ? ` (says “${x.say}” → opens ${x.target.name})` : ""}`).join("\n") : "(none yet)"}
# Games in their library
${lib.map(x => `- ${x.name} (${x.source || x.kind})`).join("\n") || "(none)"}
# Installed apps
${apps.join("; ")}
# Skyline themes
${(ctx.themes || []).map(t => t.name).join("; ")}
# Songs added to Skyline
${(this.songs ? this.songs.list() : []).slice(0, small ? 50 : 150).map(s => `${s.title}${s.artist ? " – " + s.artist : ""}`).join("; ") || "(none)"}`;
  }
  moment(ctx) {
    return `Now: ${new Date().toString().slice(0, 24)}. ${ctx.weather ? "Weather: " + ctx.weather + "." : ""} Now playing: ${ctx.playing && ctx.playing.on ? `${ctx.playing.title} by ${ctx.playing.artist || "?"} (${ctx.playing.playing ? "playing" : "paused"})` : "nothing"}.`;
  }

  // what the local brains are told: who they are, how to answer (a JSON plan), and what's on this PC
  localPrime(ctx, which) {
    const plan = `Answer with ONLY a JSON object and nothing else: {"reply": "what you say out loud", "do": [ ...actions ]}. Leave "do" out unless the user asked you to do something. Actions:
{"tool":"open","name":"<exact game/app name from the lists, or a full https:// URL>"}
{"tool":"media","action":"play|pause|next|prev|shuffle"}
{"tool":"volume","level":<0-100>} or {"tool":"volume","mute":true|false}
{"tool":"play_song","query":"<song and artist>","service":"auto|local|youtube|spotify"}
{"tool":"theme","name":"<Skyline theme name>"}
{"tool":"go","page":"home|music|social|games|school|money|youtube|minecraft|notes|settings"}
{"tool":"remember","fact":"<the fact, in their words, e.g. I play on Xbox>","say":"<phrase, optional>","open":"<exact app/game to open for it, optional>"}
{"tool":"forget","id":"<memory id>"}
{"tool":"add_task","text":"<task>"}
{"tool":"timer","minutes":<1-600>} or {"tool":"timer","stop":true}
{"tool":"web_search","query":"<search>"}
When they tell you something about themselves, their stuff or how they like things done ("keep that in mind", "my favorite...", "I use..."), save it with remember.
Examples:
"open discord" -> {"reply":"Opening Discord.","do":[{"tool":"open","name":"Discord"}]}
"my favorite game is Rocket League" -> {"reply":"Rocket League, nice. I'll remember that.","do":[{"tool":"remember","fact":"My favorite game is Rocket League"}]}
"make it look rainy" -> {"reply":"Rainy vibes coming up.","do":[{"tool":"theme","name":"<the closest rainy theme from the list>"}]}
"how far away is the moon" -> {"reply":"About 384,000 kilometers, roughly 239,000 miles."}`;
    const small = which === "ollama";
    const prime = this.persona(ctx, "When they want something done, put the matching actions in \"do\".") + "\n\n" + plan + "\n\n" + this.knowledge(ctx, small);
    return prime;
  }
  // load the AI on this PC with Skyline's instructions before the first question, so even that one is quick
  async primeBrain(ctx) {
    if (this.ai.key().key) return false;
    const st = await this.brain.status().catch(() => ({}));
    if (st.which !== "ollama") { if (st.which) this.brain.warm(st.which); return false; }
    await this.brain.prefill(this.localPrime(ctx || {}, "ollama")).catch(() => {});
    return true;
  }
  // no API key: the Claude account on this PC, or Ollama. They answer with a JSON plan instead of tool calls.
  async askLocal(said, ctx, opts) {
    let st; try { st = await this.brain.status(); } catch (e) { st = { which: "" }; }
    if (!st.which) return { reply: "I can do commands, but to really talk I need a brain. Connect ChatGPT or sign in to Claude on the Sky page, and I'm all yours.", actions: [], unknown: true, needBrain: true };
    const prime = this.localPrime(ctx, st.which), small = st.which === "ollama";
    const turn = (st.which === "claude" ? "Each of my messages starts with the current moment in brackets: that's context, not my words.\n" : "") + `[${this.moment(ctx)}]\n${said}`;
    let text;
    try { text = await this.brain.ask(st.which, prime, turn, this.history.slice(-4), MODELS[opts.model] ? opts.model : ""); }
    catch (e) {
      if (e.signin) return { reply: "Your Claude sign-in on this PC ran out. Hit Sign in on the AI page and I'll be back to full brain.", actions: [], needBrain: true };
      return { reply: (st.which === "ollama" ? "The AI on your PC didn't answer: " : st.which === "chatgpt" ? "I couldn't reach ChatGPT: " : "I couldn't reach Claude: ") + String(e.message || e).slice(0, 140), actions: [] };
    }
    const p = parsePlan(text), { actions, notes } = await this.runTools(p.calls, ctx);
    let reply = p.reply.replace(/\s+/g, " ").trim();
    if (!reply) reply = actions.find(a => a.type === "opened") ? `Opening ${actions.find(a => a.type === "opened").name}.` : notes[0] || "Done.";
    else if (notes.length && !actions.length) reply += " " + notes[0] + ".";
    return { reply, actions, ai: st.which };
  }
  async brainStatus(force) { const st = await this.brain.status(force); if (st.which && !this.ai.key().key) this.brain.warm(st.which); return st; }

  async askClaude(said, ctx, opts) {
    const key = this.ai.key().key; const client = new AnthropicClient({ apiKey: key, maxRetries: 1, timeout: 45000 });
    const model = MODELS[opts.model] ? opts.model : "claude-opus-5-5";
    const system = this.persona(ctx, "Use the tools to act.") + "\n" + this.moment(ctx) + "\n" + this.knowledge(ctx);
    const tools = [
      { name: "open", description: "Open a game from the library, an installed app, or a website (https URL).", input_schema: { type: "object", properties: { name: { type: "string", description: "Exact game/app name from the lists, or a full https:// URL" } }, required: ["name"] } },
      { name: "media", description: "Control whatever music is playing.", input_schema: { type: "object", properties: { action: { type: "string", enum: ["play", "pause", "next", "prev", "shuffle"] } }, required: ["action"] } },
      { name: "volume", description: "Set the system volume (0-100) or mute.", input_schema: { type: "object", properties: { level: { type: "integer", minimum: 0, maximum: 100 }, mute: { type: "boolean" } } } },
      { name: "play_song", description: "Play a song or artist: from the user's Skyline songs if it's there, otherwise on YouTube or Spotify.", input_schema: { type: "object", properties: { query: { type: "string", description: "Song title and artist" }, service: { type: "string", enum: ["auto", "local", "youtube", "spotify"] } }, required: ["query"] } },
      { name: "theme", description: "Switch Skyline's background theme.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
      { name: "go", description: "Show a page of Skyline.", input_schema: { type: "object", properties: { page: { type: "string", enum: ["home", "music", "social", "games", "school", "money", "youtube", "minecraft", "settings", "settings:appearance", "settings:assistant"] } }, required: ["page"] } },
      { name: "remember", description: "Save something the user wants you to remember. If it links a phrase to a game/app (e.g. 'I use Modrinth App for Minecraft'), fill say and open.", input_schema: { type: "object", properties: { fact: { type: "string" }, say: { type: "string", description: "What the user will say, e.g. Minecraft" }, open: { type: "string", description: "Exact game/app name to open for it" } }, required: ["fact"] } },
      { name: "forget", description: "Delete one memory by its id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "add_task", description: "Add a task to the user's task list.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      { name: "timer", description: "Start a focus timer for some minutes, or stop it.", input_schema: { type: "object", properties: { minutes: { type: "integer", minimum: 1, maximum: 600 }, stop: { type: "boolean" } } } },
      { name: "web_search", description: "Open a Google search in the browser.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    ];
    const messages = [];
    for (const h of this.history.slice(-4)) { messages.push({ role: "user", content: h.said }, { role: "assistant", content: h.reply }); }
    messages.push({ role: "user", content: said });
    const res = await client.messages.create({ model, max_tokens: 1500, system, tools, messages, thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    const { actions, notes } = await this.runTools(res.content.filter(b => b.type === "tool_use"), ctx);
    let reply = res.content.filter(b => b.type === "text").map(b => b.text).join(" ").replace(/\s+/g, " ").trim();
    if (!reply) reply = actions.find(a => a.type === "opened") ? `Opening ${actions.find(a => a.type === "opened").name}.` : notes[0] || "Done.";
    else if (notes.length && !actions.length) reply += " " + notes[0] + ".";
    return { reply, actions, ai: true };
  }
  async runTools(calls, ctx) {
    const actions = [], notes = [];
    for (const b of calls) {
      const i = b.input || {};
      try {
        if (b.name === "open") {
          if (/^https?:\/\//i.test(i.name || "")) { await this.launch({ kind: "url", id: i.name }); notes.push("Opened " + i.name); }
          else { const t = this.find(i.name || ""); if (!t) { notes.push(`Couldn't find ${i.name}`); continue; } await this.launch(t); actions.push({ type: "opened", name: t.name, kind: t.kind, id: t.id }); }
        } else if (b.name === "media") actions.push({ type: "media", cmd: i.action });
        else if (b.name === "volume") actions.push(i.mute != null && i.level == null ? { type: "volume", mute: !!i.mute } : { type: "volume", value: Math.max(0, Math.min(100, i.level | 0)) });
        else if (b.name === "play_song") { const r = await this.playSong(i.query || "", i.service || "auto", ctx); actions.push(...r.actions); }
        else if (b.name === "theme") { const th = this.best(i.name || "", ctx.themes || []); if (th) actions.push({ type: "theme", id: th.id }); }
        else if (b.name === "go") actions.push({ type: "go", view: i.page });
        else if (b.name === "remember") { const t = i.say && i.open ? this.find(i.open) : null; const item = this.remember({ text: i.fact, say: t ? i.say : "", target: t }); actions.push({ type: "memory", item }); }
        else if (b.name === "forget") { this.forget(String(i.id || "")); actions.push({ type: "memory" }); }
        else if (b.name === "add_task") actions.push({ type: "task", text: String(i.text || "").slice(0, 140) });
        else if (b.name === "timer") actions.push(i.stop ? { type: "timer", stop: true } : { type: "timer", minutes: i.minutes | 0 });
        else if (b.name === "web_search") await shell.openExternal("https://www.google.com/search?q=" + encodeURIComponent(String(i.query || "")));
      } catch (e) { notes.push(String(e.message || e)); }
    }
    return { actions, notes };
  }

  install(testing) {
    this.testing = !!testing;
    const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
    h("asst:listen", () => { this.send("listen"); return true; });
    h("asst:cancel", () => { if (this.voice) this.send("cancel"); return true; });
    h("asst:warm", () => { this.startVoice(); this.loadApps(); return true; });
    h("asst:wake", on => { this.setWake(on); return true; });
    h("asst:handle", (text, ctx, opts) => this.handle(text, ctx || {}, opts || {}));
    h("asst:memory", () => this.memory());
    h("asst:remember", m => this.remember(m || {}));
    h("asst:forget", id => this.forget(id));
    h("asst:updateMemory", (id, patch) => this.updateMemory(id, patch || {}));
    h("asst:targets", async refresh => { await this.loadApps(!!refresh); return this.targets().map(t => ({ kind: t.kind, id: t.id, name: t.name })); });
    h("asst:open", async t => {   // only things Skyline itself found can be opened from the page
      await this.loadApps(); const real = this.targets().find(x => t && x.kind === t.kind && x.id === t.id);
      if (!real) throw new Error("That isn't installed any more"); return this.launch(real);
    });
    h("asst:names", list => { this.extraNames = (Array.isArray(list) ? list : []).map(String).slice(0, 100); this.pushNames(); return true; });
    h("asst:models", () => MODELS);
    h("brain:status", force => this.brainStatus(!!force));
    h("brain:signin", () => this.brain.signIn());
    h("brain:gpt", async () => { await this.brain.gpt.signIn(); return true; });   // downloads Codex if needed, then opens ChatGPT's sign-in
    h("brain:pref", p => { this.brain.pref = ["claude", "chatgpt", "ollama"].includes(p) ? p : "auto"; return this.brain.status(true); });
    h("brain:prime", ctx => this.primeBrain(ctx || {}));
    if (testing) h("asst:test", async wav => { this.send("wav " + String(wav)); return true; });   // the test harness feeds it a recording
  }
  stop() { this.brain.stopClaude(); if (this.voice) { try { this.voice.stdin.write("quit\n"); } catch (e) {} const p = this.voice; setTimeout(() => { try { p.kill(); } catch (e) {} }, 1500); this.voice = null; } }
}

module.exports = { Assistant, score };
