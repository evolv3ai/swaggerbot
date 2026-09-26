import { useEffect, useState } from "react";
import { currentTheme, type Theme } from "~/components/shell/theme";
import type { SpecForm } from "~/server/spec-embed";

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
 * The site's theme, followed as it changes. The server renders dark (the
 * default; it can't read the visitor's choice); once hydrated it reads the
 * `data-theme` the head script set, and watches the toggle.
 */
function useSiteTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const read = () => setTheme(currentTheme());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
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
  const theme = useSiteTheme();
  return (
    <iframe
      sandbox={FRAME_SANDBOX}
      title={`API reference for ${apiName}`}
      src={frameSrc(specId, form, theme)}
      referrerPolicy="no-referrer"
      className="block h-[80dvh] min-h-[32rem] w-full bg-sb-bg"
    />
  );
}
