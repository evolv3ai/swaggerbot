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
