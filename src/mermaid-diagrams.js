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
