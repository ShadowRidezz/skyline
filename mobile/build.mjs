// Builds Skyline's phone web app into docs/ (served by GitHub Pages): the phone shell from mobile/src, the PC
// app's Social code and styles (shared, so both always match), the Supabase library, and the public settings.
// node mobile/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true }); fs.copyFileSync(path.join(ROOT, from), path.join(OUT, to)); };
const copyDir = (from, to, keep = () => true) => { for (const f of fs.readdirSync(path.join(ROOT, from))) { const p = path.join(from, f); if (fs.statSync(path.join(ROOT, p)).isDirectory()) copyDir(p, path.join(to, f), keep); else if (keep(f)) copy(p, path.join(to, f)); } };

copyDir("mobile/src", ".");
copy("renderer/js/util.js", "js/util.js");
copyDir("renderer/js/social", "js/social", f => f.endsWith(".js"));
for (const c of ["app", "social", "chat", "profile", "servers", "social2"]) copy(`renderer/css/${c}.css`, `css/${c}.css`);
copy("node_modules/@supabase/supabase-js/dist/umd/supabase.js", "js/supabase.js");
// (icons: mobile/src/icon-192.png and icon-512.png, on a dark background with room for round masks)
// the public settings only: the server address and its public key, the GIF key, connection helpers
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "main", "social-config.json"), "utf8"));
fs.writeFileSync(path.join(OUT, "js", "config.js"), `window.SKY_CONFIG = ${JSON.stringify({ url: cfg.url, anonKey: cfg.anonKey, gifKey: cfg.gifKey || "", ice: cfg.iceServers || null, version: pkg.version })};\n`);
fs.writeFileSync(path.join(OUT, "sw.js"), fs.readFileSync(path.join(OUT, "sw.js"), "utf8").replace("__VERSION__", pkg.version + "-" + Date.now().toString(36)));   // (a new name every build: phones see each one as an update)
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");   // (GitHub Pages: serve the files as they are)
console.log("phone app built into docs/ (" + pkg.version + ")");
