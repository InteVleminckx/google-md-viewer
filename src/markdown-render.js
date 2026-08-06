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
