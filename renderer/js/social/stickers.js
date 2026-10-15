// Stickers: two built-in packs drawn right here (Sky, a little night-sky blob, and Words), your own uploaded
// stickers, favourites and recently used; and the picker that sends them.
import { esc, toast } from "../util.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { S } from "./state.js";

/* ---------- the Sky pack: one character, many moods (gently animated; still with reduced motion) ---------- */
const BODY = (c1 = "#8b9bff", c2 = "#5563e0") => `<defs><radialGradient id="g" cx="40%" cy="32%" r="75%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>
  <ellipse cx="80" cy="146" rx="42" ry="7" fill="#000" opacity=".22"/>`;
const blob = (inner, { c1, c2, bob = true, tilt = 0 } = {}) => `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">${BODY(c1, c2)}
  <g>${bob ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="1.6s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1"/>` : ""}
    <g transform="rotate(${tilt} 80 90)"><path d="M80 26c34 0 56 26 56 60 0 32-24 52-56 52s-56-20-56-52c0-34 22-60 56-60z" fill="url(#g)"/>
    <path d="M58 40c10-6 24-8 34-4" stroke="#fff" stroke-opacity=".35" stroke-width="6" stroke-linecap="round" fill="none"/>${inner}</g></g></svg>`;
const eyes = (y = 82, kind = "dot") => kind === "dot" ? `<circle cx="64" cy="${y}" r="6" fill="#16133a"/><circle cx="96" cy="${y}" r="6" fill="#16133a"/><circle cx="66" cy="${y - 2}" r="2" fill="#fff"/><circle cx="98" cy="${y - 2}" r="2" fill="#fff"/>`
  : kind === "happy" ? `<path d="M57 ${y + 2}q7-9 14 0M89 ${y + 2}q7-9 14 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>`
  : kind === "closed" ? `<path d="M57 ${y}q7 6 14 0M89 ${y}q7 6 14 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>`
  : kind === "wide" ? `<circle cx="64" cy="${y}" r="10" fill="#fff"/><circle cx="96" cy="${y}" r="10" fill="#fff"/><circle cx="64" cy="${y}" r="5" fill="#16133a"/><circle cx="96" cy="${y}" r="5" fill="#16133a"/>`
  : kind === "heart" ? `<path d="M64 ${y + 7}l-9-9a5.5 5.5 0 0 1 9-6 5.5 5.5 0 0 1 9 6z M96 ${y + 7}l-9-9a5.5 5.5 0 0 1 9-6 5.5 5.5 0 0 1 9 6z" fill="#ff4d7a"/>` : "";
