// The clip recorder (a hidden window). Two recorders take turns, each starting over every minute, half a minute
// apart, so one of them always holds between 30 and 60 seconds of the screen and game sound. Saving hands that one's
// video to Skyline and starts it again. Nothing touches the disk until you save.
(async () => {
  const cfg = await window.clipper.config().then(r => r.ok ? r.data : null);
  if (!cfg || !cfg.source) { window.clipper.state(false); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "desktop" } },
      video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: cfg.source, maxWidth: cfg.w, maxHeight: cfg.h, maxFrameRate: cfg.fps } },
    });
  } catch (e) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: cfg.source, maxWidth: cfg.w, maxHeight: cfg.h, maxFrameRate: cfg.fps } } }); }   // (no game sound: picture only)
    catch (er) { window.clipper.state(false); return; }
  }
  const types = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/mp4", "video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || "";
  const ext = /mp4/.test(mime) ? "mp4" : "webm";
  const CYCLE = 60e3;
  const recs = [null, null];
  function begin(i) {
    const old = recs[i]; if (old && old.r.state !== "inactive") { old.drop = true; try { old.r.stop(); } catch (e) {} }
    const r = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: cfg.kbps * 1000, audioBitsPerSecond: 160000 });
    const rec = recs[i] = { r, chunks: [], at: Date.now(), drop: false };
    r.ondataavailable = e => { if (e.data && e.data.size && !rec.drop) rec.chunks.push(e.data); };
    r.start(1000);
    clearTimeout(rec.t); rec.t = setTimeout(() => { if (recs[i] === rec) begin(i); }, CYCLE);
  }
  begin(0); setTimeout(() => begin(1), CYCLE / 2);
  window.clipper.state(true);
  stream.getVideoTracks()[0].onended = () => window.clipper.state(false);
  window.clipper.onSave(() => {
    // the one that's been going longest (30-60 s), finished off and handed over
    const live = recs.map((x, i) => [x, i]).filter(([x]) => x && x.r.state === "recording");
    if (!live.length) return;
    const [rec, i] = live.sort((a, b) => a[0].at - b[0].at)[0], secs = (Date.now() - rec.at) / 1000;
    rec.drop = false; recs[i] = null; clearTimeout(rec.t);
    rec.r.onstop = async () => { const blob = new Blob(rec.chunks, { type: mime || "video/webm" }); await window.clipper.write(await blob.arrayBuffer(), ext, secs); };
    rec.r.stop();
    begin(i);
  });
})();
