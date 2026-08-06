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

main();
