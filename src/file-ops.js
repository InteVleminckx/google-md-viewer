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
