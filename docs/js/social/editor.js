// The profile editor: every change shows at once in the preview card, nothing is saved until "Save changes".
// Pictures (static or animated) upload to your own folder; Cancel throws away anything uploaded but not saved.
import { $, esc, toast, dialog } from "../util.js";
import { icon } from "./icons.js";
import { api, words } from "./api.js";
import { S, avatar } from "./state.js";
import { profileCard, THEMES, DECORATIONS, applyMotion } from "./profile.js";

const LIMITS = { avatar: 4 * 1048576, banner: 6 * 1048576, background: 6 * 1048576 };
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
let E = null;   // { host, orig, d, uploaded: Set, busy: {}, ctx }

const fromMe = () => {
  const m = S.me || {}, d = m.details || {};
  return { display_name: m.display_name || "", username: m.username || "", avatar: m.avatar || null, accent: m.accent || "#6d7cff",
    pronouns: d.pronouns || "", bio: d.bio || "", banner: d.banner || null, banner_pos: d.banner_pos ?? 50, banner_zoom: d.banner_zoom ?? 100,
    background: d.background || null, background_pos: d.background_pos ?? 50, theme: d.theme || "default", accent2: d.accent2 || "",
    decoration: d.decoration || "", games: Array.isArray(d.games) ? d.games.slice() : [], interests: Array.isArray(d.interests) ? d.interests.slice() : [],
    visibility: d.visibility || "everyone" };
};
const dirty = () => JSON.stringify(E.d) !== JSON.stringify(E.orig);

export function mountEditor(host, ctx) {
  E = { host, ctx, orig: fromMe(), d: fromMe(), uploaded: new Set(), busy: {} };
  host.innerHTML = `<div class="pe"><div class="pe-form" id="peForm"></div><aside class="pe-preview"><small>Preview: how others see your profile</small><div id="pePrev"></div></aside></div>`;
  form(); preview();
  host.oninput = onInput; host.onclick = onClick; host.onkeydown = onKey;
}
export const editorDirty = () => !!(E && E.host.isConnected && dirty());

