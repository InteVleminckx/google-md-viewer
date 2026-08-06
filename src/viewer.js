/* ---------- tiny IndexedDB helper for persisting file/dir handles ---------- */
const IDB = {
  dbPromise: null,
  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("mdviewer", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("handles");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  },
  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readonly");
      const req = tx.objectStore("handles").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
};

const EXCLUDED_DIRS = new Set([".git", "node_modules", ".obsidian", ".venv", "__pycache__", "dist", "build", ".next"]);
const MD_EXT = /\.(md|markdown|mdx)$/i;

/* ---------- app state ---------- */
const State = {
  mode: "fsapi", // "fsapi" (File System Access API) or "server" (local helper server via mdopen CLI)
  rootHandle: null,
  rootName: "",
  tree: null,
  currentFileHandle: null,
  currentFilePath: "",
  currentDirHandle: null,
  autoRefreshTimer: null,
  lastModified: null,
  headingSlugs: null,
  serverBase: null,
  serverToken: null,
  currentServerPath: null,
  serverRootDir: null,
};

/* ---------- local helper server (mdopen CLI) ---------- */
async function serverFetch(pathname, params) {
  const qs = new URLSearchParams({ ...params, token: State.serverToken });
  const res = await fetch(`${State.serverBase}${pathname}?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request to ${pathname} failed (${res.status})`);
  }
  return res.json();
}

function convertServerTree(node) {
  return {
    name: node.name,
    kind: node.kind,
    absPath: node.path,
    children: (node.children || []).map(convertServerTree),
  };
}

function dirnameOf(absPath) {
  const idx = absPath.lastIndexOf("/");
  return idx === -1 ? absPath : absPath.slice(0, idx);
}

/* ---------- slug + heading ids ---------- */
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

