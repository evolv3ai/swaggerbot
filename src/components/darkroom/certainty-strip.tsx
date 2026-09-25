import { cn } from "~/lib/utils";

/**
 * The test strip as the scale of how sure an answer is: one density per
 * Outcome, densest for Resolved. The same ladder prints use.
 */
const STEPS = [
  { outcome: "Resolved", swatch: "bg-strip-5" },
  { outcome: "Unconfirmed", swatch: "bg-strip-4" },
  { outcome: "Ambiguous", swatch: "bg-strip-3" },
  { outcome: "No Spec", swatch: "bg-strip-2" },
  { outcome: "Unknown", swatch: "bg-strip-1" },
] as const;

export function CertaintyStrip({ className }: { className?: string }) {
  return (
    <figure className={cn("grid gap-1.5", className)}>
      <figcaption className="font-caps text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">
        Every answer is one of five, from sure to not found
      </figcaption>
      <ol className="grid grid-cols-5 overflow-hidden rounded-[2px] border border-rule">
        {STEPS.map((step) => (
          <li key={step.outcome} className="grid">
            <span aria-hidden="true" className={cn("h-4", step.swatch)} />
            <span className="border-t border-rule bg-bay-deep px-1 py-1 text-center font-caps text-[0.7rem] font-semibold uppercase leading-tight tracking-wide sm:text-xs">
              {step.outcome}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
