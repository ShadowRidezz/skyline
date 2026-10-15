// Runs first inside every game in Skyline's player (a sandbox with no network and no access to the
// app). It lets the player pause/resume the game, reports errors so the AI can fix them, and gives
// the game working storage even though the sandbox has none.
(() => {
  const post = m => { try { parent.postMessage(Object.assign({ skyline: "game" }, m), "*"); } catch (e) {} };
  const memStore = () => { const d = new Map(); return { getItem: k => (d.has(String(k)) ? d.get(String(k)) : null), setItem: (k, v) => void d.set(String(k), String(v)),
    removeItem: k => void d.delete(String(k)), clear: () => d.clear(), key: i => [...d.keys()][i] ?? null, get length() { return d.size; } }; };
  for (const name of ["localStorage", "sessionStorage"]) {
    try { window[name].getItem("x"); } catch (e) { try { Object.defineProperty(window, name, { value: memStore(), configurable: true }); } catch (er) {} }
  }

  let errors = 0;
  addEventListener("error", e => { if (errors++ < 20) post({ type: "error", message: e.message || "Unknown error", file: String(e.filename || "").split("/").pop(), line: e.lineno, col: e.colno,
    stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1200) : "" }); });
  addEventListener("unhandledrejection", e => { if (errors++ < 20) post({ type: "error", message: "Unhandled promise rejection: " + String(e.reason && (e.reason.stack || e.reason.message) || e.reason).slice(0, 1200) }); });
  const cerr = console.error.bind(console);
  console.error = (...a) => { if (errors++ < 20) post({ type: "console", message: a.map(x => (x && x.stack) || String(x)).join(" ").slice(0, 1200) }); cerr(...a); };

  // pause / resume: animation frames, timers and sound all wait while paused
  let paused = false, waiting = [];
  const raf = window.requestAnimationFrame.bind(window), st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.requestAnimationFrame = cb => (paused ? (waiting.push(() => raf(cb)), -1) : raf(cb));
  window.setTimeout = (fn, ms, ...a) => st(function run() { if (paused) waiting.push(() => st(run, 0)); else if (typeof fn === "function") fn(...a); }, ms);
  window.setInterval = (fn, ms, ...a) => si(() => { if (!paused && typeof fn === "function") fn(...a); }, ms);
  const audio = [];
  for (const k of ["AudioContext", "webkitAudioContext"]) {
    const AC = window[k]; if (!AC) continue;
    window[k] = class extends AC { constructor(...a) { super(...a); audio.push(this); } };
  }
  addEventListener("message", e => {
    const m = e.data; if (!m || m.skyline !== "player") return;
    if (m.cmd === "pause" && !paused) {
      paused = true; audio.forEach(c => c.state === "running" && c.suspend().catch(() => {}));
      document.querySelectorAll("audio,video").forEach(v => { if (!v.paused) { v.pause(); v.dataset.skyResume = "1"; } });
      post({ type: "paused" });
    } else if (m.cmd === "resume" && paused) {
      paused = false; const w = waiting; waiting = []; w.forEach(f => f());
      audio.forEach(c => c.state === "suspended" && c.resume().catch(() => {}));
      document.querySelectorAll("[data-sky-resume]").forEach(v => { v.play().catch(() => {}); delete v.dataset.skyResume; });
      post({ type: "resumed" });
    } else if (m.cmd === "focus") { try { window.focus(); (document.querySelector("canvas") || document.body).focus?.(); } catch (er) {} }
  });
  addEventListener("load", () => post({ type: "loaded", title: document.title }));
})();
