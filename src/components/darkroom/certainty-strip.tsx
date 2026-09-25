import type { OutcomeKind } from "~/domain/outcome";
import { cn } from "~/lib/utils";

/**
 * The test strip as the scale of how sure an answer is: one density per
 * Outcome, densest for Resolved; Unknown is an empty cell.
 */
export const CERTAINTY = [
  { kind: "Resolved", outcome: "Resolved", swatch: "bg-strip-5" },
  { kind: "Unconfirmed", outcome: "Unconfirmed", swatch: "bg-strip-4" },
  { kind: "Ambiguous", outcome: "Ambiguous", swatch: "bg-strip-3" },
  { kind: "NoSpec", outcome: "No Spec", swatch: "bg-strip-2" },
  // Nothing developed: an empty cell, not enamel (reserved for prints).
  { kind: "Unknown", outcome: "Unknown", swatch: "bg-transparent" },
] as const satisfies readonly {
  kind: OutcomeKind;
  outcome: string;
  swatch: string;
}[];

/**
 * The scale as a legend. With `outcome`, it marks where one answer sits on
 * it: that cell is outlined in ink and named in the caption.
 */
export function CertaintyStrip({
  outcome,
  className,
}: {
  outcome?: OutcomeKind;
  className?: string;
}) {
  const at = CERTAINTY.findIndex((step) => step.kind === outcome);
  return (
    <figure className={cn("grid gap-1.5", className)}>
      <figcaption className="font-caps text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">
        {at < 0
          ? "Every answer is one of five, from sure to not found"
          : `This answer: ${CERTAINTY[at]?.outcome}, ${at + 1} of five, from sure to not found`}
      </figcaption>
      <ol className="grid grid-cols-5 overflow-hidden rounded-[2px] border border-rule">
        {CERTAINTY.map((step, i) => (
          <li
            key={step.outcome}
            aria-current={i === at ? "true" : undefined}
            className={cn(
              "grid",
              i === at &&
                "relative z-10 outline-2 -outline-offset-2 outline-ink",
            )}
          >
            <span aria-hidden="true" className={cn("h-4", step.swatch)} />
            <span
              className={cn(
                "border-t border-rule bg-bay-deep px-1 py-1 text-center font-caps text-[0.7rem] font-semibold uppercase leading-tight tracking-wide sm:text-xs",
                i === at && "bg-ink text-bay",
              )}
            >
              {step.outcome}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
