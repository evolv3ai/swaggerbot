import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { downloadUrl } from "~/spec-forms/outcome";
import { isSpecId } from "./downloads";
import { SCALAR_SCRIPT_PATH } from "./scalar-script";

/**
 * The Spec viewer's frame (Slice 6 backlog, D6): `/embed/specs/{specId}`, a
 * standalone page, outside the app shell, that runs Scalar's API reference
 * on one form of one Spec. The viewer page (`/specs/{specId}`) frames it with
 * `<iframe sandbox="allow-scripts">`, so it runs with an opaque origin, and
 * it is served under its own policy (`embedCsp`): a Spec's content is
 * untrusted, and even if Scalar's sanitiser missed something, it can't run
 * script, load remote content or call any server but the one download.
 */

/**
 * In-memory `localStorage` and `sessionStorage` for the frame
 * (`public/embed/memory-storage.js`): its opaque origin has neither, and
 * Scalar reads them as it starts.
 */
const MEMORY_STORAGE_PATH = "/embed/memory-storage.js";

/**
 * Points Scalar's lazy rendering at the frame's own viewport
 * (`public/embed/frame-viewport.js`): to the browser the opaque-origin frame
 * is cross-origin, so observers with the implicit root see nothing while the
 * frame is below the fold, and Scalar would show empty placeholders.
 */
const FRAME_VIEWPORT_PATH = "/embed/frame-viewport.js";

/** Which of a Spec's forms a viewer shows. */
export type SpecForm = "published" | "normalized";

/** `?form=` as the viewer reads it: `normalized`, or else the Published Form. */
export function specFormOf(value: unknown): SpecForm {
  return value === "normalized" ? "normalized" : "published";
}

/**
 * The site's theme, as the frame is asked for it (`?theme=`): its opaque
 * origin can't read the viewer page's storage, so the page passes it. Only
 * these two values are ever used; anything else is the default, dark.
 */
export type FrameTheme = "dark" | "light";

/** `?theme=` as the frame reads it: `light`, or else dark (the site's default). */
export function frameThemeOf(value: unknown): FrameTheme {
  return value === "light" ? "light" : "dark";
}

/**
 * Scalar's colours in the design system's (DESIGN.md; `src/styles/app.css`),
 * for each mode: the ink ground and white text in dark, white and navy in
 * light, SwaggerBot Blue for the accent. Its fonts fall back to the
 * system's: the frame's opaque origin can't load ours.
 */
export const SCALAR_CSS = `.light-mode{--scalar-background-1:#ffffff;--scalar-background-2:#f6f8fb;--scalar-background-3:#edf1f6;--scalar-background-card:#ffffff;--scalar-color-1:#021c41;--scalar-color-2:#4b5568;--scalar-color-3:#6b7688;--scalar-color-accent:#006696;--scalar-background-accent:#eaf7fd;--scalar-border-color:#dce2eb;--scalar-button-1:#0099dd;--scalar-button-1-hover:#26aae4;--scalar-button-1-color:#021c41}
.dark-mode{--scalar-background-1:#111827;--scalar-background-2:#1f2737;--scalar-background-3:#343d4f;--scalar-background-card:#1f2737;--scalar-color-1:#ffffff;--scalar-color-2:#c1cad7;--scalar-color-3:#96a1b2;--scalar-color-accent:#5cbfeb;--scalar-background-accent:rgba(0,153,221,.18);--scalar-border-color:#343d4f;--scalar-button-1:#0099dd;--scalar-button-1-hover:#26aae4;--scalar-button-1-color:#021c41}
.light-mode,.dark-mode{--scalar-font:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--scalar-font-code:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--scalar-radius:6px;--scalar-radius-lg:10px;--scalar-radius-xl:16px}`;

/** The frame's page ground, per theme, so it never flashes the other one. */
const GROUND: Record<FrameTheme, { background: string; color: string }> = {
  dark: { background: "#111827", color: "#ffffff" },
  light: { background: "#ffffff", color: "#021c41" },
};

/**
 * The largest form the viewer renders inline, in bytes (decimal MB, as the
 * sizes are shown). Past it the viewer links to the downloads and the Spec
 * Outline instead: Scalar would take too long, and too much memory, to be
 * usable.
 */
export const MAX_VIEW_BYTES = 10_000_000;

/** Whether a form of `bytes` is too large to view inline. */
export function tooLargeToView(bytes: number): boolean {
  return bytes > MAX_VIEW_BYTES;
}