/* ---------- frontmatter ---------- */
function escapeHtmlText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripYamlQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseSimpleYaml(yamlText) {
  const result = {};
  let currentKey = null;
  for (const rawLine of yamlText.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(rawLine);
    if (listItem && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(stripYamlQuotes(listItem[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    if (kv) {
      const key = kv[1];
      const value = kv[2].trim();
      currentKey = key;
      if (value === "") {
        result[key] = "";
      } else if (/^\[.*\]$/.test(value)) {
        result[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => stripYamlQuotes(s.trim()))
          .filter(Boolean);
      } else {
        result[key] = stripYamlQuotes(value);
      }
    }
  }
  return result;
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: null, body: text };
  return { meta: parseSimpleYaml(match[1]), body: text.slice(match[0].length) };
}

function buildFrontmatterHtml(meta) {
  if (!meta || !Object.keys(meta).length) return "";
  const rows = Object.entries(meta)
    .map(([key, value]) => {
      const val = Array.isArray(value) ? value.map(escapeHtmlText).join(", ") : escapeHtmlText(value);
      return `<tr><td class="fm-key">${escapeHtmlText(key)}</td><td>${val}</td></tr>`;
    })
    .join("");
  return `<div class="frontmatter-card"><table>${rows}</table></div>`;
}

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

/* ---------- markdown rendering ---------- */
function buildRenderer(settings) {
  const renderer = new marked.Renderer();

  renderer.heading = (text, level, raw) => {
    const id = slugify(raw || text);
    return `<h${level} id="${id}">${text}</h${level}>\n`;
  };

  if (settings.wikilinks) {
    renderer.link = (href, title, text) => {
      if (href && href.startsWith("wikilink:")) {
        const target = decodeURIComponent(href.slice("wikilink:".length));
        const resolved = findFileNodeByBaseName(State.tree, target);
        const cls = resolved ? "wikilink" : "wikilink broken";
        return `<a href="#" class="${cls}" data-wiki-target="${escapeHtmlText(target)}">${text}</a>`;
      }
      const t = title ? ` title="${escapeHtmlText(title)}"` : "";
      return `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
    };
  }

  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  renderer.code = (code, infostring) => {
    const lang = (infostring || "").trim().split(/\s+/)[0];

    if (lang === "mermaid" && settings.mermaid) {
      return `<pre class="mermaid">${escapeHtml(code)}</pre>`;
    }

    if (!settings.highlight) {
      return `<pre><code class="language-${lang || ""}">${escapeHtml(code)}</code></pre>`;
    }

    let highlighted;
    try {
      highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch {
      highlighted = escapeHtml(code);
    }
    return `<pre><code class="hljs language-${lang || ""}">${highlighted}</code></pre>`;
  };

  if (!settings.tables) {
    renderer.table = (header, body) => `<table class="plain"><thead>${header}</thead><tbody>${body}</tbody></table>`;
  }

  if (!settings.taskLists) {
    renderer.checkbox = () => "";
  }

  return renderer;
}

function renderMarkdown(rawText, settings) {
  State.headingSlugs = new Map();

  let body = rawText;
  let frontmatterHtml = "";
  if (settings.frontmatter) {
    const { meta, body: rest } = parseFrontmatter(rawText);
    if (meta) {
      frontmatterHtml = buildFrontmatterHtml(meta);
      body = rest;
    }
  }

  const renderer = buildRenderer(settings);
  marked.setOptions({
    renderer,
    gfm: settings.gfm,
    breaks: settings.breaks,
  });
  let source = settings.wikilinks ? applyWikilinks(body) : body;
  source = settings.smartypants ? applySmartypants(source) : source;
  const html = marked.parse(source);
  return DOMPurify.sanitize(frontmatterHtml + html, {
    ADD_TAGS: ["input"],
    ADD_ATTR: ["type", "checked", "disabled", "id", "class", "language", "data-wiki-target"],
  });
}

function displayMarkdown(rawText, fileName) {
  const html = renderMarkdown(rawText, Settings.current);
  const content = document.getElementById("content");
  content.innerHTML = html;
  document.getElementById("current-file-name").textContent = fileName;
  buildOutline();
  renderMermaidDiagrams();
  attachCodeCopyButtons();
}

/* ---------- clipboard helper (async Clipboard API can hang in some contexts; always settle) ---------- */
function copyTextViaExecCommand(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

function copyTextToClipboard(text) {
  const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
  return Promise.race([
    navigator.clipboard.writeText(text).then(() => "ok"),
    timeout(1500),
  ])
    .catch(() => "error")
    .then((outcome) => (outcome === "ok" ? true : copyTextViaExecCommand(text)));
}

/* ---------- code block copy buttons ---------- */
function attachCodeCopyButtons() {
  const blocks = document.querySelectorAll("#content pre:not(.mermaid)");
  blocks.forEach((pre) => {
    if (pre.parentElement.classList.contains("code-block-wrapper")) return;
    const code = pre.querySelector("code");
    if (!code) return;

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement("button");
    btn.className = "code-copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(code.textContent);
      btn.textContent = ok ? "Copied!" : "Failed";
      btn.classList.toggle("copied", ok);
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    });
    wrapper.appendChild(btn);
  });
}

/* ---------- mermaid ---------- */
async function renderMermaidDiagrams() {
  if (!Settings.current.mermaid || !window.mermaid) return;
  const nodes = document.querySelectorAll("#content pre.mermaid");
  if (!nodes.length) return;
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: Settings.isDarkMode() ? "dark" : "default",
    });
    nodes.forEach((el, i) => {
      el.removeAttribute("data-processed");
      el.id = `mermaid-diagram-${Date.now()}-${i}`;
    });
    await mermaid.run({ nodes: Array.from(nodes) });
    nodes.forEach((el) => attachDiagramToolbar(el));
  } catch (err) {
    console.error("Mermaid render error", err);
  }
}

function attachDiagramToolbar(preEl) {
  if (!preEl.isConnected || preEl.parentElement.classList.contains("diagram-wrapper")) return;
  const svg = preEl.querySelector("svg");
  if (!svg) return;

  const wrapper = document.createElement("div");
  wrapper.className = "diagram-wrapper";
  preEl.parentNode.insertBefore(wrapper, preEl);
  wrapper.appendChild(preEl);

  const toolbar = document.createElement("div");
  toolbar.className = "diagram-toolbar";
  toolbar.innerHTML = `
    <button class="btn icon-btn" data-action="copy" title="Copy SVG">⧉</button>
    <button class="btn icon-btn" data-action="png" title="Save as PNG">⬇</button>
    <button class="btn icon-btn" data-action="zoom" title="Zoom / pan">🔍</button>
  `;
  wrapper.appendChild(toolbar);

  toolbar.querySelector('[data-action="copy"]').addEventListener("click", () => copySvgToClipboard(svg));
  toolbar.querySelector('[data-action="png"]').addEventListener("click", () => exportSvgAsPng(svg));
  toolbar.querySelector('[data-action="zoom"]').addEventListener("click", () => openLightbox(svg));
}

async function copySvgToClipboard(svg) {
  const svgStr = new XMLSerializer().serializeToString(svg);
  await copyTextToClipboard(svgStr);
}

function exportSvgAsPng(svg) {
  const rect = svg.getBoundingClientRect();
  const scale = 2;
  const clone = svg.cloneNode(true);
  clone.setAttribute("width", rect.width);
  clone.setAttribute("height", rect.height);
  const svgStr = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "diagram.png";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  img.onerror = (err) => console.error("PNG export failed", err);
  img.src = url;
}

/* ---------- diagram lightbox (zoom / pan) ---------- */
const Lightbox = { scale: 1, fitScale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0 };

function openLightbox(svg) {
  const overlay = document.getElementById("diagram-lightbox");
  const canvas = document.getElementById("lightbox-canvas");
  canvas.innerHTML = "";
  const clone = svg.cloneNode(true);
  // Keep the id: Mermaid scopes its node/text styling with "#<svg-id> .class" CSS rules
  // embedded in the SVG's own <style>, so stripping it left the clone unstyled.
  clone.style.transform = "none";
  canvas.appendChild(clone);
  overlay.classList.remove("hidden");

  // Measure after layout so the diagram opens fit to the viewport instead of at 1:1 pixel scale.
  requestAnimationFrame(() => {
    const containerRect = canvas.getBoundingClientRect();
    const svgRect = clone.getBoundingClientRect();
    let fit = Math.min((containerRect.width * 0.92) / svgRect.width, (containerRect.height * 0.92) / svgRect.height);
    if (!isFinite(fit) || fit <= 0) fit = 1;
    fit = Math.min(Math.max(fit, 0.05), 4);
    Lightbox.fitScale = fit;
    Lightbox.scale = fit;
    Lightbox.tx = 0;
    Lightbox.ty = 0;
    applyLightboxTransform();
  });
}

function closeLightbox() {
  document.getElementById("diagram-lightbox").classList.add("hidden");
  document.getElementById("lightbox-canvas").innerHTML = "";
}

function applyLightboxTransform() {
  const svg = document.querySelector("#lightbox-canvas svg");
  if (!svg) return;
  svg.style.transform = `translate(${Lightbox.tx}px, ${Lightbox.ty}px) scale(${Lightbox.scale})`;
}

function initLightbox() {
  const overlay = document.getElementById("diagram-lightbox");
  const canvas = document.getElementById("lightbox-canvas");

  document.getElementById("lb-close").addEventListener("click", closeLightbox);
  document.getElementById("lb-zoom-in").addEventListener("click", () => {
    Lightbox.scale = Math.min(6, Lightbox.scale * 1.25);
    applyLightboxTransform();
  });
  document.getElementById("lb-zoom-out").addEventListener("click", () => {
    Lightbox.scale = Math.max(0.2, Lightbox.scale / 1.25);
    applyLightboxTransform();
  });
  document.getElementById("lb-zoom-reset").addEventListener("click", () => {
    Lightbox.scale = Lightbox.fitScale;
    Lightbox.tx = 0;
    Lightbox.ty = 0;
    applyLightboxTransform();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeLightbox();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      Lightbox.scale = Math.min(6, Math.max(0.2, Lightbox.scale * delta));
      applyLightboxTransform();
    },
    { passive: false }
  );

  canvas.addEventListener("mousedown", (e) => {
    Lightbox.dragging = true;
    Lightbox.startX = e.clientX - Lightbox.tx;
    Lightbox.startY = e.clientY - Lightbox.ty;
    canvas.classList.add("grabbing");
  });
  window.addEventListener("mousemove", (e) => {
    if (!Lightbox.dragging) return;
    Lightbox.tx = e.clientX - Lightbox.startX;
    Lightbox.ty = e.clientY - Lightbox.startY;
    applyLightboxTransform();
  });
  window.addEventListener("mouseup", () => {
    Lightbox.dragging = false;
    canvas.classList.remove("grabbing");
  });
}

/* ---------- outline ---------- */
let outlineObserver = null;

function buildOutline() {
  const outlineTree = document.getElementById("outline-tree");
  outlineTree.innerHTML = "";
  if (outlineObserver) {
    outlineObserver.disconnect();
    outlineObserver = null;
  }

  if (!Settings.current.autoOutline) {
    outlineTree.innerHTML = '<p class="hint">Outline disabled in settings.</p>';
    return;
  }

  const headings = document.querySelectorAll("#content h1, #content h2, #content h3, #content h4, #content h5, #content h6");
  if (!headings.length) {
    outlineTree.innerHTML = '<p class="hint">No headings in this document.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  headings.forEach((h) => {
    const level = Number(h.tagName[1]);
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    a.className = `lvl-${level}`;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    frag.appendChild(a);
  });
  outlineTree.appendChild(frag);

  outlineObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = outlineTree.querySelector(`a[href="#${CSS.escape(entry.target.id)}"]`);
        if (!link) return;
        if (entry.isIntersecting) {
          outlineTree.querySelectorAll("a.active").forEach((a) => a.classList.remove("active"));
          link.classList.add("active");
        }
      });
    },
    { root: document.getElementById("content-wrapper"), rootMargin: "0px 0px -70% 0px" }
  );
  headings.forEach((h) => outlineObserver.observe(h));
}

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

/* ---------- opening files/folders (File System Access API) ---------- */
async function openFileHandle(fileHandle, displayName) {
  stopAutoRefresh();
  const file = await fileHandle.getFile();
  const text = await file.text();
  State.mode = "fsapi";
  State.currentFileHandle = fileHandle;
  State.lastModified = file.lastModified;
  displayMarkdown(text, displayName);
  document.getElementById("content-wrapper").scrollTop = 0;
  await IDB.set("lastFile", fileHandle);
  startAutoRefresh();
}

async function openFolder(dirHandle) {
  State.rootHandle = dirHandle;
  State.rootName = dirHandle.name;
  const fileTreeEl = document.getElementById("file-tree");
  fileTreeEl.innerHTML = '<p class="hint">Scanning…</p>';
  State.tree = await buildTree(dirHandle);
  renderTree(State.tree, fileTreeEl, "");
  await IDB.set("lastDir", dirHandle);

  // Auto-open the first markdown file found, mimicking "open all markdown from folder"
  const firstFile = findFirstFile(State.tree);
  if (firstFile) {
    const el = fileTreeEl.querySelector(`[data-path="${CSS.escape(firstFile.name)}"]`);
    await openFileHandle(firstFile.handle, firstFile.handle.name);
    if (el) el.classList.add("active");
  }
}

/* ---------- opening files/folders (mdopen CLI via local helper server) ---------- */
async function openFileServer(absPath, displayName) {
  stopAutoRefresh();
  State.mode = "server";
  const { content, name, mtimeMs } = await serverFetch("/read", { path: absPath });
  State.currentServerPath = absPath;
  State.lastModified = mtimeMs;
  displayMarkdown(content, name || displayName);
  document.getElementById("content-wrapper").scrollTop = 0;
  startAutoRefresh();
}

async function openFolderServer(dirAbsPath, activeFilePath) {
  State.mode = "server";
  State.rootName = dirAbsPath.split("/").pop();
  State.serverRootDir = dirAbsPath;
  const fileTreeEl = document.getElementById("file-tree");
  fileTreeEl.innerHTML = '<p class="hint">Scanning…</p>';
  const { tree } = await serverFetch("/list", { dir: dirAbsPath });
  State.tree = convertServerTree(tree);
  renderTree(State.tree, fileTreeEl, "");

  const target = activeFilePath || (findFirstFile(State.tree) || {}).absPath;
  if (target) {
    const el = fileTreeEl.querySelector(`[data-path="${CSS.escape(target)}"]`);
    await openFileServer(target, target.split("/").pop());
    if (el) el.classList.add("active");
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

/* ---------- auto-refresh ---------- */
function startAutoRefresh() {
  if (!Settings.current.autoRefresh) return;
  const intervalMs = Math.max(1, Settings.current.autoRefreshInterval) * 1000;

  if (State.mode === "server") {
    if (!State.currentServerPath) return;
    State.autoRefreshTimer = setInterval(async () => {
      try {
        const { mtimeMs } = await serverFetch("/mtime", { path: State.currentServerPath });
        if (mtimeMs !== State.lastModified) {
          State.lastModified = mtimeMs;
          const { content, name } = await serverFetch("/read", { path: State.currentServerPath });
          const scrollPos = document.getElementById("content-wrapper").scrollTop;
          displayMarkdown(content, name);
          document.getElementById("content-wrapper").scrollTop = scrollPos;
        }
      } catch {
        stopAutoRefresh();
      }
    }, intervalMs);
    return;
  }

  if (!State.currentFileHandle) return;
  State.autoRefreshTimer = setInterval(async () => {
    try {
      const file = await State.currentFileHandle.getFile();
      if (file.lastModified !== State.lastModified) {
        State.lastModified = file.lastModified;
        const text = await file.text();
        const scrollPos = document.getElementById("content-wrapper").scrollTop;
        displayMarkdown(text, file.name);
        document.getElementById("content-wrapper").scrollTop = scrollPos;
      }
    } catch {
      stopAutoRefresh();
    }
  }, intervalMs);
}

function stopAutoRefresh() {
  if (State.autoRefreshTimer) clearInterval(State.autoRefreshTimer);
  State.autoRefreshTimer = null;
}

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

/* ---------- UI wiring ---------- */
function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tabName}`));
}

async function tryRestoreLastSession() {
  try {
    const lastDir = await IDB.get("lastDir");
    if (lastDir && (await lastDir.queryPermission({ mode: "read" })) === "granted") {
      await openFolder(lastDir);
      return;
    }
    if (lastDir) {
      showReconnectPrompt(lastDir);
    }
  } catch {
    /* no previous session */
  }
}

function showReconnectPrompt(dirHandle) {
  const fileTreeEl = document.getElementById("file-tree");
  fileTreeEl.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = `Reconnect to "${dirHandle.name}"`;
  btn.addEventListener("click", async () => {
    const perm = await dirHandle.requestPermission({ mode: "read" });
    if (perm === "granted") await openFolder(dirHandle);
  });
  fileTreeEl.appendChild(btn);
}

function initUI() {
  document.getElementById("btn-open-folder").addEventListener("click", async () => {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await openFolder(dirHandle);
    } catch (e) {
      if (e.name !== "AbortError") console.error(e);
    }
  });

  document.getElementById("btn-open-file").addEventListener("click", async () => {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown", ".mdx"] } }],
      });
      await openFileHandle(fileHandle, fileHandle.name);
      document.querySelectorAll(".tree-node.active").forEach((n) => n.classList.remove("active"));
    } catch (e) {
      if (e.name !== "AbortError") console.error(e);
    }
  });

  document.getElementById("btn-search").addEventListener("click", () => {
    const box = document.getElementById("search-box");
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden")) document.getElementById("search-input").focus();
  });

  document.getElementById("search-input").addEventListener("input", (e) => {
    if (!State.tree) return;
    renderTree(State.tree, document.getElementById("file-tree"), e.target.value.trim().toLowerCase());
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("btn-toggle-sidebar").addEventListener("click", () => {
    document.getElementById("app").classList.toggle("sidebar-collapsed");
  });

  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.toggle("hidden");
  });
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.add("hidden");
  });

  document.getElementById("btn-print").addEventListener("click", () => window.print());

  let searchDebounce = null;
  document.getElementById("content-search-input").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    searchDebounce = setTimeout(() => runContentSearch(q), 300);
  });

  document.getElementById("content").addEventListener("click", (e) => {
    const a = e.target.closest("a.wikilink");
    if (!a) return;
    e.preventDefault();
    resolveAndOpenWikilink(a.dataset.wikiTarget);
  });

  initLightbox();
}

