// Shared state for the Social tab, and the small pieces every part draws with (avatars, names, times).
import { esc } from "../util.js";
import { icon, hasIcon } from "./icons.js";

export const S = {
  configured: false, user: null, me: null, settings: {}, ice: [],
  friends: [], requests: [], notes: [], blocked: [],
  view: { kind: "friends" }, panel: null,
  convos: new Map(),     // friend id -> { msgs: [], loaded, more, loading }
  live: "connecting", call: null, incoming: null, booting: true,
  seenMsgs: new Set(), seenNotes: new Set(),
};

const subs = new Set();
export const on = fn => { subs.add(fn); return () => subs.delete(fn); };
export const emit = (what, data) => { for (const f of subs) { try { f(what, data); } catch (e) { console.log("[social]", what, e); } } };

export const STATUS = {
  online: { label: "Online", order: 0 }, away: { label: "Away", order: 1 }, dnd: { label: "Do not disturb", order: 2 }, offline: { label: "Offline", order: 3 },
};
export const statusOf = f => (f && STATUS[f.status] ? f.status : "offline");
export const friend = id => S.friends.find(f => f.id === id) || null;
export const myStatus = () => { const s = S.settings.status || "online"; return s === "invisible" ? "offline" : s; };

export function initials(name) {
  const w = String(name || "?").trim().split(/[\s_.]+/).filter(Boolean);
  return ((w[0] || "?")[0] + (w.length > 1 ? w[1][0] : "")).toUpperCase();
}
// an avatar: the person's picture (animated ones marked, so they can be paused) or their initials on their colour,
// with an optional frame and presence dot. The same everywhere: lists, chats, profiles.
export const isAnimated = url => /^data:image\/gif|\.gif$|-anim\.[a-z]+$/i.test(String(url || ""));
export function avatar(p, size = 32, status = null, deco = undefined) {
  const url = p && p.avatar, frame = deco !== undefined ? deco : p && (p.decoration || (p.details && p.details.decoration)) || "";
  const inner = url ? `<img src="${esc(url)}" alt="" draggable="false"${isAnimated(url) ? " data-anim" : ""}${/^https:/.test(url) ? ' crossorigin="anonymous"' : ""}>` : `<span>${esc(initials(p && (p.display_name || p.username)))}</span>`;
  const dot = status ? `<i class="sx-dot ${status}" title="${STATUS[status] ? STATUS[status].label : ""}"></i>` : "";
  return `<span class="sx-av${frame ? " deco deco-" + esc(frame) : ""}" style="--s:${size}px;--c:${esc((p && p.accent) || "#6d7cff")}">${inner}${dot}</span>`;
}
// a badge's symbol colour, kept readable: if it's too close to the background, white or near-black instead
const lum = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return null; const n = parseInt(m[1], 16), c = [n >> 16, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const readable = (bg, fg) => { const a = lum(bg), b = lum(fg); if (a == null || b == null) return fg; const r = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); return r >= 2.2 ? fg : a > .35 ? "#111318" : "#ffffff"; };
// badges are small symbols (like Discord's); the name shows when you point at one. withNames: the editor's version.
export function badgesHtml(list, small, withNames) {
  return (Array.isArray(list) ? list : []).map(b => {
    const style = ["gradient", "shine", "glow"].includes(b.style) ? b.style : "solid", two = /^#[0-9a-f]{6}$/i.test(b.bg2 || "") ? b.bg2 : b.bg;
    const tip = b.description ? `${b.name}
${b.description}` : b.name;
    return `<span class="sx-badge s-${style}${small ? " sm" : ""}${withNames ? " named" : ""}" style="--bg:${esc(b.bg)};--bg2:${esc(two)};--fg:${esc(readable(b.bg, b.fg))};${b.border ? `--bd:${esc(b.border)}` : ""}" data-tip="${esc(tip)}" aria-label="${esc(b.name)}${b.description ? ": " + esc(b.description) : ""}" role="img">${b.icon && hasIcon(b.icon) ? icon(b.icon) : `<i class="sx-badge-l">${esc((b.name || "?").trim().charAt(0).toUpperCase())}</i>`}${withNames ? `<span>${esc(b.name)}</span>` : ""}</span>`;
  }).join("");
}

export function ago(t) {
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 7 * 86400) return Math.floor(s / 86400) + " d ago";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}
export const clock = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function dayLabel(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: diff < 7 ? "long" : undefined, month: "long", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}
export function subline(f) {   // under a friend's name: their custom status, what they're up to, or when they were last around
  const st = statusOf(f);
  if (st !== "offline" && (f.status_text || f.status_emoji)) return ((f.status_emoji ? f.status_emoji + " " : "") + (f.status_text || "")).trim();
  if (st !== "offline") return STATUS[st].label;
  return f.last_seen ? "Last seen " + ago(f.last_seen) : "Offline";
}
export const linkify = text => esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, u => `<a href="#" data-link="${u}">${u}</a>`);
export const unreadTotal = () => S.friends.reduce((n, f) => n + (f.unread || 0), 0);
export const incomingCount = () => S.requests.filter(r => r.direction === "incoming").length;
