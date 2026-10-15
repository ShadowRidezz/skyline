// Keeps the latest question for each tab, opens the side panel from the toolbar button, and takes screenshots for
// "Read from screen". All AI work happens in Skyline on this PC; nothing is sent anywhere else.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
const SITES = /^https:\/\/([^/]+\.)?(ixl\.com|sadlierconnect\.com|sadlier\.com)\//;

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.type === "question" && sender.tab) {
    const key = "q" + sender.tab.id;
    chrome.storage.session.get(key).then(v => {
      const old = v[key];
      // several frames can report: keep the one that looks most like the real question
      if (old && old.frame !== sender.frameId && old.at > Date.now() - 1500 && (old.question || "").length > (m.q.question || "").length && !m.q.choices.length) return;
      const q = { ...m.q, tabId: sender.tab.id, frame: sender.frameId };
      chrome.storage.session.set({ [key]: q });
      chrome.runtime.sendMessage({ type: "question", q }).catch(() => {});
    });
    return;
  }
  if (m.type === "current") {   // the panel asks: what's on the active tab?
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab) return reply({ q: null, supported: false });
      chrome.storage.session.get("q" + tab.id).then(v => reply({ q: v["q" + tab.id] || null, supported: SITES.test(tab.url || ""), tabId: tab.id, url: tab.url || "" }));
    });
    return true;
  }
  if (m.type === "rescan") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { if (tab) chrome.tabs.sendMessage(tab.id, { type: "rescan" }).catch(() => {}); reply({ ok: true }); });
    return true;
  }
  if (m.type === "screenshot") {   // only of a supported learning site in the active tab
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab || !SITES.test(tab.url || "")) return reply({ error: "Open IXL or Sadlier in this tab first" });
      try { reply({ image: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }) }); }
      catch (e) { reply({ error: "Chrome didn't allow a screenshot. Click the Sky Study Helper button in the toolbar once on this page, then try again." }); }
    });
    return true;
  }
});
// a tab that closes forgets its question
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove("q" + id));
