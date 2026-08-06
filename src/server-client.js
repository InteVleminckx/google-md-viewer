/* ---------- local helper server (mdopen CLI) ---------- */
async function serverFetch(pathname, params) {
  const qs = new URLSearchParams({ ...params, token: State.serverToken });
  const res = await fetch(`${State.serverBase}${pathname}?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request to ${pathname} failed (${res.status})`);
  }
  return res.json();
}

function convertServerTree(node) {
  return {
    name: node.name,
    kind: node.kind,
    absPath: node.path,
    children: (node.children || []).map(convertServerTree),
  };
}

function dirnameOf(absPath) {
  const idx = absPath.lastIndexOf("/");
  return idx === -1 ? absPath : absPath.slice(0, idx);
}
