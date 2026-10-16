// GIFs from GIPHY: a picker next to stickers (trending, your favorites, the ones you sent lately, or a search),
// a star to keep a GIF (in the picker, or on any GIF in a chat), and how a GIF message is drawn.
// The search runs in Skyline's background process (GIPHY's key lives in social-config.json, like the server's).
import { esc, sky, toast } from "../util.js";
import { icon } from "./icons.js";
import { S } from "./state.js";

let open = null;
const unwrap = r => { if (!r || !r.ok) throw new Error(r ? r.error : "offline"); return r.data; };
const find = async q => unwrap(await sky.social.gifs(q || ""));
const urlOf = id => `https://media.giphy.com/media/${id}/giphy.webp`, prevOf = id => `https://media.giphy.com/media/${id}/200w.webp`;
export const gifId = url => (/^https:\/\/media[0-9]?\.giphy\.com\/media\/(?:v1\.[^/]+\/)?([A-Za-z0-9]{3,40})\//.exec(url || "") || [])[1] || null;
// kept small (your settings have a size limit): id, shape and a short title
const slim = g => ({ id: g.id, w: +g.w || 0, h: +g.h || 0, t: String(g.title || g.t || "").slice(0, 40) });
const favs = () => (Array.isArray(S.settings.favGifs) ? S.settings.favGifs : []);
const recents = () => (Array.isArray(S.settings.recentGifs) ? S.settings.recentGifs : []);
const isFav = id => favs().some(g => g.id === id);
let saver = () => {};
export function toggleFav(g) {
  const on = !isFav(g.id);
  S.settings.favGifs = on ? [slim(g), ...favs()].slice(0, 40) : favs().filter(x => x.id !== g.id);
  saver(); toast(on ? "⭐ Added to your favorite GIFs" : "Removed from favorites");
  return on;
}
function remember(g) { S.settings.recentGifs = [slim(g), ...recents().filter(x => x.id !== g.id)].slice(0, 20); saver(); }

// onPick({ url, w, h, title }); save(): keep your settings
export function pickGif(anchor, onPick, save) {
  closeGifs(); if (save) saver = save;
  const el = document.createElement("div"); el.className = "sx-stk sx-gifs"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "GIFs");
  let tab = favs().length ? "favs" : "trending", list = [], seq = 0;
  el.innerHTML = `<div class="sx-emoji-top"><label class="sx-search sm">${icon("search")}<input placeholder="Search GIPHY" spellcheck="false" aria-label="Search GIFs"></label></div>
    <div class="sx-gif-tabs" role="tablist"><button data-gt="trending">🔥 Trending</button><button data-gt="favs">⭐ Favorites</button><button data-gt="recent">🕘 Recent</button></div>
    <div class="sx-gif-grid" id="sxGifGrid"></div><div class="sx-gif-foot">Powered by GIPHY</div>`;
  document.body.appendChild(el);
  const grid = el.querySelector("#sxGifGrid"), input = el.querySelector("input");
  const paint = (empty) => {
    el.querySelectorAll("[data-gt]").forEach(b => { const on = !input.value.trim() && b.dataset.gt === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    if (!list.length) { grid.innerHTML = `<p class="sx-none">${esc(empty || "No GIFs found.")}</p>`; return; }
    const cols = [[], []], hgt = [0, 0];   // two columns, each GIF goes under the shorter one
    list.forEach((g, i) => { const c = hgt[0] <= hgt[1] ? 0 : 1; cols[c].push([g, i]); hgt[c] += (g.h || 1) / (g.w || 1); });
    grid.innerHTML = cols.map(c => `<div class="sx-gif-col">${c.map(([g, i]) => `<div class="sx-gif-item"><button class="sx-gif-pick" data-gi="${i}" title="${esc(g.title || "GIF")}" style="aspect-ratio:${g.w || 1}/${g.h || 1}"><img src="${esc(g.preview)}" alt="${esc(g.title || "GIF")}" loading="lazy" draggable="false"></button>
      <button class="sx-gif-star${isFav(g.id) ? " on" : ""}" data-gstar="${i}" title="${isFav(g.id) ? "Remove from favorites" : "Add to favorites"}" aria-label="Favorite">${icon("star")}</button></div>`).join("")}</div>`).join("");
  };
  const mine = arr => arr.map(g => ({ id: g.id, w: g.w, h: g.h, title: g.t, url: urlOf(g.id), preview: prevOf(g.id) }));
  const load = async () => {
    const q = input.value.trim(), my = ++seq;
    if (!q && tab === "favs") { list = mine(favs()); return paint("Star a GIF to keep it here: point at any GIF and click ⭐."); }
    if (!q && tab === "recent") { list = mine(recents()); return paint("GIFs you send show up here."); }
    grid.innerHTML = `<div class="sx-gif-col">${'<span class="sx-skel"></span>'.repeat(4)}</div><div class="sx-gif-col">${'<span class="sx-skel"></span>'.repeat(4)}</div>`;
    try { const r = await find(q); if (my !== seq) return; list = r; paint(); }
    catch (e) { if (my !== seq) return; list = []; paint(e.message === "no_gif_key" ? "GIFs aren't set up yet." : e.message === "offline" ? "Can't reach GIPHY. Check your internet." : "Couldn't load GIFs (GIPHY may be busy: try again in a bit)."); }
  };
  load();
  let t = 0; input.oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  el.addEventListener("click", e => {
    e.stopPropagation();
    const tb = e.target.closest("[data-gt]"); if (tb) { tab = tb.dataset.gt; input.value = ""; return load(); }
    const st = e.target.closest("[data-gstar]"); if (st) { const g = list[+st.dataset.gstar]; if (g) { const on = toggleFav(g); st.classList.toggle("on", on); if (!on && tab === "favs" && !input.value.trim()) load(); } return; }
    const b = e.target.closest("[data-gi]"); if (!b) return; const g = list[+b.dataset.gi]; if (!g) return;
    remember(g); onPick({ url: g.url, w: g.w, h: g.h, title: g.title || "" }); closeGifs();
  });
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px"; el.style.top = Math.max(8, r.top - h - 8) + "px";
  setTimeout(() => input.focus(), 10);
  const away = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeGifs(); };
  const esc_ = e => { if (e.key === "Escape") { e.stopPropagation(); closeGifs(); } };
  document.addEventListener("mousedown", away, true); document.addEventListener("keydown", esc_, true);
  open = { el, off: () => { document.removeEventListener("mousedown", away, true); document.removeEventListener("keydown", esc_, true); } };
}
export function closeGifs() { if (open) { open.off(); open.el.remove(); open = null; } }
// a GIF message: the picture at its own shape, at most 300 px wide, with a star to keep it
export const gifHtml = m => { const u = m.meta && m.meta.url || ""; if (!/^https:\/\/media[0-9]?\.giphy\.com\//.test(u)) return ""; const w = +m.meta.w || 0, h = +m.meta.h || 0, id = gifId(u);
  return `<div class="sx-gif"${w && h ? ` style="aspect-ratio:${w}/${h}"` : ""}><img src="${esc(u)}" alt="${esc(m.meta.title || "GIF")}" loading="lazy" draggable="false" data-anim>${id ? `<button class="sx-gif-star${isFav(id) ? " on" : ""}" data-gfav="${esc(id)}" data-w="${w}" data-h="${h}" data-t="${esc(m.meta.title || "")}" title="${isFav(id) ? "Remove from favorites" : "Add to your favorite GIFs"}" aria-label="Favorite GIF">${icon("star")}</button>` : ""}</div>`; };
// a star on a GIF in a chat
export function starFromChat(btn, save) { if (save) saver = save; const on = toggleFav({ id: btn.dataset.gfav, w: btn.dataset.w, h: btn.dataset.h, title: btn.dataset.t }); btn.classList.toggle("on", on); btn.title = on ? "Remove from favorites" : "Add to your favorite GIFs"; }
