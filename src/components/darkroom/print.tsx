import { cn } from "~/lib/utils";
import type { IndexPrint } from "~/server/index-stats";
import { ProvenanceMark } from "./provenance-mark";
import { VerifiedStamp } from "./stamp";

/**
 * One API's Current Spec as a print: the name exposed on the image, the
 * facts on the label below. `developing` runs the print's one motion, the
 * image coming up out of the paper (none under reduced motion).
 */
export function Print({
  print,
  developing = false,
  headingLevel: Heading = "h3",
  className,
}: {
  print: IndexPrint;
  developing?: boolean;
  headingLevel?: "h2" | "h3";
  className?: string;
}) {
  const stale = print.stale;
  return (
    <article
      className={cn(
        "grid gap-4 rounded-[3px] bg-print p-3 text-print-ink shadow-[0_6px_18px_-6px_rgb(0_0_0/0.45)]",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "relative grid min-h-36 place-items-center overflow-hidden rounded-[2px] bg-strip-5 px-4 py-6",
          stale && "bg-strip-4",
        )}
      >
        <span
          key={print.apiId}
          className={cn(
            "text-center font-pencil text-[clamp(2rem,5vw,3.25rem)] leading-none text-print",
            developing && "print-develop",
          )}
        >
          {print.apiName}
        </span>
      </div>
      <div className="grid gap-2 px-1 pb-1">
        <Heading className="font-caps text-xl font-semibold uppercase tracking-wide">
          {print.apiName}
        </Heading>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-caps uppercase tracking-wider text-print-ink-2">
            Vendor
          </dt>
          <dd className="text-right">{print.vendorName}</dd>
          <dt className="font-caps uppercase tracking-wider text-print-ink-2">
            Provenance
          </dt>
          <dd className="text-right">
            {print.provenance ? (
              <ProvenanceMark provenance={print.provenance} />
            ) : (
              "None confirmed"
            )}
          </dd>
          <dt className="font-caps uppercase tracking-wider text-print-ink-2">
            Verified
          </dt>
          <dd className="text-right">
            <VerifiedStamp verifiedAt={print.verifiedAt} stale={stale} />
          </dd>
          <dt className="font-caps uppercase tracking-wider text-print-ink-2">
            Spec
          </dt>
          <dd className="truncate text-right font-mono text-xs leading-5">
            {print.specId.slice(0, 12)}
          </dd>
        </dl>
      </div>
    </article>
  );
}
