import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import type { IndexPrint } from "~/server/index-stats";
import { ProvenanceMark } from "./provenance-mark";
import { VerifiedStamp } from "./stamp";

/** Image density by recency: the newest print is the densest; a Stale one is washed. */
const DENSITY = [
  { field: "bg-strip-5", text: "text-white" },
  { field: "bg-strip-4", text: "text-white" },
  { field: "bg-strip-3", text: "text-[#0e0e0e]" },
] as const;
/** A Stale print: warm, washed silver, a tone the certainty strip doesn't use. */
const WASHED = { field: "bg-[#a39c8f]", text: "text-[#0e0e0e]" } as const;

/**
 * One API's Current Spec as a print. The image is a density field (recency:
 * `rank` 0 is the newest) carrying the measured answer time; the facts are on
 * the label below. `developing` runs the print's one motion, the image coming
 * up out of the paper (none under reduced motion). With `href`, the API's
 * name links there (the replay links each print to its Lookup). `children`
 * sit on the label under its facts: the Spec's actions, on a Resolved
 * Lookup.
 */
export function Print({
  print,
  rank = 0,
  developing = false,
  headingLevel: Heading = "h3",
  href,
  className,
  children,
}: {
  print: IndexPrint;
  href?: string;
  children?: ReactNode;
  rank?: number;
  developing?: boolean;
  headingLevel?: "h2" | "h3";
  className?: string;
}) {
  const stale = print.stale;
  const tone = stale
    ? WASHED
    : (DENSITY[Math.min(rank, DENSITY.length - 1)] ?? DENSITY[0]);
  return (
    <article
      className={cn(
        "grid gap-4 rounded-[3px] bg-print p-3 text-print-ink shadow-[0_6px_18px_-6px_rgb(0_0_0/0.45)]",
        className,
      )}
    >
      <div
        key={print.apiId}
        className={cn(
          "flex min-h-32 items-end justify-between gap-4 rounded-[2px] px-4 py-3",
          tone.field,
          tone.text,
          developing && "print-develop",
        )}
      >
        <span className="font-caps text-xs font-semibold uppercase tracking-[0.14em]">
          Answered in
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-segment text-4xl leading-none">
            {print.ms.toFixed(1)}
          </span>
          <span className="font-caps text-sm font-semibold uppercase">ms</span>
        </span>
      </div>
      <div className="grid gap-2 px-1 pb-1">
        <Heading className="font-caps text-2xl font-semibold uppercase leading-tight tracking-wide">
          {href ? <a href={href}>{print.apiName}</a> : print.apiName}
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
        {children}
      </div>
    </article>
  );
}
