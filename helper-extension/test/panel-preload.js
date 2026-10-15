// Test only: plays Chrome's part for the side panel (messages, storage, tabs, screenshots), and makes its requests to
// Skyline from Node (the way the extension's own origin would be allowed).
const { ipcRenderer } = require("electron");
const store = {}, listeners = [];
const Q = { site: "IXL", skill: "Solve two-step equations", question: "Solve for x.\n3x + 4 = �11\nx =", choices: [], kind: "fill-in", blanks: 1, needsScreen: true, rect: { x: 10, y: 10, w: 400, h: 200, dpr: 1 }, sig: "t1", tabId: 1, frame: 0 };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
window.__sent = [];
window.chrome = {
  runtime: {
    sendMessage: async m => { window.__sent.push(m.type); if (m.type === "current") return { q: Q, supported: true, tabId: 1 }; if (m.type === "screenshot") return { image: PNG }; return { ok: true }; },
    onMessage: { addListener: f => listeners.push(f) },
  },
  storage: { local: { get: async d => ({ ...d, ...store }), set: async o => Object.assign(store, o) } },
  tabs: { query: async () => [{ id: 1 }], onActivated: { addListener() {} }, onUpdated: { addListener() {} } },
};
window.__store = store;
window.__push = q => listeners.forEach(f => f({ type: "question", q: { tabId: 1, ...q } }));
window.fetch = async (url, opts = {}) => {
  const r = await ipcRenderer.invoke("test:http", url, opts.method || "GET", opts.headers || {}, opts.body || "");
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body || "{}") };
};
