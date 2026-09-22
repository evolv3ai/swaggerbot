import { z } from "zod";

/** Provenance tiers, strongest first. */
export const PROVENANCE_TIERS = [
  "Official",
  "Endorsed",
  "Mirror",
  "Community",
] as const;

export const Provenance = z.enum(PROVENANCE_TIERS);
export type Provenance = z.infer<typeof Provenance>;

/** The strongest Provenance in `list`, or `undefined` when it is empty. */
export function bestProvenance(
  list: readonly Provenance[],
): Provenance | undefined {
  let best: Provenance | undefined;
  for (const p of list) {
    if (
      best === undefined ||
      PROVENANCE_TIERS.indexOf(p) < PROVENANCE_TIERS.indexOf(best)
    )
      best = p;
  }
  return best;
}
