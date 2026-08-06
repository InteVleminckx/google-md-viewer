/* ---------- shared constants ---------- */
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
