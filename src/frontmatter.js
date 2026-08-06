/* ---------- frontmatter ---------- */
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
