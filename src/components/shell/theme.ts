/**
 * The visitor's theme: dark by default (no attribute), light as
 * `data-theme="light"` on <html>, remembered in localStorage under
 * `THEME_KEY`. Storage can throw (private windows, blocked site data), so
 * every read and write is guarded and the page is dark without it.
 */
export const THEME_KEY = "theme";
export type Theme = "dark" | "light";

/**
 * The browser's toolbar colour (`<meta name="theme-color">`) per theme: the
 * page ground. The server writes the dark one; the head script and
 * `setTheme` switch it.
 */
export const THEME_COLOR: Record<Theme, string> = {
  dark: "#111827",
  light: "#ffffff",
};

/** Marks the Spec viewer's frames, which follow the theme (`SpecFrame`). */
export const SPEC_FRAME_ATTR = "data-spec-frame";

/**
 * Runs inline in <head>, before first paint (with the page's CSP nonce), so
 * a light-theme visitor never sees a dark flash. It also answers a Spec
 * frame's "ready" with the theme (`public/embed/frame-theme.js`), from
 * before hydration on, so the frame mounts Scalar in the site's theme
 * instead of being reloaded in it.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);if(t==="light")addEventListener("DOMContentLoaded",function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","${THEME_COLOR.light}")})}catch(e){}addEventListener("message",function(e){if(!e.data||e.data.type!=="sb-frame-ready")return;var f=document.querySelectorAll("iframe[${SPEC_FRAME_ATTR}]");for(var i=0;i<f.length;i++)if(f[i].contentWindow===e.source){e.source.postMessage({type:"sb-theme",theme:document.documentElement.getAttribute("data-theme")==="light"?"light":"dark"},"*");return}})`;

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
  // The Spec frames switch in place; their origin is opaque, so "*".
  for (const frame of document.querySelectorAll<HTMLIFrameElement>(
    `iframe[${SPEC_FRAME_ATTR}]`,
  ))
    frame.contentWindow?.postMessage({ type: "sb-theme", theme }, "*");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembered; it still applies to this page.
  }
}
