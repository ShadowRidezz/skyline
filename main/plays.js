// Song stats: a log of what you actually listen to (any app Windows sees playing: Spotify, YouTube, Skyline's own
// songs...). Every 5 seconds of playing counts toward the song; songs heard for 20 seconds or more are kept.
const fs = require("fs");
const path = require("path");
const { ipcMain } = require("electron");

const TICK = 5000, MIN = 20, KEEP = 6000;
// Only music counts: a music app (Spotify, Apple Music, Tidal...), or a web player that says which album it's from
// (YouTube Music does; ordinary YouTube videos, streams and clips don't, so they're never "your top song").
const MUSIC_APPS = /spotify|applemusic|apple music|itunes|tidal|deezer|amazon ?music|amazonmusic|soundcloud|pandora|qobuz|youtube ?music|ytmusic|foobar|musicbee|winamp|vlc|groove|zunemusic|media ?player/i;
const isMusic = (app, album) => MUSIC_APPS.test(String(app || "")) || !!String(album || "").trim();

class Plays {
  constructor(dataDir, media) { this.file = path.join(dataDir, "plays.json"); this.media = media; this.cur = null; this.log = this.read(); this.dirty = false; }
  read() {
    let j = []; try { j = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) {}
    if (!Array.isArray(j)) return [];
    const kept = j.filter(p => p && isMusic(p.app, p.al));
    if (kept.length !== j.length) {   // videos counted by older versions: out of your stats (the old file is kept as a backup)
      try { fs.copyFileSync(this.file, this.file + ".before-music-only.bak"); fs.writeFileSync(this.file, JSON.stringify(kept)); } catch (e) {}
    }
    return kept;
  }
  save() {
    if (!this.dirty) return; this.dirty = false;
    const tmp = this.file + ".tmp"; try { fs.writeFileSync(tmp, JSON.stringify(this.log.slice(-KEEP))); fs.renameSync(tmp, this.file); } catch (e) {}
  }
  tick() {
    const m = this.media && this.media.meta;
    if (!m || !m.on || !m.title || !String(m.artist || "").trim()) return;   // songs have an artist; web pages and app windows don't
    if (!isMusic(m.app, m.album)) return;   // a YouTube video, a stream, a clip: not a song
    const key = m.title + "\u0001" + (m.artist || "");
    if (!this.cur || this.cur.key !== key) {
      this.cur = { key, title: m.title.slice(0, 160), artist: (m.artist || "").slice(0, 120), album: (m.album || "").slice(0, 120), app: (m.app || "").replace(/\.exe$/i, "").slice(0, 40), at: Date.now(), secs: 0, logged: null };
      // the same song again within a few minutes (restarted, skipped back, paused for a bit) is the same play
      const last = this.log[this.log.length - 1];
      if (last && last.t === this.cur.title && last.a === this.cur.artist && Date.now() - (last.at + last.s * 1000) < 10 * 60e3) { this.cur.secs = last.s; this.cur.logged = last; }
    }
    if (!m.playing) return;
    const c = this.cur; c.secs += TICK / 1000;
    if (c.secs >= MIN) {
      if (!c.logged) { c.logged = { t: c.title, a: c.artist, al: c.album, app: c.app, at: c.at, s: 0 }; this.log.push(c.logged); if (this.log.length > KEEP + 500) this.log = this.log.slice(-KEEP); }
      c.logged.s = Math.round(c.secs); this.dirty = true;
    }
  }
  // totals for a range: top songs, top artists, minutes per week (the last 8 weeks)
  stats(range) {
    const now = Date.now(), from = range === "week" ? now - 7 * 864e5 : range === "month" ? now - 30 * 864e5 : 0;
    const inRange = this.log.filter(p => p.at >= from);
    const songs = new Map(), artists = new Map();
    for (const p of inRange) {
      const k = p.t + "\u0001" + p.a, s = songs.get(k) || { title: p.t, artist: p.a, plays: 0, secs: 0, app: p.app }; s.plays++; s.secs += p.s; songs.set(k, s);
      for (const a of String(p.a || "Unknown").split(/,\s*|\s+&\s+|\s+feat\.?\s+/i).filter(Boolean).slice(0, 3)) { const x = artists.get(a) || { name: a, plays: 0, secs: 0 }; x.plays++; x.secs += p.s; artists.set(a, x); }
    }
    const wk = []; const d = new Date(); d.setHours(0, 0, 0, 0); const start = d.getTime() - ((d.getDay() + 6) % 7) * 864e5;   // weeks start on Monday
    for (let i = 7; i >= 0; i--) { const a = start - i * 7 * 864e5, b = a + 7 * 864e5; wk.push({ from: a, mins: Math.round(this.log.filter(p => p.at >= a && p.at < b).reduce((t, p) => t + p.s, 0) / 60) }); }
    const by = (x, y) => y.secs - x.secs || y.plays - x.plays;   // what you listened to the longest
    return { since: this.log.length ? this.log[0].at : 0, plays: inRange.length, mins: Math.round(inRange.reduce((t, p) => t + p.s, 0) / 60),
      songs: [...songs.values()].sort(by).slice(0, 15), artists: [...artists.values()].sort(by).slice(0, 10), weeks: wk };
  }
  install() {
    setInterval(() => this.tick(), TICK);
    setInterval(() => this.save(), 60e3);
    ipcMain.handle("plays:stats", (e, range) => { this.save(); return this.stats(String(range || "week")); });
  }
  stop() { this.save(); }
}

module.exports = { Plays };
