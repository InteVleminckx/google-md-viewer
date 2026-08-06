/* ---------- wiki-style [[links]] ---------- */
function applyWikilinks(text) {
  const segments = text.split(/(```[\s\S]*?```|`[^`]*`)/g);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, target, _p2, label) => {
        const display = (label || target).trim();
        return `[${display}](wikilink:${encodeURIComponent(target.trim())})`;
      });
    })
    .join("");
}

function baseNameNoExt(name) {
  return name.replace(MD_EXT, "");
}

function findFileNodeByBaseName(tree, target) {
  if (!tree) return null;
  const needle = target.toLowerCase();
  let found = null;
  (function walk(node) {
    if (found) return;
    for (const child of node.children || []) {
      if (found) return;
      if (child.kind === "file") {
        if (baseNameNoExt(child.name).toLowerCase() === needle) {
          found = child;
          return;
        }
      } else {
        walk(child);
      }
    }
  })(tree);
  return found;
}

/* ---------- wiki-link navigation ---------- */
async function resolveAndOpenWikilink(target) {
  const node = findFileNodeByBaseName(State.tree, target);
  if (!node) return;
  document.querySelectorAll(".tree-node.active").forEach((n) => n.classList.remove("active"));
  const key = node.absPath || node.name;
  if (node.absPath) {
    await openFileServer(node.absPath, node.name);
  } else {
    await openFileHandle(node.handle, node.handle.name);
  }
  const el = document.querySelector(`#file-tree [data-path="${CSS.escape(key)}"]`);
  if (el) el.classList.add("active");
}
