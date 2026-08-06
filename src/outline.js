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
