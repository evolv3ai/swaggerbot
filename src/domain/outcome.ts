import { z } from "zod";
import { Api, Source, Spec, Timestamp, Vendor } from "./catalog";
import { Provenance } from "./provenance";
import { ValidityIssue } from "./spec-forms";

/** The most Validity Issues an Outcome carries: the groups with the highest `count`. */
export const MAX_OUTCOME_VALIDITY_ISSUES = 50;

/**
 * A Spec as an Outcome gives it: the Spec, where to download its Published
 * Form and Normalized Form, and whether the Normalized Form is built yet
 * (ADR 0004: it is `pending` until the background worker has built it).
 */
export const SpecAnswer = Spec.extend({
  downloads: z.object({ published: z.string(), normalized: z.string() }),
  normalized: z.enum(["ready", "pending", "failed"]),
});
export type SpecAnswer = z.infer<typeof SpecAnswer>;

/**
 * The Validity Issues of the Spec an Outcome answers with: at most
 * `MAX_OUTCOME_VALIDITY_ISSUES` groups, the largest `count` first, and the
 * total count of findings, 0 while its forms are pending.
 */
const validity = {
  validityIssues: z.array(ValidityIssue).max(MAX_OUTCOME_VALIDITY_ISSUES),
  validityIssueCount: z.number().int().nonnegative(),
};

/**
 * What went wrong along the way (a Judge or search error, a Source that could
 * not be fetched), for the Caller to read. Present only when something did.
 */
const diagnostics = z.array(z.string().min(1)).optional();

/**
 * Diagnostic: how long each step of the Lookup took, in milliseconds,
 * rounded, by step name. Present only when the Lookup is traced
 * (`LOOKUP_TRACE=1`); a Caller must not rely on it.
 */
const timings = z.record(z.string(), z.number().int().nonnegative()).optional();

export const Resolved = z.object({
  outcome: z.literal("Resolved"),
  api: Api,
  vendor: Vendor,
  currentSpec: SpecAnswer,
  alternateSpecs: z.array(SpecAnswer),
  provenance: Provenance,
  sources: z.array(Source).min(1),
  ...validity,
  verifiedAt: Timestamp,
  diagnostics,
  timings,
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
  diagnostics,
  timings,
});

export const Unconfirmed = z.object({
  outcome: z.literal("Unconfirmed"),
  api: Api,
  vendor: Vendor,
  spec: SpecAnswer,
  sources: z.array(Source).min(1),
  reasons: z.array(z.string().min(1)).min(1),
  ...validity,
  verifiedAt: Timestamp,
  diagnostics,
  timings,
});

export const NoSpec = z.object({
  outcome: z.literal("NoSpec"),
  api: Api,
  vendor: Vendor,
  communityAvailable: z.boolean(),
  diagnostics,
  timings,
});

export const Unknown = z.object({
  outcome: z.literal("Unknown"),
  name: z.string(),
  diagnostics,
  timings,
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

/**
 * An Outcome as the Lookup pipeline builds it, before `withSpecForms` adds
 * each Spec's downloads and forms status and the Validity Issues: its Specs
 * are plain `Spec`s.
 */
export type BareOutcome = Outcome extends infer O
  ? O extends { outcome: "Resolved" }
    ? Omit<
        O,
        | "currentSpec"
        | "alternateSpecs"
        | "validityIssues"
        | "validityIssueCount"
      > & { currentSpec: Spec; alternateSpecs: Spec[] }
    : O extends { outcome: "Unconfirmed" }
      ? Omit<O, "spec" | "validityIssues" | "validityIssueCount"> & {
          spec: Spec;
        }
      : O
  : never;
