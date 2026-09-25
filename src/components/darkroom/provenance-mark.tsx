import type { Provenance } from "~/domain/provenance";
import { cn } from "~/lib/utils";

/** Each tier's line: Official the heaviest, Community the lightest. */
const TIER: Record<Provenance, string> = {
  Official: "border-2 border-current",
  Endorsed: "border border-current",
  Mirror: "border border-dashed border-current",
  Community: "border border-dotted border-current",
};

/** A Spec's Provenance, as a label on a print. */
export function ProvenanceMark({
  provenance,
  className,
}: {
  provenance: Provenance;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-[2px] px-1.5 py-px font-caps text-xs font-semibold uppercase tracking-[0.12em]",
        TIER[provenance],
        className,
      )}
    >
      {provenance}
    </span>
  );
}