const cheeks = `<ellipse cx="54" cy="98" rx="7" ry="4" fill="#ff7fa8" opacity=".55"/><ellipse cx="106" cy="98" rx="7" ry="4" fill="#ff7fa8" opacity=".55"/>`;
const SKY = {
  wave: ["Wave", "hi hello hey", blob(eyes(80, "happy") + cheeks + `<path d="M70 102q10 9 20 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <g><animateTransform attributeName="transform" type="rotate" values="-12 132 96;14 132 96;-12 132 96" dur=".7s" repeatCount="indefinite"/><path d="M126 100c8-10 14-22 20-28" stroke="#5563e0" stroke-width="13" stroke-linecap="round"/><circle cx="147" cy="70" r="9" fill="#8b9bff"/></g>`)],
  love: ["Love", "heart love cute", blob(eyes(82, "heart") + cheeks + `<path d="M70 102q10 10 20 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M124 44l-6-6a4 4 0 0 1 6-4 4 4 0 0 1 6 4z" fill="#ff4d7a"><animateTransform attributeName="transform" type="translate" values="0 6;0 -6;0 6" dur="1.4s" repeatCount="indefinite"/></path>`, { c1: "#ff9ec4", c2: "#e05c94" })],
  lol: ["LOL", "laugh lol funny haha", blob(eyes(80, "closed") + `<path d="M62 96h36q-2 20-18 20t-18-20z" fill="#16133a"/><path d="M70 110q10 6 20 0" fill="#ff6f91"/>
    <path d="M44 80q-6 6-4 14M116 80q6 6 4 14" stroke="#7ad3ff" stroke-width="4" stroke-linecap="round" fill="none"/>`, { tilt: -6 })],
  cry: ["Sad", "sad cry tears", blob(eyes(82, "dot") + `<path d="M70 108q10-9 20 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M60 90q-4 10 0 16q4-6 0-16z" fill="#7ad3ff"><animateTransform attributeName="transform" type="translate" values="0 0;0 14;0 0" dur="1.2s" repeatCount="indefinite"/></path>`, { c1: "#a3b1ff", c2: "#6d78c9", bob: false })],
  gg: ["GG", "gg good game win", blob(eyes(78, "happy") + `<path d="M68 96q12 10 24 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <g><rect x="44" y="108" width="72" height="30" rx="9" fill="#ffd166"/><text x="80" y="131" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="900" font-size="22" fill="#3a2a00">GG</text></g>`)],
  fire: ["Fire", "fire lit hot", blob(eyes(84, "dot") + `<path d="M70 102q10 8 20 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M80 6c10 14 18 20 14 34-2 8-10 12-14 12s-12-4-14-12c-3-12 6-18 14-34z" fill="#ff8a3d"><animateTransform attributeName="transform" type="scale" values="1 1;1.05 .94;1 1" dur=".6s" repeatCount="indefinite" additive="sum"/></path>`, { c1: "#ffb06b", c2: "#e8613a" })],
  sleepy: ["Sleepy", "sleep tired zzz night", blob(eyes(84, "closed") + `<circle cx="80" cy="104" r="5" fill="#16133a"/>
    <text x="118" y="46" font-family="Segoe UI, sans-serif" font-weight="800" font-size="20" fill="#cfd6ff">z<animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite"/></text>
    <text x="132" y="28" font-family="Segoe UI, sans-serif" font-weight="800" font-size="14" fill="#cfd6ff">z<animate attributeName="opacity" values="0;1;0" dur="2s" begin=".6s" repeatCount="indefinite"/></text>`, { bob: false, tilt: 8 })],
  party: ["Party", "party celebrate yay", blob(eyes(84, "happy") + cheeks + `<path d="M66 100q14 14 28 0z" fill="#16133a"/>
    <path d="M62 30l18-26 18 26z" fill="#ffd166"/><circle cx="80" cy="4" r="5" fill="#ff4d7a"/>
    <g fill="#7ad3ff"><rect x="30" y="40" width="6" height="6" rx="1"><animateTransform attributeName="transform" type="rotate" values="0 33 43;360 33 43" dur="1.5s" repeatCount="indefinite"/></rect><rect x="124" y="54" width="6" height="6" rx="1" fill="#ff8ab0"><animateTransform attributeName="transform" type="rotate" values="0 127 57;360 127 57" dur="1.2s" repeatCount="indefinite"/></rect></g>`)],
  shock: ["Shocked", "shock wow omg what", blob(eyes(78, "wide") + `<ellipse cx="80" cy="108" rx="9" ry="12" fill="#16133a"/>`, { bob: false })],
  cool: ["Cool", "cool sunglasses chill", blob(`<path d="M48 76h64v6q-2 14-16 14t-16-14h0q-2 14-16 14t-16-14z" fill="#16133a"/><path d="M58 80h12" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>
    <path d="M68 106q12 6 24-2" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>`, { tilt: 5 })],
  thumbs: ["Nice", "thumbs up nice yes ok", blob(eyes(80, "happy") + cheeks + `<path d="M70 100q10 9 20 0" stroke="#16133a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <g transform="translate(118 92)"><rect x="0" y="12" width="22" height="24" rx="6" fill="#ffd166"/><path d="M4 14c0-10 4-16 10-16 4 0 4 6 2 16z" fill="#ffd166"/></g>`)],
  think: ["Hmm", "think hmm wonder", blob(eyes(80, "dot") + `<path d="M70 106h20" stroke="#16133a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="124" cy="40" r="5" fill="#cfd6ff"/><circle cx="136" cy="26" r="8" fill="#cfd6ff"/><text x="136" y="31" text-anchor="middle" font-family="Segoe UI" font-weight="900" font-size="12" fill="#4a4f80">?</text>`, { tilt: -8, bob: false })],
};
/* ---------- the Words pack ---------- */
const word = (t, c1, c2, rot = -6) => `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(${rot} 80 80)">
  <rect x="14" y="44" width="132" height="72" rx="18" fill="${c2}"/><rect x="14" y="38" width="132" height="72" rx="18" fill="${c1}"/>
  <text x="80" y="${t.length > 3 ? 86 : 90}" text-anchor="middle" font-family="Segoe UI Variable Display, Segoe UI, sans-serif" font-weight="900" font-size="${t.length > 3 ? 34 : 44}" fill="#fff" letter-spacing="1">${t}</text></g></svg>`;
