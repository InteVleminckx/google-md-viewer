/* ---------- shared text helpers ---------- */
function escapeHtmlText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- heading slugs (used for markdown heading ids / outline anchors) ---------- */
function slugify(text) {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
  const count = State.headingSlugs.get(base) || 0;
  State.headingSlugs.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/* ---------- smartypants (skips fenced/inline code) ---------- */
function applySmartypants(md) {
  const segments = md.split(/(```[\s\S]*?```|`[^`]*`)/g);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // code segment, leave untouched
      return seg
        .replace(/---/g, "—")
        .replace(/--/g, "–")
        .replace(/(^|[\s(\["])'/g, "$1‘")
        .replace(/'/g, "’")
        .replace(/(^|[\s(\["])"/g, "$1“")
        .replace(/"/g, "”");
    })
    .join("");
}
