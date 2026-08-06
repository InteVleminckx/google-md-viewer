/* ---------- clipboard helper (async Clipboard API can hang in some contexts; always settle) ---------- */
function copyTextViaExecCommand(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

function copyTextToClipboard(text) {
  const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
  return Promise.race([
    navigator.clipboard.writeText(text).then(() => "ok"),
    timeout(1500),
  ])
    .catch(() => "error")
    .then((outcome) => (outcome === "ok" ? true : copyTextViaExecCommand(text)));
}