function form() {
  const d = E.d, el = $("#peForm");
  const media = (kind, label, help) => `<div class="pe-media" data-media="${kind}">
      <div class="pe-media-prev" style="${d[kind] ? `background-image:url('${esc(d[kind])}')` : ""}"></div>
      <div><div class="pe-media-acts"><button class="btn sm" data-pe="upload:${kind}">${icon("image")}${d[kind] ? "Replace" : "Upload"} ${label}</button>${d[kind] ? `<button class="btn sm ghost" data-pe="clear:${kind}">Remove</button>` : ""}</div>
        <small class="muted">${help}</small>${E.busy[kind] ? `<div class="pe-progress" role="progressbar" aria-label="Uploading"><i></i></div>` : ""}</div></div>`;
  const slider = (key, label, min, max, unit = "%") => `<label class="pe-slider"><span>${label}</span><input type="range" class="rg" min="${min}" max="${max}" data-pe-k="${key}" value="${d[key]}"><output>${d[key]}${unit}</output></label>`;
  el.innerHTML = `
    <section class="pe-group"><h3>Basics</h3>
      <div class="pe-media" data-media="avatar">${avatar({ ...d }, 64, null, d.decoration)}
        <div><div class="pe-media-acts"><button class="btn sm" data-pe="upload:avatar">${icon("image")}${d.avatar ? "Replace" : "Upload"} picture</button>${d.avatar ? `<button class="btn sm ghost" data-pe="clear:avatar">Remove</button>` : ""}</div>
          <small class="muted">PNG, JPG, WebP or an animated GIF, up to 4 MB.</small>${E.busy.avatar ? `<div class="pe-progress" role="progressbar" aria-label="Uploading"><i></i></div>` : ""}</div></div>
      <div class="pe-row">
        <label class="sx-field"><span>Display name</span><input data-pe-k="display_name" maxlength="32" value="${esc(d.display_name)}" spellcheck="false"></label>
        <label class="sx-field"><span>Pronouns</span><input data-pe-k="pronouns" maxlength="40" value="${esc(d.pronouns)}" placeholder="Optional" spellcheck="false"></label>
      </div>
      <label class="sx-field"><span>Username</span><div class="sx-at"><i>@</i><input data-pe-k="username" maxlength="20" value="${esc(d.username)}" spellcheck="false" autocomplete="off"></div><small id="peUser">Your unique name. Friends add you with it.</small></label>
    </section>
    <section class="pe-group"><h3>About me</h3>
      <textarea class="pe-bio" data-pe-k="bio" maxlength="400" placeholder="A few words about you. **bold**, *italic* and links work.">${esc(d.bio)}</textarea>
      <div class="pe-count" id="peBioCount">${d.bio.length} / 400</div>
    </section>
    <section class="pe-group"><h3>Favorite games</h3>${tags("games", 8, 40, "Add a game and press Enter")}</section>
    <section class="pe-group"><h3>Interests</h3>${tags("interests", 12, 24, "Add an interest and press Enter")}</section>
    <section class="pe-group"><h3>Banner</h3>${media("banner", "banner", "Shown at the top of your profile. Animated GIFs work too, up to 6 MB.")}
      ${d.banner ? slider("banner_pos", "Position", 0, 100) + slider("banner_zoom", "Zoom", 100, 300) : ""}</section>
    <section class="pe-group"><h3>Look</h3>
      <div class="sx-field"><span>Theme</span><div class="pe-themes">${Object.entries(THEMES).map(([k, t]) => `<button class="pe-theme${d.theme === k ? " on" : ""}" data-pe="theme:${k}" aria-pressed="${d.theme === k}"><span style="background:linear-gradient(135deg,${t.a || d.accent},${t.b || "#15141d"})"></span>${t.name}</button>`).join("")}</div></div>
      <div class="pe-row">
        <label class="sx-field"><span>Accent colour</span><label class="sx-color"><input type="color" data-pe-k="accent" value="${esc(d.accent)}"><span class="sx-mono">${esc(d.accent)}</span></label></label>
        <label class="sx-field"><span>Second colour</span><label class="sx-color"><input type="color" data-pe-k="accent2" value="${esc(d.accent2 || "#15141d")}"><span class="sx-mono">${esc(d.accent2 || "from theme")}</span></label></label>
      </div>
      <div class="sx-field"><span>Avatar frame</span><div class="pe-decos">${DECORATIONS.map(([k, n]) => `<button class="pe-deco${d.decoration === k ? " on" : ""}" data-pe="deco:${k}" aria-pressed="${d.decoration === k}">${avatar({ ...d }, 38, null, k)}${n}</button>`).join("")}</div></div>
      <div class="sx-field"><span>Profile background</span>${media("background", "background", "A picture behind your profile, darkened so text stays readable.")}
        ${d.background ? slider("background_pos", "Position", 0, 100) : ""}</div>
    </section>
    <section class="pe-group"><h3>Who sees your profile</h3>
      <select class="sx-select" data-pe-k="visibility"><option value="everyone" ${d.visibility === "everyone" ? "selected" : ""}>Everyone signed in to Skyline</option><option value="friends" ${d.visibility === "friends" ? "selected" : ""}>Only friends (others see your name and picture)</option></select>
    </section>
    <div class="pe-bar"><button class="btn primary sm" data-pe="save" ${dirty() ? "" : "disabled"}>Save changes</button><button class="btn sm ghost" data-pe="cancel" ${dirty() ? "" : "disabled"}>Cancel</button>
      <small id="peState">${dirty() ? "Unsaved changes" : ""}</small><span class="sx-err" id="peErr" role="alert"></span></div>`;
}
const tags = (key, max, len, ph) => `<div class="pe-tags" data-tags="${key}">${E.d[key].map((t, i) => `<span class="pe-tag">${esc(t)}<button data-pe="untag:${key}:${i}" aria-label="Remove ${esc(t)}">${icon("x")}</button></span>`).join("")}
  ${E.d[key].length < max ? `<input data-tag-in="${key}" maxlength="${len}" placeholder="${ph}" spellcheck="false">` : ""}</div>`;

function preview() {
  const d = E.d;
  $("#pePrev").innerHTML = profileCard({ id: S.me.id, display_name: d.display_name || d.username, username: d.username, avatar: d.avatar, accent: d.accent, badges: S.me.badges, created_at: S.me.created_at },
    { ...d, accent2: d.accent2 || null, status_text: (S.me.details || {}).status_text, status_emoji: (S.me.details || {}).status_emoji }, { status: S.shown || "online" });
  applyMotion($("#pePrev"));
  const st = $("#peState"); if (st) st.textContent = dirty() ? "Unsaved changes" : "";
  E.host.querySelectorAll('[data-pe="save"], [data-pe="cancel"]').forEach(b => b.disabled = !dirty() || Object.values(E.busy).some(Boolean));
}

/* ---------- typing ---------- */
let userT = 0;
function onInput(e) {
  const t = e.target, k = t.dataset.peK; if (!k) return;
  let v = t.type === "range" ? +t.value : t.value;
  if (k === "accent" || k === "accent2") { const s = t.parentElement.querySelector("span"); if (s) s.textContent = v; }
  if (t.type === "range") t.nextElementSibling.textContent = v + "%";
  E.d[k] = v;
  if (k === "bio") $("#peBioCount").textContent = `${v.length} / 400`;
  if (k === "username") checkUser(v.trim());
  preview();
}
function checkUser(v) {
  clearTimeout(userT); const hint = $("#peUser"); hint.className = "";
  if (v === S.me.username) { hint.textContent = "Your unique name. Friends add you with it."; return; }
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(v) || /(^\.|\.$|\.\.)/.test(v)) { hint.className = "bad"; hint.textContent = words("username_invalid"); return; }
  hint.textContent = "Checking…";
  userT = setTimeout(async () => { try { const ok = await api.rpc("username_available", { p_username: v }); hint.className = ok ? "good" : "bad"; hint.textContent = ok ? `@${v} is available` : words("username_taken"); } catch (er) { hint.className = "bad"; hint.textContent = er.message; } }, 300);
}
function onKey(e) {
  const t = e.target, key = t.dataset && t.dataset.tagIn; if (!key) return;
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault(); const v = t.value.trim().replace(/[<>]/g, ""); if (!v) return;
    if (!E.d[key].some(x => x.toLowerCase() === v.toLowerCase())) E.d[key].push(v);
    form(); preview(); const i = E.host.querySelector(`[data-tag-in="${key}"]`); if (i) i.focus();
  } else if (e.key === "Backspace" && !t.value && E.d[key].length) { E.d[key].pop(); form(); preview(); const i = E.host.querySelector(`[data-tag-in="${key}"]`); if (i) i.focus(); }
}

/* ---------- buttons ---------- */
async function onClick(e) {
  const b = e.target.closest("[data-pe]"); if (!b) return;
  const [a, x, y] = b.dataset.pe.split(":");
  if (a === "upload") return upload(x);
  if (a === "clear") { E.d[x] = null; form(); preview(); return; }
  if (a === "theme") { E.d.theme = x; form(); preview(); return; }
  if (a === "deco") { E.d.decoration = x; form(); preview(); return; }
  if (a === "untag") { E.d[x].splice(+y, 1); form(); preview(); return; }
  if (a === "cancel") return cancel();
  if (a === "save") return save(b);
}
export function pickProfilePicture() { if (E && E.host.isConnected) upload("avatar"); }

function upload(kind) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = TYPES.join(",");
  inp.onchange = () => { if (inp.files[0]) uploadFile(kind, inp.files[0]); };
  inp.click();
}
export async function uploadFile(kind, file) {
  {
    if (!TYPES.includes(file.type)) return toast("Use a PNG, JPG, WebP or GIF picture.", true);
    if (file.size > 30 * 1048576) return toast("That picture is too big.", true);
    E.busy[kind] = true; form(); preview();
    try {
      let bytes = await prepare(kind, file);
      if (bytes.byteLength > LIMITS[kind]) throw new Error(`That picture is too big after resizing (${(LIMITS[kind] / 1048576)} MB max${file.type === "image/gif" ? " for animated pictures" : ""}).`);
      const r = await api.upload(kind, bytes);
      E.uploaded.add(r.url); E.d[kind] = r.url;
      if (kind === "banner") { E.d.banner_pos = 50; E.d.banner_zoom = 100; }
    } catch (er) { toast(er.message, true); }
    E.busy[kind] = false; form(); preview();
  }
}
// still pictures are resized here (an avatar to a 512 px square, a banner to 1500 px wide); animated ones go up as they are
async function prepare(kind, file) {
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
  const animated = file.type === "image/gif" || (file.type === "image/webp" && new TextDecoder().decode(u8.slice(0, 64)).includes("ANIM")) ;
  if (animated) return buf;
  const bmp = await createImageBitmap(file);
  let w, h, sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (kind === "avatar") { const side = Math.min(bmp.width, bmp.height); sx = (bmp.width - side) / 2; sy = (bmp.height - side) / 2; sw = sh = side; w = h = Math.min(512, side); }
  else { const max = 1500; w = Math.min(max, bmp.width); h = Math.round(bmp.height * w / bmp.width); }
  const cv = new OffscreenCanvas(w, h), g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  return (await cv.convertToBlob({ type: "image/webp", quality: .88 })).arrayBuffer();
}

async function cancel() {
  for (const url of E.uploaded) if (url !== E.orig.avatar && url !== E.orig.banner && url !== E.orig.background) api.removeMedia(url).catch(() => {});
  E.uploaded.clear(); E.d = JSON.parse(JSON.stringify(E.orig)); form(); preview(); toast("Changes discarded");
}
async function save(btn) {
  const d = E.d, o = E.orig, err = $("#peErr"); err.textContent = "";
  if (!d.display_name.trim()) { err.textContent = "Your display name can't be empty."; return; }
  btn.disabled = true;
  try {
    const base = {};
    if (d.display_name !== o.display_name) base.p_display_name = d.display_name.trim();
    if (d.username !== o.username) base.p_username = d.username.trim();
    if (d.avatar !== o.avatar) { if (d.avatar) base.p_avatar = d.avatar; else base.p_clear_avatar = true; }
    if (d.accent !== o.accent) base.p_accent = d.accent;
    if (Object.keys(base).length) await api.rpc("update_profile", base);
    const det = {};
    for (const k of ["pronouns", "bio", "banner", "banner_pos", "banner_zoom", "background", "background_pos", "theme", "accent2", "decoration", "games", "interests", "visibility"])
      if (JSON.stringify(d[k]) !== JSON.stringify(o[k])) det[k] = d[k] === null ? "" : d[k];
    if (Object.keys(det).length) await api.rpc("update_profile_details", { p_data: det });
    // tidy up pictures that were replaced or never used
    for (const url of [o.avatar, o.banner, o.background, ...E.uploaded]) if (url && /^https:/.test(url) && ![d.avatar, d.banner, d.background].includes(url)) api.removeMedia(url).catch(() => {});
    E.uploaded.clear();
    await E.ctx.reloadMe(); E.orig = fromMe(); E.d = fromMe(); form(); preview(); toast("Profile saved");
  } catch (er) { err.textContent = er.message; btn.disabled = false; }
}
export async function confirmLeave() {
  if (!editorDirty()) return true;
  const go = await dialog({ title: "Discard your profile changes?", text: "You have unsaved changes to your profile.", ok: "Discard", danger: true });
  if (go) await cancel();
  return go;
}
