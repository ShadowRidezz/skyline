// GIFs from GIPHY: a picker next to stickers (trending, or search), and how a GIF message is drawn.
// The search runs in Skyline's background process (GIPHY's key lives in social-config.json, like the server's).
import { esc, sky, toast } from "../util.js";
import { icon } from "./icons.js";

let open = null;
const unwrap = r => { if (!r || !r.ok) throw new Error(r ? r.error : "offline"); return r.data; };
const find = async q => unwrap(await sky.social.gifs(q || ""));

// onPick({ url, w, h, title })
export function pickGif(anchor, onPick) {
  closeGifs();
  const el = document.createElement("div"); el.className = "sx-stk sx-gifs"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "GIFs");
  el.innerHTML = `<div class="sx-emoji-top"><label class="sx-search sm">${icon("search")}<input placeholder="Search GIPHY" spellcheck="false" aria-label="Search GIFs"></label></div>
    <div class="sx-gif-grid" id="sxGifGrid"></div><div class="sx-gif-foot">Powered by GIPHY</div>`;
  document.body.appendChild(el);
  const grid = el.querySelector("#sxGifGrid"), input = el.querySelector("input");
  let seq = 0, list = [];
  const load = async q => {
    const my = ++seq; grid.innerHTML = `<div class="sx-gif-col">${'<span class="sx-skel"></span>'.repeat(4)}</div><div class="sx-gif-col">${'<span class="sx-skel"></span>'.repeat(4)}</div>`;
    try { list = await find(q); } catch (e) { if (my !== seq) return; grid.innerHTML = `<p class="sx-none">${esc(e.message === "no_gif_key" ? "GIFs aren't set up yet." : e.message === "offline" ? "Can't reach GIPHY. Check your internet." : "Couldn't load GIFs.")}</p>`; return; }
    if (my !== seq) return;
    if (!list.length) { grid.innerHTML = `<p class="sx-none">No GIFs found.</p>`; return; }
    const cols = [[], []], hgt = [0, 0];   // two columns, each GIF goes under the shorter one
    list.forEach((g, i) => { const c = hgt[0] <= hgt[1] ? 0 : 1; cols[c].push([g, i]); hgt[c] += (g.h || 1) / (g.w || 1); });
    grid.innerHTML = cols.map(c => `<div class="sx-gif-col">${c.map(([g, i]) => `<button class="sx-gif-pick" data-gi="${i}" title="${esc(g.title || "GIF")}" style="aspect-ratio:${g.w || 1}/${g.h || 1}"><img src="${esc(g.preview)}" alt="${esc(g.title || "GIF")}" loading="lazy" draggable="false"></button>`).join("")}</div>`).join("");
  };
  load("");
  let t = 0; input.oninput = () => { clearTimeout(t); t = setTimeout(() => load(input.value.trim()), 300); };
  el.addEventListener("click", e => { e.stopPropagation(); const b = e.target.closest("[data-gi]"); if (!b) return; const g = list[+b.dataset.gi]; if (!g) return; onPick({ url: g.url, w: g.w, h: g.h, title: g.title || "" }); closeGifs(); });
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px"; el.style.top = Math.max(8, r.top - h - 8) + "px";
  setTimeout(() => input.focus(), 10);
  const away = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeGifs(); };
  const esc_ = e => { if (e.key === "Escape") { e.stopPropagation(); closeGifs(); } };
  document.addEventListener("mousedown", away, true); document.addEventListener("keydown", esc_, true);
  open = { el, off: () => { document.removeEventListener("mousedown", away, true); document.removeEventListener("keydown", esc_, true); } };
}
export function closeGifs() { if (open) { open.off(); open.el.remove(); open = null; } }
// a GIF message: the picture at its own shape, at most 300 px wide
export const gifHtml = m => { const u = m.meta && m.meta.url || ""; if (!/^https:\/\/media[0-9]?\.giphy\.com\//.test(u)) return ""; const w = +m.meta.w || 0, h = +m.meta.h || 0;
  return `<div class="sx-gif"${w && h ? ` style="aspect-ratio:${w}/${h}"` : ""}><img src="${esc(u)}" alt="${esc(m.meta.title || "GIF")}" loading="lazy" draggable="false" data-anim></div>`; };
