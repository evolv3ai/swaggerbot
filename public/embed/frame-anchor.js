// The Spec viewer's frame (/embed/specs/…) scrolls to an operation when the
// viewer page asks: an "Ask this Spec" citation chip sends
// { type: "sb-anchor", method, path } (showOperation,
// src/components/viewer/spec-frame.tsx). The frame's origin is opaque, so
// the page can't reach into it; it can only send this message. Only
// messages from the parent page are read, only an HTTP method and a path
// are taken from them, and nothing is sent back. Loaded before Scalar.
//
// Where an operation is, as Scalar (1.72) renders it: each sidebar item
// carries its section's id as `data-sidebar-id`, the document's slug, then
// `tag/{tag's slug}/` when the operation has a tag, then the method in
// capitals and the path as the Spec writes it: `api-1/tag/things/GET/things`,
// `api-1/GET/health`. The section has the same `id`. The item's link is
// Scalar's own way there: following it renders the lazy section and scrolls
// to it (a hash set by hand is not read). Items under a collapsed tag aren't
// rendered, so collapsed tags are opened one at a time, and closed again,
// until the operation is found; one under several tags is taken from the
// first. Scalar then focuses the section, labelled by its heading (or, if it
// doesn't, the heading is focused here).
(() => {
  if (window.parent === window) return;
  const METHODS = new Set([
    "get",
    "put",
    "post",
    "delete",
    "options",
    "head",
    "patch",
    "trace",
  ]);
  // How long to wait for Scalar to mount, then for the section, then for
  // Scalar to focus it.
  const MOUNT_MS = 30_000;
  const SECTION_MS = 5_000;
  const FOCUS_MS = 1_000;

  const later = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (find, ms) => {
    for (const end = Date.now() + ms; ; await later(50)) {
      const found = find();
      if (found || Date.now() > end) return found;
    }
  };

  // `api-1/GET/things` or `api-1/tag/things/GET/things`, for `GET/things`.
  const isOperation = (id, operation) =>
    id.endsWith(operation) &&
    /^[^/]+\/(?:tag\/[^/]+\/)?$/.test(id.slice(0, -operation.length));
  const item = (operation) =>
    [...document.querySelectorAll("[data-sidebar-id]")].find((el) =>
      isOperation(el.getAttribute("data-sidebar-id"), operation),
    );
  const collapsed = (root) => [
    ...root.querySelectorAll('[data-sidebar-id] button[aria-expanded="false"]'),
  ];

  // Opens each collapsed group under `root` in turn, and the groups inside
  // it, closing each again unless the operation is under it.
  const search = async (operation, root) => {
    for (const toggle of collapsed(root)) {
      if (!toggle.isConnected) continue;
      toggle.click();
      await later();
      const group = toggle.closest("[data-sidebar-id]");
      const found =
        item(operation) ?? (group && (await search(operation, group)));
      if (found) return found;
      toggle.click();
      await later();
    }
    return undefined;
  };

  // One at a time, and only the latest of those asked.
  let asked = 0;
  let running = Promise.resolve();

  const show = async ({ method, path }, n) => {
    const operation = `${method.toUpperCase()}${path}`;
    const mounted = await until(
      () => n !== asked || document.querySelector("[data-sidebar-id]"),
      MOUNT_MS,
    );
    if (!mounted || n !== asked) return;
    const found = item(operation) ?? (await search(operation, document));
    if (!found) return;
    const id = found.getAttribute("data-sidebar-id");
    found.querySelector("a[href]")?.click();
    const section = await until(() => document.getElementById(id), SECTION_MS);
    if (!section) return;
    section.scrollIntoView({ block: "start" });
    // Scalar focuses the section, labelled by its heading; if it hasn't
    // within a second, the heading is focused here.
    if (await until(() => section.contains(document.activeElement), FOCUS_MS))
      return;
    const heading = section.querySelector("h1, h2, h3, h4, h5, h6");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex"))
      heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (
      data?.type !== "sb-anchor" ||
      typeof data.method !== "string" ||
      !METHODS.has(data.method.toLowerCase()) ||
      typeof data.path !== "string" ||
      !data.path.startsWith("/") ||
      data.path.length > 2048
    )
      return;
    const ask = { method: data.method, path: data.path };
    const n = ++asked;
    running = running
      .then(() => (n === asked ? show(ask, n) : undefined))
      .catch(() => undefined);
  });
})();