async function main() {
  await Settings.load();
  Settings.apply();
  Settings.syncFormFromSettings();
  Settings.bindForm((key) => {
    if (["autoRefresh", "autoRefreshInterval"].includes(key)) {
      stopAutoRefresh();
      startAutoRefresh();
    }
    const reRenderKeys = [
      "gfm",
      "tables",
      "taskLists",
      "highlight",
      "mermaid",
      "wikilinks",
      "frontmatter",
      "smartypants",
      "breaks",
      "theme",
    ];
    if (reRenderKeys.includes(key)) reRenderCurrentFile();
    if (key === "autoOutline") buildOutline();
  });
  initUI();
  await openFromUrlParams();
}

async function reRenderCurrentFile() {
  if (State.mode === "server" && State.currentServerPath) {
    const { content, name } = await serverFetch("/read", { path: State.currentServerPath });
    displayMarkdown(content, name);
  } else if (State.currentFileHandle) {
    const file = await State.currentFileHandle.getFile();
    const text = await file.text();
    displayMarkdown(text, State.currentFileHandle.name);
  }
}

/* ---------- mdopen CLI entry point ---------- */
async function openFromUrlParams() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  const targetPath = params.get("path");
  const port = params.get("port");
  const token = params.get("token");

  if (!mode || !targetPath || !port || !token) {
    await tryRestoreLastSession();
    return;
  }

  State.serverBase = `http://127.0.0.1:${port}`;
  State.serverToken = token;

  try {
    if (mode === "dir") {
      await openFolderServer(targetPath, null);
    } else {
      await openFolderServer(dirnameOf(targetPath), targetPath);
    }
  } catch (err) {
    document.getElementById("file-tree").innerHTML = `<p class="hint">Failed to open via mdopen: ${err.message}</p>`;
  }
}

main();
