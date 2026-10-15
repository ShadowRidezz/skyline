// Renders renderer/img/icon.svg into the app icon (build/icon.ico), the window icon and the tray icon.
// Run with:  npx electron build/make-icon.js
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const svg = fs.readFileSync(path.join(ROOT, "renderer", "img", "icon.svg"), "utf8");

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadURL("data:text/html,<html><body></body></html>");
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const pngs = await w.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = "data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"; await img.decode();
    const out = {};
    for (const s of ${JSON.stringify(sizes)}) {
      const c = document.createElement("canvas"); c.width = c.height = s; const g = c.getContext("2d");
      g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL("image/png").split(",")[1];
    }
    return out;
  })()`);
  const buf = s => Buffer.from(pngs[s], "base64");
  // .ico with PNG entries (Windows Vista and later read these at every size)
  const list = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256], datas = list.map(buf);
  const head = Buffer.alloc(6 + 16 * list.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(list.length, 4);
  let offset = head.length;
  list.forEach((s, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(datas[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += datas[i].length;
  });
  fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "build", "icon.ico"), Buffer.concat([head, ...datas]));
  fs.writeFileSync(path.join(ROOT, "build", "icon.png"), buf(256));
  const assets = path.join(ROOT, "main", "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "icon.png"), buf(256));
  fs.writeFileSync(path.join(assets, "tray.png"), buf(16));
  fs.writeFileSync(path.join(assets, "tray@2x.png"), buf(32));
  console.log("icons written");
  app.quit();
});
