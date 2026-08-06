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
