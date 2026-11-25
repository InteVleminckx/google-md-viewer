# MD Viewer

A local-first Markdown viewer that runs entirely in the browser. Open a single file or an entire folder, browse and search across all the Markdown files in it, and render GitHub-flavored Markdown with Mermaid diagrams, wiki-style links, frontmatter, and more.

Live app: **https://intevleminckx.github.io/google-md-viewer/**

No install required to use the site itself — it's a static page. The `mdopen` terminal command (see below) is what makes it feel like a native app: `mdopen notes.md` opens that file straight from your shell.

## Features

- **Folder browsing** — open a folder, get a sidebar tree of every `.md`/`.markdown`/`.mdx` file inside it (nested folders included, `.git`/`node_modules`/etc. skipped automatically)
- **Full-text search** — search file *contents* across the whole open folder, not just filenames
- **Outline** — auto-generated table of contents per document, with scroll-spy
- **Auto-refresh** — the open file is watched and re-rendered when it changes on disk
- **Themes** — Auto, Light, Dark, Sepia, Nord, Solarized Light/Dark
- **Mermaid diagrams** — fenced ` ```mermaid ` blocks render as live diagrams, with copy-as-SVG, export-to-PNG, and a zoom/pan lightbox
- **Wiki-style `[[links]]`** — `[[Note]]` or `[[Note|Label]]` resolve to sibling files by name
- **Frontmatter card** — leading YAML frontmatter renders as a metadata card instead of raw text
- **Print / export to PDF** — a clean print stylesheet, just use your browser's print dialog
- **Custom CSS, fonts, width, line-height** — all configurable from the settings panel and persisted locally
- **`mdopen` CLI** — open files/folders straight from your terminal (see below)
- **Local images** — `![plot](figures/plot.png)` (relative to the open file) or absolute paths render when opened via `mdopen`; the helper server serves image files only (png, jpg, gif, svg, webp, avif, bmp, ico)

Nothing you open ever leaves your machine — folders/files are read either via the browser's native File System Access API (when using "Open Folder"/"Open File" in the page) or via a localhost-only helper server (when using `mdopen`). There's no backend, no accounts, no telemetry.

## Using the site directly

Go to https://intevleminckx.github.io/google-md-viewer/ and click **Folder** or **File**. That's it — everything renders client-side.

## Installing the `mdopen` command

`mdopen` lets you type `mdopen some-file.md` or `mdopen some-folder/` in a terminal and have it open directly in the viewer, with the sidebar populated automatically. It works by running a tiny helper server on your machine (localhost-only, token-gated) that the web page talks to — this is necessary because a browser tab can't otherwise be handed an arbitrary filesystem path from the command line.

Requirements: [Node.js](https://nodejs.org) (any reasonably recent version) and macOS/Linux with `bash`.

1. Clone the repo somewhere permanent (don't delete this after — `mdopen` runs the script from here):

   ```bash
   git clone https://github.com/InteVleminckx/google-md-viewer.git
   ```

2. Make the CLI executable and put it on your `PATH`:

   ```bash
   chmod +x google-md-viewer/cli/mdopen google-md-viewer/cli/server.js
   mkdir -p ~/.local/bin
   ln -sf "$(pwd)/google-md-viewer/cli/mdopen" ~/.local/bin/mdopen
   ```

3. Make sure `~/.local/bin` is on your `PATH`. Add this to `~/.zshrc` / `~/.bashrc` if it isn't already there, then restart your terminal (or `source` the file):

   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   ```

4. Check for a naming conflict — if you already have an `mdopen` alias or function defined in your shell config, it'll shadow the real command. Search for it with:

   ```bash
   grep -rn "mdopen" ~/.zshrc ~/.zsh_functions ~/.bashrc 2>/dev/null
   ```

   and remove/rename it if found.

That's it. No further setup — the helper server starts itself automatically on first use and keeps running in the background for subsequent calls.

### Usage

```bash
mdopen notes.md        # opens that file; sidebar shows its sibling files in the same folder
mdopen ./my-vault/      # opens the whole folder, sidebar shows the full tree
```

Each call opens a new browser tab pointed at the live site with the right file/folder wired in.

## Project structure

```
index.html            entry point (served as-is by GitHub Pages)
src/viewer.css        all styling
src/settings.js       settings state, persistence (localStorage), and the settings-panel form
src/app.js            bootstrap: wires up DOM events, mdopen URL params, session restore
src/state.js          shared app state + constants
src/idb.js            IndexedDB helper (remembers the last opened folder/file)
src/file-tree.js      builds and renders the sidebar file tree (File System Access API)
src/file-ops.js       opening files/folders, auto-refresh (both FS Access API and mdopen/server modes)
src/server-client.js  fetch helper for the mdopen local server
src/markdown-render.js   marked.js renderer setup + sanitization
src/frontmatter.js    YAML frontmatter parsing → metadata card
src/wikilinks.js      [[wiki-link]] parsing and navigation
src/text-utils.js     heading slugs, smart typography, HTML escaping
src/outline.js        auto-generated table of contents
src/mermaid-diagrams.js  Mermaid rendering + diagram toolbar (copy/export)
src/lightbox.js        zoom/pan modal for diagrams
src/code-copy.js      copy-to-clipboard button for code blocks
src/clipboard.js      clipboard helper with an execCommand fallback
src/search.js         full-text search across the open folder
lib/                 vendored dependencies (marked, DOMPurify, highlight.js, mermaid) — no CDN, no build step
icons/               favicon
cli/mdopen           the `mdopen` shell command
cli/server.js        localhost-only helper server used by `mdopen`
.github/workflows/   GitHub Actions workflow that deploys `main` to GitHub Pages on every push
```

Every file here is a plain `<script>` tag in `index.html`, loaded in dependency order — no bundler, no build step.

There's no build step — it's plain HTML/CSS/JS served directly, and deploys are triggered automatically by pushing to `main`.
