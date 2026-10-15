// Watches the page for a new question and tells the side panel (through the background worker).
(function () {
  let last = "", paused = false, timer = 0;
  chrome.storage.local.get({ paused: false }, v => { paused = !!v.paused; scan(); });
  chrome.storage.onChanged.addListener(ch => { if (ch.paused) { paused = !!ch.paused.newValue; if (!paused) { last = ""; scan(); } } });
  function scan(force) {
    if (paused && !force) return;
    let q = null; try { q = SkyExtract.extract(document); } catch (e) { return; }
    if (!q || !q.question) return;
    if (!force && q.sig === last) return;
    last = q.sig;
    chrome.runtime.sendMessage({ type: "question", q: { ...q, url: location.origin + location.pathname, at: Date.now() } }).catch(() => {});
  }
  // the page changes all the time (timers, animations): wait for it to settle, then look
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => scan(), 700); }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  chrome.runtime.onMessage.addListener((m, sender, reply) => { if (m && m.type === "rescan") { last = ""; scan(true); reply({ ok: true }); } });
})();