/**
 * The frame's Content Security Policy. `connect-src` is the one download
 * URL, absolute, so the frame can fetch that Spec and nothing else.
 * `script-src 'self'` has no nonce and no `'unsafe-inline'`: the page has
 * no inline script, and Scalar's bundle is a file of ours. `sandbox
 * allow-scripts` repeats the frame's sandbox on the response itself, so the
 * page has an opaque origin even when it is opened directly.
 */
export function embedCsp(connectUrl: string | null): string {
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectUrl ?? "'none'"}`,
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * Scalar's configuration: the Spec at `url`, read only, in the site's
 * `theme` (forced: its own toggle is hidden, and it follows the site's), in
 * the design system's colours (`SCALAR_CSS`). "Try it" and the
 * API client are off (and the CSP would stop them anyway), as are
 * telemetry, its web fonts, its AI agent and MCP, the developer toolbar and
 * the document download (the sandbox allows no downloads; ours are on the
 * viewer page). No `proxyUrl`.
 */
export function scalarConfiguration(url: string, theme: FrameTheme = "dark") {
  return {
    url,
    darkMode: theme === "dark",
    forceDarkModeState: theme,
    hideDarkModeToggle: true,
    customCss: SCALAR_CSS,
    hideTestRequestButton: true,
    hideClientButton: true,
    telemetry: false,
    withDefaultFonts: false,
    agent: { disabled: true },
    mcp: { disabled: true },
    showDeveloperTools: "never",
    documentDownloadType: "none",
  } as const;
}

/**
 * The frame's page. Scalar reads its configuration from the
 * `#api-reference` element's `data-configuration`; that element is JSON,
 * not script, so the page has no inline script for the CSP to allow.
 */
export function embedHtml({
  title,
  url,
  theme = "dark",
}: {
  title: string;
  url: string;
  theme?: FrameTheme;
}): string {
  const configuration = JSON.stringify(scalarConfiguration(url, theme));
  const ground = GROUND[theme];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="${theme}">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;background:${ground.background};color:${ground.color}}</style>
</head>
<body>
<script id="api-reference" type="application/json" data-configuration="${escapeHtml(configuration)}"></script>
<script src="${MEMORY_STORAGE_PATH}"></script>
<script src="${FRAME_VIEWPORT_PATH}"></script>
<script src="${SCALAR_SCRIPT_PATH}"></script>
</body>
</html>
`;
}

/** A frame that says, as text, why there is nothing to show. */
function messageHtml(message: string, theme: FrameTheme): string {
  const ground = GROUND[theme];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${theme}">
<title>Spec viewer</title>
<style>body{margin:0;padding:1rem;font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif;background:${ground.background};color:${ground.color}}</style>
</head>
<body><p>${escapeHtml(message)}</p></body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function page(html: string, status: number, connectUrl: string | null) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": embedCsp(connectUrl),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-cache",
    },
  });
}

/**
 * `GET /embed/specs/{specId}?form=published|normalized&theme=dark|light`:
 * the frame for that form, in that theme, pointed at its download URL under `baseUrl` (`PUBLIC_BASE_URL`, or
 * the request's own origin). A form that can't be shown (an unknown Spec, a
 * Normalized Form not built, a form over `MAX_VIEW_BYTES`) gets a page that
 * says why, and may connect nowhere.
 */
export function embedResponse(
  request: Request,
  specId: string,
  getDb: () => Db,
  baseUrl?: string,
): Response {
  const params = new URL(request.url).searchParams;
  const form = specFormOf(params.get("form"));
  const theme = frameThemeOf(params.get("theme"));
  if (!isSpecId(specId))
    return page(messageHtml("That isn't a Spec id.", theme), 400, null);
  const db = getDb();
  const repo = createRepo(db);
  const spec = repo.getSpec(specId);
  if (!spec) return page(messageHtml("No such Spec.", theme), 404, null);
  const api = repo.getApiWithSpecs(spec.apiId)?.api;
  const forms = createSpecForms(db);
  const bytes =
    form === "published"
      ? spec.byteLength
      : forms.getNormalizedByteLength(specId);
  if (bytes === undefined) {
    const stored = forms.getForms(specId);
    const why =
      stored.status === "failed"
        ? `The Normalized Form couldn't be built: ${stored.error}`
        : "The Normalized Form is being built. Reload in a minute.";
    return page(messageHtml(why, theme), 409, null);
  }
  if (tooLargeToView(bytes))
    return page(
      messageHtml(
        "This Spec is too large to view here. Download it instead.",
        theme,
      ),
      413,
      null,
    );
  const url = downloadUrl(specId, form, baseUrl ?? new URL(request.url).origin);
  const title = `API reference for ${api?.name ?? "a Spec"}`;
  return page(embedHtml({ title, url, theme }), 200, url);
}
