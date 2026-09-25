import type { SpecForm } from "~/server/spec-embed";

/**
 * The frame Scalar runs in (`/embed/specs/{specId}`). `sandbox` allows
 * scripts and nothing else: without `allow-same-origin` the frame has an
 * opaque origin, so a Spec's content can't reach this page, its cookies or
 * its storage, open windows, submit forms or navigate the page.
 */
export const FRAME_SANDBOX = "allow-scripts";

export function SpecFrame({
  specId,
  form,
  apiName,
}: {
  specId: string;
  form: SpecForm;
  apiName: string;
}) {
  return (
    <iframe
      sandbox={FRAME_SANDBOX}
      title={`API reference for ${apiName}`}
      src={`/embed/specs/${specId}?form=${form}`}
      referrerPolicy="no-referrer"
      className="block h-[80dvh] min-h-[32rem] w-full rounded-[2px] border border-print-ink bg-print"
    />
  );
}
