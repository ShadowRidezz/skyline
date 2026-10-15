// A person's profile card (banner, avatar and frame, name, status, About Me, games, interests), used in the side panel
// and as the live preview in the profile editor; plus the custom status picker.
import { $, esc, toast } from "../util.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { S, avatar, badgesHtml, STATUS } from "./state.js";
import { pickEmoji } from "./emoji.js";

export const THEMES = {
  default: { name: "Accent", a: null, b: null },
  midnight: { name: "Midnight", a: "#5b6cff", b: "#0f1530" },
  aurora: { name: "Aurora", a: "#3fd0a6", b: "#5b4bdb" },
  ember: { name: "Ember", a: "#f07a4a", b: "#7a1f3d" },
  rose: { name: "Rose", a: "#ec6a9c", b: "#6d3bb0" },
  forest: { name: "Forest", a: "#58b368", b: "#1f3d2c" },
  mono: { name: "Mono", a: "#d4d4d8", b: "#27272a" },
};
export const DECORATIONS = [["", "None"], ["halo", "Halo"], ["ember", "Ember"], ["neon", "Neon"], ["gold", "Gold"], ["frost", "Frost"], ["orbit", "Orbit"], ["sakura", "Sakura"]];

// About Me: plain text with **bold**, *italic*, `code` and links; never HTML
export function bioHtml(t) {
  return esc(t || "")
    .replace(/`([^`\n]{1,80})`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]{1,200})\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]{1,200})\*(?=[\s).,!?]|$)/g, "$1<i>$2</i>")
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, u => `<a href="#" data-link="${u}">${u.replace(/^https?:\/\//, "")}</a>`);
}
export const statusHtml = d => d && (d.status_text || d.status_emoji) ? `<span class="pc-status">${d.status_emoji ? `<span class="pc-status-e">${esc(d.status_emoji)}</span>` : ""}<span>${esc(d.status_text || "")}</span></span>` : "";
const dateLong = t => new Date(t).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

// p: profile fields; d: details; opts: { status, relation, friendsSince, actions, me, preview }
export function profileCard(p, d = {}, opts = {}) {
  const th = THEMES[d.theme] || THEMES.default, a = th.a || p.accent || "#6d7cff", b = d.accent2 || th.b || "#15141d";
  const banner = d.banner ? `<div class="pc-banner-img" style="background-image:url('${esc(d.banner)}');background-position:50% ${+d.banner_pos || 50}%;background-size:${Math.max(100, +d.banner_zoom || 100)}% auto"></div>` : "";
  const games = Array.isArray(d.games) ? d.games : [], ints = Array.isArray(d.interests) ? d.interests : [];
  const st = opts.status && STATUS[opts.status] ? opts.status : null;
  const section = (h, inner) => inner ? `<section class="pc-sec"><h4>${h}</h4>${inner}</section>` : "";
  return `<article class="pc theme-${esc(d.theme || "default")}${d.background ? " has-bg" : ""}" style="--pc-a:${esc(a)};--pc-b:${esc(b)}">
    <div class="pc-banner">${banner}</div>
    ${d.background ? `<div class="pc-bg" style="background-image:url('${esc(d.background)}');background-position:50% ${+d.background_pos || 50}%"></div>` : ""}
    <div class="pc-head">
      <div class="pc-av">${avatar(p, 84, st, d.decoration)}</div>
      ${opts.headActions || ""}
    </div>
    <div class="pc-body">
      <div class="pc-names"><h3>${esc(p.display_name || p.username)}</h3>${d.pronouns ? `<span class="pc-pron">${esc(d.pronouns)}</span>` : ""}</div>
      <button class="pc-user" data-sx="copy:${esc(p.username)}" title="Copy username">@${esc(p.username)}${icon("copy")}</button>
      ${p.badges && p.badges.length ? `<div class="pc-badges">${badgesHtml(p.badges)}</div>` : ""}
      ${statusHtml(d)}
      ${d.hidden ? `<p class="pc-hidden">${icon("shield")}Only friends can see the rest of this profile.</p>` : ""}
      ${section("About me", d.bio ? `<div class="pc-bio selectable">${bioHtml(d.bio)}</div>` : "")}
      ${section("Favorite games", games.length ? `<div class="pc-chips">${games.map(g => `<span class="pc-chip">${icon("gamepad")}${esc(g)}</span>`).join("")}</div>` : "")}
      ${section("Interests", ints.length ? `<div class="pc-chips">${ints.map(g => `<span class="pc-chip">${esc(g)}</span>`).join("")}</div>` : "")}
      <section class="pc-sec pc-facts">
        ${p.created_at ? `<div><h4>Member since</h4><b>${dateLong(p.created_at)}</b></div>` : ""}
        ${opts.friendsSince ? `<div><h4>Friends since</h4><b>${dateLong(opts.friendsSince)}</b></div>` : ""}
      </section>
      ${opts.actions || ""}
    </div>
  </article>`;
}

/* ---------- animated avatars and banners: always, on hover, or never (and never with reduced motion) ---------- */
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
export function motionMode() { const m = (S.settings.motion || {}).avatars || "always"; return reduce.matches ? "never" : m; }
export function applyMotion(root = document) {
  const mode = motionMode();
  document.body.dataset.sxAnim = mode;
  if (mode === "always") return;
  root.querySelectorAll("img[data-anim]:not([data-frozen])").forEach(img => {
    const go = () => {
      try {
        const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0); img.dataset.frozen = c.toDataURL(); img.dataset.live = img.src; img.src = img.dataset.frozen;
      } catch (e) { img.dataset.frozen = "x"; }   // (a picture we can't read stays as it is)
    };
    if (img.complete && img.naturalWidth) go(); else img.addEventListener("load", go, { once: true });
  });
}
document.addEventListener("mouseover", e => {   // "on hover": animate while the pointer is on it
  if (motionMode() !== "hover") return;
  const img = e.target.closest && e.target.closest(".sx-av img[data-live], .pc-av img[data-live]"); if (!img || img.dataset.playing) return;
  img.dataset.playing = "1"; const still = img.src; img.src = img.dataset.live;
  img.closest(".sx-av").addEventListener("mouseleave", () => { img.src = still; delete img.dataset.playing; }, { once: true });
});

