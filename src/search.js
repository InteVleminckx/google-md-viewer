/* ---------- full-text search ---------- */
function collectFileNodes(node, out) {
  for (const child of node.children || []) {
    if (child.kind === "file") out.push(child);
    else collectFileNodes(child, out);
  }
  return out;
}

async function searchFsapiTree(tree, query) {
  const needle = query.toLowerCase();
  const files = collectFileNodes(tree, []);
  const results = [];

  for (const file of files) {
    if (results.length >= 50) break;
    try {
      const f = await file.handle.getFile();
      const text = await f.text();
      const lines = text.split("\n");
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (matches.length >= 3) break;
        }
      }
      if (matches.length) results.push({ name: file.name, relPath: file.name, matches, node: file });
    } catch {
      /* unreadable file, skip */
    }
  }
  return results;
}

async function runContentSearch(query) {
  const resultsEl = document.getElementById("search-results");
  if (!query) {
    resultsEl.innerHTML = '<p class="hint">Type to search across all open markdown files.</p>';
    return;
  }
  if (!State.tree) {
    resultsEl.innerHTML = '<p class="hint">Open a folder first.</p>';
    return;
  }
  resultsEl.innerHTML = '<p class="hint">Searching…</p>';

  try {
    let results;
    if (State.mode === "server") {
      const { results: r } = await serverFetch("/search", { dir: State.serverRootDir, q: query });
      results = r;
    } else {
      results = await searchFsapiTree(State.tree, query);
    }
    renderSearchResults(results, query);
  } catch (err) {
    resultsEl.innerHTML = `<p class="hint">Search failed: ${escapeHtmlText(err.message)}</p>`;
  }
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtmlText(text);
  return (
    escapeHtmlText(text.slice(0, idx)) +
    "<mark>" +
    escapeHtmlText(text.slice(idx, idx + query.length)) +
    "</mark>" +
    escapeHtmlText(text.slice(idx + query.length))
  );
}

function renderSearchResults(results, query) {
  const resultsEl = document.getElementById("search-results");
  if (!results.length) {
    resultsEl.innerHTML = '<p class="hint">No matches found.</p>';
    return;
  }
  resultsEl.innerHTML = "";
  results.forEach((r) => {
    const div = document.createElement("div");
    div.className = "search-result";
    div.innerHTML = `
      <div class="sr-name">📄 ${escapeHtmlText(r.name)}</div>
      <div class="sr-path">${escapeHtmlText(r.relPath || "")}</div>
      ${r.matches.map((m) => `<div class="sr-match">L${m.line}: ${highlightMatch(m.text, query)}</div>`).join("")}
    `;
    div.addEventListener("click", () => openSearchResult(r));
    resultsEl.appendChild(div);
  });
}

async function openSearchResult(r) {
  document.querySelectorAll(".tree-node.active").forEach((n) => n.classList.remove("active"));
  if (r.path) {
    await openFileServer(r.path, r.name);
    const el = document.querySelector(`#file-tree [data-path="${CSS.escape(r.path)}"]`);
    if (el) el.classList.add("active");
  } else if (r.node) {
    await openFileHandle(r.node.handle, r.node.handle.name);
    const el = document.querySelector(`#file-tree [data-path="${CSS.escape(r.node.handle.name)}"]`);
    if (el) el.classList.add("active");
  }
}
