/* ---------- file tree ---------- */
async function buildTree(dirHandle, depth = 0) {
  const node = { name: dirHandle.name, kind: "directory", handle: dirHandle, children: [] };
  const entries = [];
  for await (const entry of dirHandle.values()) {
    entries.push(entry);
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  for (const entry of entries) {
    if (entry.kind === "directory") {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      if (depth > 12) continue;
      const child = await buildTree(entry, depth + 1);
      if (child.children.length) node.children.push(child);
    } else if (MD_EXT.test(entry.name)) {
      node.children.push({ name: entry.name, kind: "file", handle: entry, children: [] });
    }
  }
  return node;
}

function renderTree(node, container, filter) {
  container.innerHTML = "";
  const rootUl = document.createElement("ul");
  const anyRendered = renderTreeNode(node, rootUl, filter, true);
  container.appendChild(rootUl);
  if (!anyRendered) {
    container.innerHTML = '<p class="hint">No matching markdown files.</p>';
  }
}

function nodeMatchesFilter(node, filter) {
  if (!filter) return true;
  if (node.kind === "file") return node.name.toLowerCase().includes(filter);
  return node.children.some((c) => nodeMatchesFilter(c, filter));
}

function renderTreeNode(node, ul, filter, isRoot) {
  let renderedAny = false;
  const children = isRoot ? node.children : node.children;
  for (const child of children) {
    if (!nodeMatchesFilter(child, filter)) continue;
    renderedAny = true;
    const li = document.createElement("li");
    const div = document.createElement("div");
    div.className = `tree-node ${child.kind}`;

    if (child.kind === "directory") {
      div.innerHTML = `<span class="caret">▾</span><span>📂 ${child.name}</span>`;
      li.appendChild(div);
      const childUl = document.createElement("ul");
      renderTreeNode(child, childUl, filter, false);
      li.appendChild(childUl);
      div.addEventListener("click", () => {
        const collapsed = childUl.style.display === "none";
        childUl.style.display = collapsed ? "" : "none";
        div.querySelector(".caret").textContent = collapsed ? "▾" : "▸";
      });
    } else {
      div.innerHTML = `<span class="caret"></span><span>📄 ${child.name}</span>`;
      div.dataset.path = child.absPath || child.name;
      div.addEventListener("click", () => openFileFromTree(child, div));
      li.appendChild(div);
    }
    ul.appendChild(li);
  }
  return renderedAny;
}

async function openFileFromTree(node, el) {
  document.querySelectorAll(".tree-node.active").forEach((n) => n.classList.remove("active"));
  el.classList.add("active");
  if (node.absPath) {
    await openFileServer(node.absPath, node.name);
  } else {
    await openFileHandle(node.handle, node.handle.name);
  }
}

function findFirstFile(node) {
  for (const child of node.children) {
    if (child.kind === "file") return child;
  }
  for (const child of node.children) {
    if (child.kind === "directory") {
      const found = findFirstFile(child);
      if (found) return found;
    }
  }
  return null;
}