/* ---------- custom status ---------- */
const CLEAR = [["", "Don't clear"], ["30", "30 minutes"], ["60", "1 hour"], ["240", "4 hours"], ["today", "Today"], ["10080", "This week"]];
export function statusDialog({ onSaved, setPresence } = {}) {
  const d = (S.me && S.me.details) || {}, m = $("#dlg");
  let emoji = d.status_emoji || "";
  m.innerHTML = `<div class="dlg-box sx-status-dlg" role="dialog" aria-modal="true" aria-label="Set a custom status">
    <div class="sx-add-head"><h3>Set a status</h3><span class="sp"></span><button class="ibtn" data-st="close" aria-label="Close">${icon("x")}</button></div>
    <div class="sx-status-in"><button class="sx-status-emoji" data-st="emoji" title="Pick an emoji" aria-label="Pick an emoji">${emoji ? esc(emoji) : icon("sparkle")}</button>
      <input id="sxStText" maxlength="80" placeholder="What's happening?" value="${esc(d.status_text || "")}" spellcheck="true"><button class="ibtn sm" data-st="clearfield" aria-label="Clear">${icon("x")}</button></div>
    <div class="sx-status-quick">${[["🎮", "Playing games"], ["📚", "Studying"], ["🛠️", "Working on a project"], ["🎧", "Listening to music"], ["🌙", "Away for a bit"], ["💬", "Free to chat"]]
      .map(([e, t]) => `<button class="sx-chip-btn" data-st="quick" data-e="${e}" data-t="${esc(t)}">${e} ${esc(t)}</button>`).join("")}</div>
    <label class="sx-field"><span>Clear after</span><select class="sx-select" id="sxStClear">${CLEAR.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
    <div class="sx-field"><span>Online status</span><div class="sx-presence">${[["online", "Online"], ["away", "Away"], ["dnd", "Do not disturb"], ["invisible", "Invisible"]].map(([v, l]) =>
      `<label><input type="radio" name="sxPres" value="${v}" ${(S.settings.status || "online") === v ? "checked" : ""}><span class="sx-menu-dot ${v === "invisible" ? "offline" : v}"></span>${l}</label>`).join("")}</div></div>
    <div class="dlg-acts"><button class="btn ghost" data-st="remove">Clear status</button><span class="sp"></span><button class="btn ghost" data-st="close">Cancel</button><button class="btn primary" data-st="save">Save</button></div></div>`;
  m.classList.remove("hidden"); $("#sxStText").focus();
  const close = () => { m.classList.add("hidden"); m.onclick = null; };
  const minutes = v => v === "" ? null : v === "today" ? Math.max(1, Math.round((new Date().setHours(23, 59, 59, 999) - Date.now()) / 60000)) : +v;
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-st]"); if (!b) return;
    const a = b.dataset.st;
    if (a === "close") return close();
    if (a === "emoji") return pickEmoji(b, x => { emoji = x; b.textContent = x; });
    if (a === "clearfield") { $("#sxStText").value = ""; emoji = ""; m.querySelector(".sx-status-emoji").innerHTML = icon("sparkle"); return; }
    if (a === "quick") { emoji = b.dataset.e; $("#sxStText").value = b.dataset.t; m.querySelector(".sx-status-emoji").textContent = emoji; return; }
    if (a === "save" || a === "remove") {
      b.disabled = true;
      const text = a === "remove" ? "" : $("#sxStText").value.trim(), em = a === "remove" ? "" : emoji;
      try {
        await api.rpc("set_status", { p_text: text, p_emoji: em, p_minutes: text || em ? minutes($("#sxStClear").value) : null });
        const pres = m.querySelector("input[name=sxPres]:checked"); if (pres && setPresence && pres.value !== (S.settings.status || "online")) await setPresence(pres.value);
        close(); toast(text || em ? "Status set" : "Status cleared"); if (onSaved) onSaved();
      } catch (er) { b.disabled = false; toast(er.message, true); }
    }
  };
  $("#sxStText").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); m.querySelector('[data-st="save"]').click(); } };
}
