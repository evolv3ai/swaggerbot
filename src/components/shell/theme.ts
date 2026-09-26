/**
 * The visitor's theme: dark by default (no attribute), light as
 * `data-theme="light"` on <html>, remembered in localStorage under
 * `THEME_KEY`. Storage can throw (private windows, blocked site data), so
 * every read and write is guarded and the page is dark without it.
 */
export const THEME_KEY = "theme";
export type Theme = "dark" | "light";

/**
 * Runs inline in <head>, before first paint (with the page's CSP nonce), so
 * a light-theme visitor never sees a dark flash.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembered; it still applies to this page.
  }
}
