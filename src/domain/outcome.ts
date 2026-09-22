import { z } from "zod";
import { Api, Source, Spec, Timestamp, Vendor } from "./catalog";
import { Provenance } from "./provenance";

export const Resolved = z.object({
  outcome: z.literal("Resolved"),
  api: Api,
  vendor: Vendor,
  currentSpec: Spec,
  alternateSpecs: z.array(Spec),
  provenance: Provenance,
  sources: z.array(Source).min(1),
  // Validity Issues arrive in a later slice; until then the list is empty.
  validityIssues: z.array(z.never()),
  verifiedAt: Timestamp,
});

export const Ambiguous = z.object({
  outcome: z.literal("Ambiguous"),
  candidates: z
    .array(
      z.object({
        apiId: z.string().optional(),
        name: z.string().min(1),
        vendor: z.string().optional(),
        probability: z.number().min(0).max(1),
      }),
    )
    .min(2),
});

export const Unconfirmed = z.object({
  outcome: z.literal("Unconfirmed"),
  api: Api,
  vendor: Vendor,
  spec: Spec,
  sources: z.array(Source).min(1),
  reasons: z.array(z.string().min(1)).min(1),
  verifiedAt: Timestamp,
});

export const NoSpec = z.object({
  outcome: z.literal("NoSpec"),
  api: Api,
  vendor: Vendor,
  communityAvailable: z.boolean(),
});

export const Unknown = z.object({
  outcome: z.literal("Unknown"),
  name: z.string(),
});

export const Outcome = z.discriminatedUnion("outcome", [
  Resolved,
  Ambiguous,
  Unconfirmed,
  NoSpec,
  Unknown,
]);
export type Outcome = z.infer<typeof Outcome>;
export type OutcomeKind = Outcome["outcome"];
