import { z } from "zod";
import { ApiId } from "~/domain/catalog";

export const BenchmarkGroup = z.enum([
  "popular",
  "longtail",
  "ambiguous",
  "negative",
]);
export type BenchmarkGroup = z.infer<typeof BenchmarkGroup>;

/** Outcome kinds as they are written in `benchmark/entries.json`. */
export const ExpectedOutcome = z.enum([
  "Resolved",
  "Ambiguous",
  "Unconfirmed",
  "NoSpec",
  "Unknown",
]);

/** One labelled name of the Benchmark. */
export const BenchmarkEntry = z
  .object({
    name: z.string().min(1),
    group: BenchmarkGroup,
    expected: ExpectedOutcome,
    apiId: ApiId.optional(),
    /** Any of these URLs counts as the correct Current Spec Source. */
    specSources: z.array(z.url()).min(1).optional(),
    /** Expected API ids when the name is Ambiguous. */
    candidates: z.array(ApiId).min(2).optional(),
    /** A page that shows the label is right. */
    evidenceUrl: z.url(),
    reviewed: z.boolean(),
    notes: z.string().optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.expected !== "Resolved") return;
    if (!entry.apiId) {
      ctx.addIssue({
        code: "custom",
        path: ["apiId"],
        message: "apiId is required when expected is Resolved",
      });
    }
    if (!entry.specSources) {
      ctx.addIssue({
        code: "custom",
        path: ["specSources"],
        message: "specSources is required when expected is Resolved",
      });
    }
  });
export type BenchmarkEntry = z.infer<typeof BenchmarkEntry>;

/** The whole of `benchmark/entries.json`; names are unique. */
export const BenchmarkEntries = z
  .array(BenchmarkEntry)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.name)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "name"],
          message: `duplicate name "${entry.name}"`,
        });
      }
      seen.add(entry.name);
    });
  });
