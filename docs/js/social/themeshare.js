// Themes in messages: a Theme Studio theme travels inside a normal message as "sky:theme/<code>", and shows as a card
// with its colours and a "Use this theme" button. Only safe data goes in (a name, which photo, colours, effect numbers);
// a picture from your own PC never leaves it. The phone shows the card but can't apply it (it has no Theme Studio).
import { esc } from "../util.js";
import { icon } from "./icons.js";

export const THEME_RE = /\bsky:theme\/([A-Za-z0-9_-]{20,3600})/g;
const HEX = /^#[0-9a-f]{6}$/i;
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function encodeTheme(t) {
  const o = { v: 1, n: String(t.name || "Theme").slice(0, 40), s: t.scene === "minimal" ? "minimal" : "photo", c: {}, f: {}, u: {} };
  if (t.base) o.b = String(t.base).slice(0, 40);
  if (t.photo && /^sky:\/\/app\/img\/photos\/[a-z0-9-]+\.jpg$/i.test(t.photo.src || "")) o.p = { src: t.photo.src, focus: (t.photo.focus || [.5, .5]).map(Number) };
  for (const [k, v] of Object.entries(t.colors || {})) if (HEX.test(v)) o.c[k] = v;
  for (const [k, v] of Object.entries(t.fx || {})) if (typeof v === "number" && isFinite(v)) o.f[k] = Math.round(v * 100) / 100;
  for (const [k, v] of Object.entries(t.ui || {})) if (typeof v === "number" && isFinite(v)) o.u[k] = v;
  return "sky:theme/" + b64u(JSON.stringify(o));
}

// a code from a message back into a theme Skyline can use (anything odd is dropped, never trusted)
export function decodeTheme(code) {
  try {
    const o = JSON.parse(unb64u(code)); if (!o || o.v !== 1) return null;
    const t = { name: String(o.n || "Shared theme").replace(/[\u0000-\u001f]/g, "").slice(0, 40) || "Shared theme", scene: o.s === "minimal" ? "minimal" : "photo", colors: {}, fx: {}, ui: {} };
    if (typeof o.b === "string" && /^[a-z0-9-]{1,40}$/i.test(o.b)) t.base = o.b;
    if (o.p && /^sky:\/\/app\/img\/photos\/[a-z0-9-]+\.jpg$/i.test(o.p.src || "")) t.photo = { src: o.p.src, focus: (Array.isArray(o.p.focus) ? o.p.focus : [.5, .5]).slice(0, 2).map(n => Math.min(1, Math.max(0, +n || .5))) };
    for (const [k, v] of Object.entries(o.c || {})) if (/^[a-z0-9]{1,20}$/i.test(k) && HEX.test(v)) t.colors[k] = v;
    for (const [k, v] of Object.entries(o.f || {})) if (/^[a-z0-9]{1,20}$/i.test(k) && typeof v === "number" && isFinite(v)) t.fx[k] = Math.min(1000, Math.max(-1000, v));
    for (const [k, v] of Object.entries(o.u || {})) if (/^[a-z0-9]{1,20}$/i.test(k) && typeof v === "number" && isFinite(v)) t.ui[k] = Math.min(100, Math.max(0, v));
    return t;
  } catch (e) { return null; }
}

// the card in the chat
export function themeCard(code, mine) {
  const t = decodeTheme(code); if (!t) return "";
  const c = t.colors, sw = [c.bg, c.skyTop, c.skyMid, c.skyLow, c.window, c.accent].filter(Boolean);
  const canUse = typeof window !== "undefined" && window.skyThemes && !mine;
  return `<div class="sx-theme" data-theme="${esc(code)}"><span class="sx-theme-sw" style="background:linear-gradient(90deg, ${sw.map((x, i) => `${x} ${i / sw.length * 100}% ${(i + 1) / sw.length * 100}%`).join(", ")})"></span>
    <span class="sx-theme-t"><b>${esc(t.name)}</b><small>Skyline theme${t.photo ? " · " + esc((n => n.charAt(0).toUpperCase() + n.slice(1))(t.photo.src.split("/").pop().replace(/\.jpg$/, "").replace(/-/g, " "))) + " photo" : ""}</small></span>
    ${canUse ? `<button class="btn sm primary" data-sx="usetheme:${esc(code)}">${icon("palette")}Use this theme</button>` : mine ? `<small class="sx-theme-note">You shared this</small>` : `<small class="sx-theme-note">Open Skyline on your PC to use it</small>`}</div>`;
}
