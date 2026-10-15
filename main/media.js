// Runs helper.ps1 (what's playing, volume, speaker level, network, full-screen games) and turns its
// lines into events. The helper restarts by itself if it ever stops.
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { EventEmitter } = require("events");

class Media extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.proc = null;
    this.meta = { on: false };
    this.vol = null;
    this.apps = { list: [], pin: "" };
    this.game = false;
    this.art = new Map();       // id -> { data, type } (the last few covers)
    this.wants = { meter: false, sys: false };
    this.stopped = false;
    this.restarts = [];
  }

  start() {
    this.stopped = false;
    if (process.platform !== "win32" || this.proc) return;
    // PowerShell can't run a script that lives inside the app's archive: keep a copy in the data folder.
    const src = fs.readFileSync(path.join(__dirname, "helper.ps1"), "utf8");
    const file = path.join(this.dataDir, "helper.ps1");
    try { if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== src) fs.writeFileSync(file, src, "utf8"); } catch (e) {}
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, SKY_PID: String(process.pid) },
    });
    this.proc = p;
    this.debug = process.argv.some(x => x.startsWith("--shot")) ? 6 : 0; console.log("[helper] started", file);
    let errText = "";
    p.stderr.on("data", d => { errText = (errText + d).slice(-2000); });
    p.on("error", e => console.log("[helper] could not start:", e.message));
    p.on("exit", code => { if (code) console.log(`[helper] stopped (${code}) ${errText.replace(/\s+/g, " ").slice(0, 600)}`); });
    readline.createInterface({ input: p.stdout }).on("line", line => this.line(line));
    p.on("exit", () => {
      if (this.proc !== p) return;
      this.proc = null;
      this.setMeta({ on: false });
      if (this.stopped) return;
      const now = Date.now();
      this.restarts = this.restarts.filter(t => now - t < 60000);
      if (this.restarts.length < 4) { this.restarts.push(now); setTimeout(() => this.start(), 3000); }
    });
    p.stdin.on("error", () => {});
  }

  stop() {
    this.stopped = true;
    if (this.proc) { try { this.proc.stdin.end(); } catch (e) {} const p = this.proc; setTimeout(() => { try { p.kill(); } catch (e) {} }, 2000); }
    this.proc = null;
  }

  // the running programs as "name\texe\tpid\tcmd" lines (null if the helper can't answer)
  procs() {
    if (!this.proc) return Promise.resolve(null);
    const id = String(++this.procN || (this.procN = 1)); this.procWait = this.procWait || new Map();
    return new Promise(res => { this.procWait.set(id, res); this.send("procs " + id); setTimeout(() => { if (this.procWait.delete(id)) res(null); }, 10000); });
  }

  send(cmd) { if (this.proc) { try { this.proc.stdin.write(cmd + "\n"); } catch (e) {} } }

  want(kind, on) {
    if (this.wants[kind] === !!on) return;
    this.wants[kind] = !!on;
    this.send(`${kind} ${on ? 1 : 0}`);
  }

  line(line) {
    if (this.debug && this.debug-- > 0) console.log("[helper line]", line.slice(0, 160));
    if (line.startsWith("L ")) {
      const [, l, b] = line.split(" ");
      this.emit("level", { level: +l || 0, beats: +b || 0 });
      return;
    }
    if (line.startsWith("S ")) {
      const [, rx, tx, total, free] = line.split(" ").map(Number);
      this.emit("sys", { rx, tx, diskTotal: total, diskFree: free, t: Date.now() });
      return;
    }
    let m; try { m = JSON.parse(line); } catch (e) { return; }
    if (m.t === "ready") {  // re-send what we want after a restart
      for (const k of Object.keys(this.wants)) if (this.wants[k]) this.send(`${k} 1`);
      if (this.apps.pin) this.send(`pin ${this.apps.pin}`);
    } else if (m.t === "m") this.setMeta(m);
    else if (m.t === "v") { this.vol = { vol: m.vol, muted: m.muted }; this.emit("vol", this.vol); }
    else if (m.t === "apps") { this.apps = { list: m.list || [], pin: m.pin || "" }; this.emit("apps", this.apps); }
    else if (m.t === "fs") { this.game = !!m.on; this.emit("game", this.game); }
    else if (m.t === "fg") { this.fgPid = +m.pid || 0; this.emit("fg", this.fgPid); }
    else if (m.t === "procs") { const w = this.procWait && this.procWait.get(m.id); if (w) { this.procWait.delete(m.id); w(Array.isArray(m.list) ? m.list : null); } }
    else if (m.t === "error") console.log("[helper]", m.where, m.msg);
  }

  setMeta(m) {
    const key = [m.app, m.title, m.artist].join("|");
    if (m.art) {
      const data = Buffer.from(m.art, "base64");
      const id = crypto.createHash("sha1").update(data).digest("hex").slice(0, 16);
      const type = data[0] === 0x89 ? "image/png" : data.slice(0, 4).toString() === "RIFF" ? "image/webp" : data.slice(0, 3).toString() === "GIF" ? "image/gif" : "image/jpeg";
      this.art.set(id, { data, type, key });
      while (this.art.size > 8) this.art.delete(this.art.keys().next().value);
      this.artFor = { key, id };
    }
    const meta = { on: !!(m.on && m.title) };
    if (meta.on) {
      Object.assign(meta, {
        title: m.title || "", artist: m.artist || "", album: m.album || "", app: m.app || "",
        playing: m.status === 4, status: m.status || 0, pos: m.pos || 0, dur: m.dur || 0, at: m.at || 0,
        shuffle: m.shuffle ?? null, repeat: m.repeat ?? null, can: m.can || {},
        art: this.artFor && this.artFor.key === key ? `sky://art/${this.artFor.id}` : "",
      });
    }
    if (JSON.stringify(meta) === JSON.stringify(this.meta)) return;
    const changedTrack = meta.on && (!this.meta.on || meta.title !== this.meta.title || meta.artist !== this.meta.artist);
    this.meta = meta;
    this.emit("meta", meta, changedTrack);
  }
}

module.exports = { Media };