const WORDS = {
  w: ["W", "w win dub", word("W", "#22c55e", "#15803d")], l: ["L", "l loss", word("L", "#ef4444", "#991b1b", 6)],
  brb: ["BRB", "brb be right back", word("BRB", "#6366f1", "#3730a3")], omg: ["OMG", "omg wow", word("OMG", "#f59e0b", "#b45309", 5)],
  ty: ["TY", "thanks thank you ty", word("TY", "#ec4899", "#9d174d")], gn: ["GN", "good night gn", word("GN", "#0ea5e9", "#075985", 4)],
  hype: ["HYPE", "hype lets go", word("HYPE", "#a855f7", "#6b21a8")], ok: ["OK", "ok okay", word("OK", "#14b8a6", "#0f766e", 7)],
};
export const PACKS = [{ id: "sky", name: "Sky", list: SKY }, { id: "words", name: "Words", list: WORDS }];
const svgUrl = svg => "data:image/svg+xml;utf8," + encodeURIComponent(svg);
export function stickerSrc(id) { const [pack, name] = String(id || "").split("/"); const p = PACKS.find(x => x.id === pack), s = p && p.list[name]; return s ? svgUrl(s[2]) : ""; }
export function stickerName(id) { const [pack, name] = String(id || "").split("/"); const p = PACKS.find(x => x.id === pack), s = p && p.list[name]; return s ? s[0] : "Sticker"; }

