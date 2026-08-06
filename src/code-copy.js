/* ---------- code block copy buttons ---------- */
function attachCodeCopyButtons() {
  const blocks = document.querySelectorAll("#content pre:not(.mermaid)");
  blocks.forEach((pre) => {
    if (pre.parentElement.classList.contains("code-block-wrapper")) return;
    const code = pre.querySelector("code");
    if (!code) return;

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement("button");
    btn.className = "code-copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(code.textContent);
      btn.textContent = ok ? "Copied!" : "Failed";
      btn.classList.toggle("copied", ok);
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    });
    wrapper.appendChild(btn);
  });
}
