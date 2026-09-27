// The Spec viewer's frame (/embed/specs/…) follows the site's theme without
// being reloaded: reloading would fetch Scalar and the Spec again (up to
// 10 MB) on every switch. The frame is served in the theme its URL names
// (dark, the site's default); on start it asks its parent for the site's
// theme, and the parent answers then, and again whenever the visitor
// switches (THEME_SCRIPT and setTheme, src/components/shell/theme.ts).
// Before Scalar mounts, the answer also rewrites Scalar's configuration, so
// it mounts in the right theme; after, it switches Scalar's mode classes.
// Only messages from the parent page are read, and only a theme name is
// ever sent. Loaded before Scalar.
(() => {
  const script = () => document.getElementById("api-reference");
  const apply = (theme) => {
    const dark = theme === "dark";
    for (const el of [document.documentElement, document.body]) {
      el.classList.toggle("dark-mode", dark);
      el.classList.toggle("light-mode", !dark);
    }
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", theme);
    // Scalar reads its configuration when it mounts; until then, change it.
    const config = script()?.getAttribute("data-configuration");
    if (config && !document.querySelector("body > div")) {
      try {
        const next = JSON.parse(config);
        next.darkMode = dark;
        next.forceDarkModeState = theme;
        script().setAttribute("data-configuration", JSON.stringify(next));
      } catch {
        // Left as served: the mode classes above still switch it.
      }
    }
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (
      data?.type === "sb-theme" &&
      (data.theme === "dark" || data.theme === "light")
    )
      apply(data.theme);
  });
  window.parent.postMessage({ type: "sb-frame-ready" }, "*");
})();