/* ---------- the picker ---------- */
const mine = () => (Array.isArray(S.settings.stickers) ? S.settings.stickers : []).filter(s => s && /^https:|^data:image/.test(s.url || ""));
const favs = () => (Array.isArray(S.settings.favStickers) ? S.settings.favStickers : []);
const recent = () => (Array.isArray(S.settings.recentStickers) ? S.settings.recentStickers : []);
const key = s => s.id ? "b:" + s.id : "u:" + s.url;
let open = null;
// onPick({ sticker: "pack/name" } | { url }) ; save(): persist settings
export function pickSticker(anchor, onPick, save) {
  closeStickers();
  const el = document.createElement("div"); el.className = "sx-stk"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Stickers");
  let tab = recent().length ? "recent" : "sky", q = "";
  const all = () => [...PACKS.flatMap(p => Object.entries(p.list).map(([n, s]) => ({ id: `${p.id}/${n}`, name: s[0], words: s[1], src: svgUrl(s[2]), pack: p.id }))),
    ...mine().map(s => ({ url: s.url, name: s.name || "My sticker", words: (s.name || "").toLowerCase(), src: s.url, pack: "mine" }))];
  const tabs = [["recent", "Recent", "refresh"], ["favs", "Favorites", "star"], ...PACKS.map(p => [p.id, p.name, p.id === "sky" ? "sparkle" : "message"]), ["mine", "Mine", "image"]];
  const draw = () => {
    const A = all();
    let list = q ? A.filter(s => (s.name + " " + s.words).toLowerCase().includes(q.toLowerCase()))
      : tab === "recent" ? recent().map(k => A.find(s => key(s) === k)).filter(Boolean)
      : tab === "favs" ? favs().map(k => A.find(s => key(s) === k)).filter(Boolean) : A.filter(s => s.pack === tab);
    const fav = new Set(favs());
    el.querySelector(".sx-stk-grid").innerHTML = (list.length ? list.map(s => `<div class="sx-stk-item"><button class="sx-stk-pick" data-k="${esc(key(s))}" title="${esc(s.name)}" aria-label="Send ${esc(s.name)} sticker"><img src="${esc(s.src)}" alt="" draggable="false"></button>
        <button class="sx-stk-fav${fav.has(key(s)) ? " on" : ""}" data-fav="${esc(key(s))}" title="${fav.has(key(s)) ? "Remove from favorites" : "Add to favorites"}" aria-label="Favorite">${icon("star")}</button></div>`).join("")
      : `<p class="sx-none">${q ? "No stickers found." : tab === "favs" ? "Star a sticker to keep it here." : tab === "mine" ? "Upload your own stickers below." : tab === "recent" ? "Stickers you send show up here." : ""}</p>`)
      + (tab === "mine" && !q ? `<button class="sx-stk-add" data-add title="Upload a sticker (PNG, WebP or GIF, up to 1 MB)">${icon("plus")}<span>Add sticker</span></button>` : "");
    el.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", !q && b.dataset.tab === tab));
  };
  el.innerHTML = `<div class="sx-emoji-top"><label class="sx-search sm">${icon("search")}<input placeholder="Search stickers" spellcheck="false" aria-label="Search stickers"></label></div>
    <div class="sx-emoji-cats">${tabs.map(([k, l, ic]) => `<button data-tab="${k}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join("")}</div><div class="sx-stk-grid"></div>`;
  document.body.appendChild(el); draw();
  const input = el.querySelector("input");
  input.oninput = () => { q = input.value.trim(); draw(); };
  el.addEventListener("click", async e => {
    e.stopPropagation();
    const t = e.target.closest("[data-tab]"); if (t) { tab = t.dataset.tab; q = ""; input.value = ""; return draw(); }
    const f = e.target.closest("[data-fav]"); if (f) { const k = f.dataset.fav, list = favs().filter(x => x !== k); if (list.length === favs().length) list.unshift(k); S.settings.favStickers = list.slice(0, 48); save(); return draw(); }
    if (e.target.closest("[data-add]")) return addOwn(save, draw);
    const p = e.target.closest("[data-k]"); if (!p) return;
    const k = p.dataset.k; S.settings.recentStickers = [k, ...recent().filter(x => x !== k)].slice(0, 16); save();
    onPick(k.startsWith("b:") ? { sticker: k.slice(2) } : { url: k.slice(2) }); closeStickers();
  });
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px"; el.style.top = Math.max(8, r.top - h - 8) + "px";
  setTimeout(() => input.focus(), 10);
  const away = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeStickers(); };
  const esc_ = e => { if (e.key === "Escape") { e.stopPropagation(); closeStickers(); } };
  document.addEventListener("mousedown", away, true); document.addEventListener("keydown", esc_, true);
  open = { el, off: () => { document.removeEventListener("mousedown", away, true); document.removeEventListener("keydown", esc_, true); } };
}
export function closeStickers() { if (open) { open.off(); open.el.remove(); open = null; } }
function addOwn(save, redraw) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/png,image/webp,image/gif";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (!/^image\/(png|webp|gif)$/.test(f.type)) return toast("Stickers can be PNG, WebP or GIF pictures.", true);
    if (f.size > 1048576) return toast("Stickers can be up to 1 MB.", true);
    if (mine().length >= 30) return toast("You can keep up to 30 of your own stickers.", true);
    try {
      const r = await api.upload("sticker", await f.arrayBuffer());
      S.settings.stickers = [...mine(), { url: r.url, name: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 30) }]; save(); toast("Sticker added"); redraw();
    } catch (e) { toast(e.message, true); }
  };
  inp.click();
}
