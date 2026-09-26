import type { OutcomeKind } from "~/domain/outcome";
import { cn } from "~/lib/utils";

/**
 * The test strip as the scale of how sure an answer is: one density per
 * Outcome, densest for Resolved; Unknown is an empty cell. `short` is the
 * label on a phone, where the full names don't fit five across.
 */
export const CERTAINTY = [
  {
    kind: "Resolved",
    outcome: "Resolved",
    short: "Resolved",
    swatch: "bg-strip-5",
  },
  {
    kind: "Unconfirmed",
    outcome: "Unconfirmed",
    short: "Unconf.",
    swatch: "bg-strip-4",
  },
  {
    kind: "Ambiguous",
    outcome: "Ambiguous",
    short: "Ambig.",
    swatch: "bg-strip-3",
  },
  {
    kind: "NoSpec",
    outcome: "No Spec",
    short: "No Spec",
    swatch: "bg-strip-2",
  },
  // Nothing developed: an empty cell (not enamel, reserved for prints),
  // hatched in the rule colour so it never reads as Resolved's black.
  {
    kind: "Unknown",
    outcome: "Unknown",
    short: "Unknown",
    swatch: "bg-undeveloped",
  },
] as const satisfies readonly {
  kind: OutcomeKind;
  outcome: string;
  short: string;
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
            title={step.outcome}
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
                "whitespace-nowrap border-t border-rule bg-bay-deep px-0.5 py-1 text-center font-caps text-xs font-semibold uppercase leading-tight tracking-[0.12em]",
                i === at && "bg-ink text-bay",
              )}
            >
              {step.short === step.outcome ? (
                step.outcome
              ) : (
                <>
                  <span aria-hidden="true" className="sm:hidden">
                    {step.short}
                  </span>
                  <span className="max-sm:sr-only">{step.outcome}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
