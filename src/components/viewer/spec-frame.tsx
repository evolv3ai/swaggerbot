import { SPEC_FRAME_ATTR, type Theme } from "~/components/shell/theme";
import type { SpecForm } from "~/server/spec-form";

/**
 * The frame Scalar runs in (`/embed/specs/{specId}`). `sandbox` allows
 * scripts and nothing else: without `allow-same-origin` the frame has an
 * opaque origin, so a Spec's content can't reach this page, its cookies or
 * its storage, open windows, submit forms or navigate the page.
 */
export const FRAME_SANDBOX = "allow-scripts";

/** The frame's URL: the form, and the site's theme for Scalar to match. */
export function frameSrc(specId: string, form: SpecForm, theme: Theme): string {
  return `/embed/specs/${specId}?form=${form}&theme=${theme}`;
}

/**
 * Shows an operation in the Spec viewer's frame, for "Ask this Spec"'s
 * citation chips: scrolls the page to the frame and asks it to scroll
 * Scalar to `method` `path` and focus its heading
 * (`public/embed/frame-anchor.js`). The frame's origin is opaque, so this
 * page can't reach into it; it sends the message to "*", having no origin
 * to name. False when there is no frame on the page.
 */
export function showOperation(
  method: string,
  path: string,
  root: Pick<ParentNode, "querySelector"> = document,
): boolean {
  const frame = root.querySelector<HTMLIFrameElement>(
    `iframe[${SPEC_FRAME_ATTR}]`,
  );
  const target = frame?.contentWindow;
  if (!frame || !target) return false;
  frame.scrollIntoView({ block: "start" });
  target.postMessage({ type: "sb-anchor", method, path }, "*");
  return true;
}

export function SpecFrame({
  specId,
  form,
  apiName,
}: {
  specId: string;
  form: SpecForm;
  apiName: string;
}) {
  // The frame's address never changes with the theme: a new address would
  // load Scalar and the Spec again. It starts dark (the default; the server
  // can't know the visitor's theme) and is told the site's theme by message
  // (`THEME_SCRIPT`, `setTheme`), so it switches in place.
  return (
    <iframe
      sandbox={FRAME_SANDBOX}
      {...{ [SPEC_FRAME_ATTR]: "" }}
      title={`API reference for ${apiName}`}
      src={frameSrc(specId, form, "dark")}
      referrerPolicy="no-referrer"
      className="block h-[80dvh] min-h-[32rem] w-full bg-sb-bg"
    />
  );
}
