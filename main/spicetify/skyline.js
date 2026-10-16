// Skyline helper for Spicetify. Runs inside the Spotify desktop app and lets Skyline (on this PC) search Spotify,
// play songs, add to the queue, like songs and read your playlists, without Spotify Premium.
// It only talks to Skyline on this computer (http://127.0.0.1:43822) and does nothing when Skyline isn't open.
(async function skylineHelper() {
  const S = window.Spicetify;
  if (!S || !S.Player || !S.CosmosAsync || !S.Platform) { setTimeout(skylineHelper, 500); return; }
  const BASE = "http://127.0.0.1:43822", VERSION = "1";
  const web = p => S.CosmosAsync.get("https://api.spotify.com/v1" + p);
  const img = list => { const a = (list || []).slice().sort((x, y) => (x.width || 0) - (y.width || 0)); return (a.find(i => (i.width || 300) >= 160) || a[a.length - 1] || {}).url || ""; };
  const track = (t, extra = {}) => t && t.uri && /^spotify:track:/.test(t.uri) ? { kind: "track", uri: t.uri, id: t.id || t.uri.split(":")[2], title: t.name, artist: (t.artists || []).map(a => a.name).join(", "),
    album: t.album ? t.album.name : "", art: img((t.album || {}).images) || extra.art || "", dur: Math.round((t.duration_ms || 0) / 1000), explicit: !!t.explicit, ...extra } : null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const jobs = {
    async search(q) {
      q = String(q || "").trim().slice(0, 120); if (!q) return { tracks: [], artists: [], albums: [], playlists: [] };
      const j = await web("/search?" + new URLSearchParams({ q, type: "track,artist,album,playlist", limit: "10" }));
      return {
        tracks: ((j.tracks || {}).items || []).filter(Boolean).map(t => track(t, { context: t.album && t.album.uri })).filter(Boolean),
        artists: ((j.artists || {}).items || []).filter(Boolean).slice(0, 6).map(a => ({ kind: "artist", uri: a.uri, id: a.id, title: a.name, art: img(a.images), sub: "Artist" })),
        albums: ((j.albums || {}).items || []).filter(Boolean).slice(0, 6).map(a => ({ kind: "album", uri: a.uri, id: a.id, title: a.name, artist: (a.artists || []).map(x => x.name).join(", "), art: img(a.images), sub: "Album · " + String(a.release_date || "").slice(0, 4) })),
        playlists: ((j.playlists || {}).items || []).filter(Boolean).slice(0, 6).map(p => ({ kind: "playlist", uri: p.uri, id: p.id, title: p.name, art: img(p.images), sub: "Playlist · " + ((p.owner || {}).display_name || "") })),
      };
    },
    async play(item) {
      const isTrack = /^spotify:track:/.test(item.uri);
      if (isTrack && item.context && !item.solo) await S.Player.playUri(item.context, {}, { skipTo: { uri: item.uri } });
      else await S.Player.playUri(item.uri);
      if (+item.position > 0) { await sleep(600); S.Player.seek(Math.round(+item.position * 1000)); }
      return { ok: true, how: "played" };
    },
    async open(item) { return jobs.play({ ...item, solo: true }); },
    async playList(uris) { await S.Player.playUri(uris[0]); if (uris.length > 1) await S.addToQueue(uris.slice(1, 50).map(uri => ({ uri }))); return { how: "played" }; },
    async queue(uri) { await S.addToQueue([{ uri }]); return true; },
    async like(id) { const uri = "spotify:track:" + id; if (S.Platform.LibraryAPI && S.Platform.LibraryAPI.add) await S.Platform.LibraryAPI.add({ uris: [uri] }); else await S.CosmosAsync.put("https://api.spotify.com/v1/me/tracks?ids=" + id); return true; },
    async playlists() { const j = await web("/me/playlists?limit=50"); return (j.items || []).filter(Boolean).map(p => ({ kind: "playlist", uri: p.uri, id: p.id, title: p.name, art: img(p.images), sub: (p.tracks || p.items || {}).total != null ? `${(p.tracks || p.items).total} songs` : "Playlist", mine: true })); },
    async library(kind) {
      if (kind === "playlists") return jobs.playlists();
      if (kind === "albums") { const j = await web("/me/albums?limit=50"); return (j.items || []).map(x => x.album).filter(Boolean).map(a => ({ kind: "album", uri: a.uri, id: a.id, title: a.name, art: img(a.images), sub: (a.artists || []).map(x => x.name).join(", ") })); }
      if (kind === "artists") { const j = await web("/me/following?type=artist&limit=50"); return ((j.artists || {}).items || []).filter(Boolean).map(a => ({ kind: "artist", uri: a.uri, id: a.id, title: a.name, art: img(a.images), sub: "Artist" })); }
      if (kind === "liked") return jobs.tracks("liked");
      throw new Error("Unknown library section");
    },
    async tracks(kind, id) {
      if (kind === "liked") { const j = await web("/me/tracks?limit=50"); return (j.items || []).map(x => track(x.track)).filter(Boolean); }
      if (kind === "playlist") { const j = await web(`/playlists/${id}/tracks?limit=100`); return (j.items || []).map(x => track(x.track || x.item, { context: "spotify:playlist:" + id })).filter(Boolean); }
      if (kind === "album") { const j = await web(`/albums/${id}`); return ((j.tracks || {}).items || []).map(t => track(t, { art: img(j.images), album: j.name, context: j.uri })).filter(Boolean); }
      if (kind === "artist") { const j = await web(`/artists/${id}/top-tracks?market=from_token`); return (j.tracks || []).map(t => track(t)).filter(Boolean); }
      throw new Error("Unknown list");
    },
    async upNext() {
      const d = S.Player.data || {}, q = (S.Queue && S.Queue.nextTracks) || [];
      const now = d.item ? { kind: "track", uri: d.item.uri, title: (d.item.metadata || {}).title || d.item.name, artist: (d.item.metadata || {}).artist_name || "", art: (d.item.metadata || {}).image_url || "" } : null;
      return { now, queue: q.slice(0, 30).map(x => x.contextTrack || x).filter(x => x && /^spotify:track:/.test(x.uri || "")).map(x => ({ kind: "track", uri: x.uri, title: (x.metadata || {}).title || "", artist: (x.metadata || {}).artist_name || "", art: (x.metadata || {}).image_url || "" })) };
    },
    async skipTo(n) { for (let i = 0; i < Math.max(1, Math.min(30, n | 0)); i++) { S.Player.next(); await sleep(350); } return true; },
    async current() {
      const d = S.Player.data || {}, it = d.item; if (!it || !/^spotify:track:/.test(it.uri || "")) return null;
      const m = it.metadata || {};
      return { uri: it.uri, title: m.title || it.name || "", artist: m.artist_name || "", art: (m.image_url || "").replace(/^spotify:image:/, "https://i.scdn.co/image/"), dur: Math.round((+m.duration || S.Player.getDuration() || 0) / 1000), pos: (S.Player.getProgress() || 0) / 1000, playing: !!S.Player.isPlaying(), at: Date.now() };
    },
    async addTo(pid, uri) { await S.CosmosAsync.post(`https://api.spotify.com/v1/playlists/${pid}/tracks`, { uris: [uri] }); return true; },
  };

  let me = { name: "Spotify", premium: false };
  try { const u = await web("/me"); me = { name: u.display_name || u.id || "Spotify", premium: u.product === "premium" }; } catch (e) {}
  const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (;;) {   // wait for the next thing Skyline asks for; when Skyline is closed, check back now and then
    try {
      await post("/hello", { ...me, version: VERSION });
      for (;;) {
        const r = await fetch(BASE + "/poll"); if (r.status === 204) continue; if (!r.ok) break;
        const job = await r.json(), fn = jobs[job.cmd];
        try { if (!fn) throw new Error("Unknown request"); const data = await fn(...(job.args || [])); await post("/reply", { id: job.id, ok: true, data }); }
        catch (e) { await post("/reply", { id: job.id, ok: false, error: String((e && e.message) || e) }); }
      }
    } catch (e) {}
    await sleep(15000);
  }
})();
