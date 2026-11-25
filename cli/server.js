#!/usr/bin/env node
/*
 * Tiny localhost-only helper server for the MD Viewer web app.
 * Lets the `mdopen` CLI hand a filesystem path to the page, which
 * cannot otherwise receive arbitrary paths (File System Access API only
 * works from a user-driven picker).
 *
 * Every request must carry the shared token generated at server startup
 * (written to ~/.mdviewer/server.json) and the app's own origin is
 * the only one granted via CORS, so a random web page cannot use this to
 * read files off disk.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const APP_ORIGIN = "https://intevleminckx.github.io";
const STATE_DIR = path.join(os.homedir(), ".mdviewer");
const STATE_FILE = path.join(STATE_DIR, "server.json");
const MD_EXT = /\.(md|markdown|mdx)$/i;
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".obsidian", ".venv", "__pycache__", "dist", "build", ".next"]);

// Only these file types are served by /asset (used for images embedded in markdown).
const IMAGE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

// Reuse the port and token of the previous run (if any), so viewer tabs that are already
// open keep working after the server restarts. Otherwise use a random token and free port.
function readPreviousState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

const PREVIOUS = readPreviousState();
const TOKEN = /^[0-9a-f]{32}$/.test(PREVIOUS.token || "")
  ? PREVIOUS.token
  : crypto.randomBytes(16).toString("hex");
const PREFERRED_PORT = Number.isInteger(PREVIOUS.port) ? PREVIOUS.port : 0; // 0 = OS picks

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Headers": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function checkToken(query) {
  return query.token === TOKEN;
}

function collectMdFiles(dirAbs, relBase, depth, out) {
  const entries = fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .filter((e) => {
      if (e.isDirectory()) return !EXCLUDED_DIRS.has(e.name) && !e.name.startsWith(".");
      return MD_EXT.test(e.name);
    });

  for (const entry of entries) {
    const full = path.join(dirAbs, entry.name);
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (depth > 12) continue;
      collectMdFiles(full, rel, depth + 1, out);
    } else {
      out.push({ path: full, relPath: rel, name: entry.name });
    }
  }
  return out;
}

function searchFiles(dirAbs, query, maxResults) {
  const needle = query.toLowerCase();
  const files = collectMdFiles(dirAbs, "", 0, []);
  const results = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file.path, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
        if (matches.length >= 3) break;
      }
    }
    if (matches.length) {
      results.push({ path: file.path, relPath: file.relPath, name: file.name, matches });
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

// Stream an image file. Non-image extensions are refused, so this can't be used to read
// arbitrary files; the sandbox CSP keeps an SVG opened directly from running scripts.
function sendAsset(res, fileAbs) {
  const type = IMAGE_TYPES[path.extname(fileAbs).toLowerCase()];
  if (!type) return send(res, 415, { error: "unsupported asset type" });
  const stat = fs.statSync(fileAbs);
  if (!stat.isFile()) return send(res, 400, { error: "not a file" });
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  fs.createReadStream(fileAbs).pipe(res);
}

function walk(dirAbs, relBase, depth) {
  const node = { name: path.basename(dirAbs), kind: "directory", relPath: relBase, children: [] };
  const entries = fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .filter((e) => {
      if (e.isDirectory()) return !EXCLUDED_DIRS.has(e.name) && !e.name.startsWith(".");
      return MD_EXT.test(e.name);
    })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  for (const entry of entries) {
    const full = path.join(dirAbs, entry.name);
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (depth > 12) continue;
      const child = walk(full, rel, depth + 1);
      if (child.children.length) node.children.push(child);
    } else {
      node.children.push({ name: entry.name, kind: "file", relPath: rel, path: full });
    }
  }
  return node;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, "http://127.0.0.1");
  const query = Object.fromEntries(parsed.searchParams);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": APP_ORIGIN,
      "Access-Control-Allow-Headers": "*",
    });
    return res.end();
  }

  if (parsed.pathname === "/health") {
    return send(res, 200, { ok: true });
  }

  if (!checkToken(query)) {
    return send(res, 403, { error: "invalid token" });
  }

  try {
    if (parsed.pathname === "/list") {
      const dirAbs = path.resolve(String(query.dir || ""));
      const stat = fs.statSync(dirAbs);
      if (!stat.isDirectory()) return send(res, 400, { error: "not a directory" });
      const tree = walk(dirAbs, "", 0);
      return send(res, 200, { root: dirAbs, tree });
    }

    if (parsed.pathname === "/read") {
      const fileAbs = path.resolve(String(query.path || ""));
      const stat = fs.statSync(fileAbs);
      if (!stat.isFile()) return send(res, 400, { error: "not a file" });
      const content = fs.readFileSync(fileAbs, "utf8");
      return send(res, 200, { path: fileAbs, name: path.basename(fileAbs), content, mtimeMs: stat.mtimeMs });
    }

    if (parsed.pathname === "/search") {
      const dirAbs = path.resolve(String(query.dir || ""));
      const q = String(query.q || "").trim();
      if (!q) return send(res, 200, { results: [] });
      const results = searchFiles(dirAbs, q, 50);
      return send(res, 200, { results });
    }

    if (parsed.pathname === "/asset") {
      return sendAsset(res, path.resolve(String(query.path || "")));
    }

    if (parsed.pathname === "/mtime") {
      const fileAbs = path.resolve(String(query.path || ""));
      const stat = fs.statSync(fileAbs);
      return send(res, 200, { mtimeMs: stat.mtimeMs });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

function onListening() {
  server.removeAllListeners("error");
  const actualPort = server.address().port;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ port: actualPort, token: TOKEN, pid: process.pid }, null, 2)
  );
  process.title = "mdviewer-server";
}

// Try the preferred port first; if something else took it, fall back to a free one.
function start(port) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && port !== 0) return start(0);
    throw err;
  });
  server.listen(port, "127.0.0.1", onListening);
}

start(PREFERRED_PORT);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
