// Pretends to be the Skyline helper inside Spotify (for testing the Spicetify bridge without touching anyone's Spotify):
// says hello, waits for requests, answers searches and plays with made-up songs, and logs what it was asked.
// node test/spice-fake.mjs
const BASE = "http://127.0.0.1:43822", H = { Origin: "https://xpui.app.spotify.com", "Content-Type": "application/json" };
const post = (p, b) => fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(b) });
const song = (n, t) => ({ kind: "track", uri: "spotify:track:fake" + n, id: "fake" + n, title: t, artist: "Test Artist", album: "Test Album", art: "", dur: 200, explicit: false });
const jobs = {
  search: q => ({ tracks: [song(1, q + " (one)"), song(2, q + " (two)")], artists: [], albums: [], playlists: [] }),
  play: item => { console.log("PLAY", item.uri, item.position || 0); return { ok: true, how: "played" }; },
  open: item => { console.log("OPEN", item.uri); return { ok: true, how: "played" }; },
  queue: uri => { console.log("QUEUE", uri); return true; },
  playlists: () => [{ kind: "playlist", uri: "spotify:playlist:fakeP", id: "fakeP", title: "Wyatt's Mix", art: "", sub: "12 songs", mine: true }],
  current: () => ({ uri: "spotify:track:fake9", title: "Now Song", artist: "Test Artist", art: "", dur: 180, pos: 42, playing: true, at: Date.now() }),
};
for (let i = 0; ; i++) {
  try {
    await post("/hello", { name: "Wyatt", premium: false, version: "test" });
    // a page that isn't Spotify must be turned away
    const evil = await fetch(BASE + "/poll", { headers: { Origin: "https://evil.example" } }); console.log("other site:", evil.status);
    for (;;) {
      const r = await fetch(BASE + "/poll", { headers: H }); if (r.status === 204) continue; if (!r.ok) break;
      const job = await r.json(); console.log("ASKED", job.cmd, JSON.stringify(job.args).slice(0, 80));
      try { await post("/reply", { id: job.id, ok: true, data: await jobs[job.cmd](...job.args) }); } catch (e) { await post("/reply", { id: job.id, ok: false, error: e.message }); }
    }
  } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
}
