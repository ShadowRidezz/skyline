// Finds the question that's on screen on IXL / Sadlier and turns it into text + answer choices.
// Reads only what's visible in the question area: never what's typed into boxes, never passwords or other pages.
(function () {
  const SKIP = "script, style, noscript, template, input, textarea, select, [type=password], [aria-hidden=true], .practice-item-hidden, .correct-answer-explanation-container, .scratchpad-container";
  const shown = el => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity !== 0; };
  // visible text of an element, with pictures' alt text and labelled images, in reading order
  function text(root, exclude = []) {
    const out = [];
    const walk = node => {
      if (node.nodeType === 3) { const t = node.nodeValue.replace(/\s+/g, " "); if (t) out.push(t); return; }
      if (node.nodeType !== 1 || node.matches(SKIP) || exclude.includes(node)) return;
      if (node.closest && node !== root && !shown(node) && !node.matches("span, sup, sub")) return;
      if (node.matches("img[alt], [role=img][aria-label]")) { const a = node.getAttribute("alt") || node.getAttribute("aria-label"); if (a && !/^(tick mark|image|icon)$/i.test(a.trim())) out.push(" " + a.trim() + " "); return; }
      if (node.matches("sup")) { out.push("^"); }
      if (node.matches("br, p, div, li, tr, h1, h2, h3, h4, section")) out.push("\n");
      for (const c of node.childNodes) walk(c);
      if (node.matches("p, div, li, tr, h1, h2, h3, h4, section")) out.push("\n");
    };
    walk(root);
    return out.join("").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").replace(/\s*,\s*,\s*/g, ", ").trim();
  }
  // things a text copy can't capture: drawn math, graphs, pictures without a description
  function unreadable(root, t) {
    if (/�|[-]/.test(t)) return true;
    const pics = [...root.querySelectorAll("canvas, svg, img")].filter(e => shown(e) && e.getBoundingClientRect().width > 40 && !(e.getAttribute("alt") || e.getAttribute("aria-label")));
    return pics.length > 0;
  }
  function choicesIn(root) {
    const sets = [
      () => [...root.querySelectorAll(".TileMultipleChoices .tile, .TileMultipleChoices [role=button], [class*=MultipleChoice] [class*=tile]")],
      () => [...root.querySelectorAll("[role=radio], [role=option]")],
      () => [...root.querySelectorAll("label")].filter(l => l.querySelector("input[type=radio], input[type=checkbox]") || (l.htmlFor && root.ownerDocument.getElementById(l.htmlFor)?.matches("input[type=radio], input[type=checkbox]"))),
    ];
    for (const s of sets) { let els = s().filter(shown); els = els.filter(e => !els.some(o => o !== e && e.contains(o)));   // the innermost ones (not the box around them)
      if (els.length >= 2 && els.length <= 10) return els; }
    return [];
  }
  function build(site, root, skill) {
    const ch = choicesIn(root), choices = ch.map(e => text(e).replace(/^(Option,?\s*)/i, "").trim()).filter(Boolean);
    let q = text(root, ch).replace(/\b(Submit|Check|Next|Skip|Learn with an example|or|Watch a video)\s*$/gim, "").replace(/\n?(Submit|Learn with an example)\n?/g, "\n").trim();
    const blanks = [...root.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, [contenteditable=true]")].filter(shown).length;
    const r = root.getBoundingClientRect();
    return { site, skill: (skill || "").trim(), question: q.slice(0, 3000), choices, kind: choices.length ? "multiple-choice" : blanks ? "fill-in" : "other", blanks,
      needsScreen: unreadable(root, q) || q.length < 8, rect: { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 }, sig: (skill || "") + "|" + q.slice(0, 400) + "|" + choices.join("|") };
  }
  function ixl(doc) {
    const roots = [...doc.querySelectorAll(".question-and-submission-view .ixl-practice-crate, .question-component .ixl-practice-crate, .question-and-submission-view")];
    const root = roots.find(e => shown(e) && !e.closest(".practice-item-hidden, .correct-answer-explanation-container"));
    if (!root) return null;
    const skill = doc.querySelector(".breadcrumb-skill-name, .skill-tree-skill-name, h1")?.textContent || "";
    return build("IXL", root, skill);
  }
  // Sadlier (and any other page): the visible block that looks most like a question
  function generic(doc, site) {
    const sel = "[class*=question i], [class*=Question], [class*=prompt i], [class*=item-body i], [class*=stem i], [role=main], main, article";
    const cands = [...doc.querySelectorAll(sel)].filter(shown).map(e => ({ e, t: text(e) })).filter(c => c.t.length >= 12 && c.t.length <= 4000);
    if (!cands.length) return null;
    // prefer the smallest block that still has a question in it (a "?" or answer choices)
    cands.sort((a, b) => (/\?|_{2,}|choose|select|which|what|find|solve/i.test(b.t) - /\?|_{2,}|choose|select|which|what|find|solve/i.test(a.t)) || a.t.length - b.t.length);
    // the answer choices are often next to the question text, not inside it: widen to the block that holds both
    let root = cands[0].e;
    for (let up = root.parentElement, i = 0; up && i < 4 && up !== doc.body; up = up.parentElement, i++) if (up.querySelectorAll("input[type=radio], input[type=checkbox], [role=radio]").length >= 2 && text(up).length <= 4000) { root = up; break; }
    const skill = doc.querySelector("h1, [class*=title i]")?.textContent?.slice(0, 80) || "";
    return build(site, root, skill);
  }
  function extract(doc = document, hostOverride) {   // (tests pass the site's host name for a saved copy of a page)
    const host = hostOverride || (doc.location && doc.location.hostname) || "";
    if (/(^|\.)ixl\.com$/.test(host)) return ixl(doc) || generic(doc, "IXL");
    if (/sadlier/.test(host)) return generic(doc, "Sadlier");
    return generic(doc, host || "page");
  }
  globalThis.SkyExtract = { extract, text };
})();
