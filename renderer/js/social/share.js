// Sharing something from elsewhere in Skyline into a conversation: pick a friend or a server channel, and the
// picture goes there as a message (with an optional line of text). Used by the weekly game stats card.
import { $, esc, toast } from "../util.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { S, avatar, statusOf } from "./state.js";

export async function shareImage({ title, blob, name, text }) {
  if (!S.me) { toast("Sign in to Social first (the Social tab).", true); return; }
  const preview = URL.createObjectURL(blob);
  const targets = [
    ...S.friends.map(f => ({ kind: "dm", id: f.id, label: f.display_name, sub: "@" + f.username, av: avatar(f, 30, statusOf(f)) })),
    ...(S.servers || []).flatMap(sv => sv.channels.filter(c => c.kind !== "voice").map(c => ({ kind: "ch", id: c.id, server: sv.id, label: "#" + c.name, sub: sv.name, av: `<span class="sx-share-hash">${icon("hash")}</span>` }))),
  ];
  const m = $("#dlg");
  m.innerHTML = `<div class="dlg-box sx-share-dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sx-add-head"><h3>${esc(title)}</h3><span class="sp"></span><button class="ibtn" data-s="close" aria-label="Close">${icon("x")}</button></div>
    ${/^video\//.test(blob.type) ? `<video class="sx-share-prev" src="${preview}" controls muted></video>` : `<img class="sx-share-prev" src="${preview}" alt="">`}
    <label class="sx-field"><span>Message (optional)</span><input id="sxShareText" maxlength="300" value="${esc(text || "")}" autocomplete="off"></label>
    <div class="sx-share-list">${targets.length ? targets.map((t, i) => `<div class="sx-row static">${t.av}<span class="sx-row-t"><b>${esc(t.label)}</b><small>${esc(t.sub)}</small></span><span class="sx-row-acts show"><button class="btn sm primary" data-s="send:${i}">Send</button></span></div>`).join("")
      : `<p class="sx-none">Add a friend or join a server first.</p>`}</div></div>`;
  m.classList.remove("hidden");
  const close = () => { m.classList.add("hidden"); m.onclick = null; URL.revokeObjectURL(preview); document.removeEventListener("keydown", key, true); };
  const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", key, true);
  m.onclick = async e => {
    if (e.target === m) return close();
    const b = e.target.closest("[data-s]"); if (!b) return;
    const [a, x] = b.dataset.s.split(":");
    if (a === "close") return close();
    if (a !== "send") return;
    const t = targets[+x]; b.disabled = true; b.textContent = "Sending…";
    try {
      const bytes = await blob.arrayBuffer(), img = /^image\//.test(blob.type) ? await createImageBitmap(blob) : null;
      const up = await api.attach(t.kind === "dm" ? t.id : "srv:" + t.server, name, bytes);
      const meta = { files: [{ path: up.path, name: up.name, type: up.type, size: up.size, ...(img ? { w: img.width, h: img.height } : {}) }] }, body = ($("#sxShareText").value || "").trim();
      const client = "sh" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (t.kind === "dm") await api.rpc("send_message", { p_to: t.id, p_body: body, p_client_id: client, p_kind: "attachment", p_meta: meta });
      else await api.rpc("send_channel_message", { p_channel: t.id, p_body: body, p_client_id: client, p_kind: "attachment", p_meta: meta });
      b.textContent = "Sent"; toast(`Sent to ${t.label}`);
    } catch (er) { toast(er.message, true); b.disabled = false; b.textContent = "Send"; }
  };
}
