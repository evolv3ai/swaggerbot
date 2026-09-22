import { z } from "zod";

export const SPEC_EXTRACT_DESCRIPTION_MAX = 500;
export const SPEC_EXTRACT_LIST_MAX = 20;

/**
 * The few fields of a Spec that are sent to a Judge. A whole Spec is never
 * sent (ADR 0001): code extracts these and the Judge sees only them.
 */
export const SpecExtract = z.object({
  title: z.string(),
  /** The Spec's `info.description`, first 500 characters. */
  description: z.string().max(SPEC_EXTRACT_DESCRIPTION_MAX),
  /** Hosts of the Spec's `servers` (or Swagger 2.0 `host`). */
  serverHosts: z.array(z.string()),
  /** Tag names, first 20. */
  tags: z.array(z.string()).max(SPEC_EXTRACT_LIST_MAX),
  /** Path templates, first 20. */
  samplePaths: z.array(z.string()).max(SPEC_EXTRACT_LIST_MAX),
  /** Number of paths in the whole Spec. */
  pathCount: z.number().int().nonnegative(),
});
export type SpecExtract = z.infer<typeof SpecExtract>;

/** Cut an extract down to the limits above, whoever built it. */
export function clampSpecExtract(extract: SpecExtract): SpecExtract {
  return {
    title: extract.title,
    description: extract.description.slice(0, SPEC_EXTRACT_DESCRIPTION_MAX),
    serverHosts: extract.serverHosts,
    tags: extract.tags.slice(0, SPEC_EXTRACT_LIST_MAX),
    samplePaths: extract.samplePaths.slice(0, SPEC_EXTRACT_LIST_MAX),
    pathCount: extract.pathCount,
  };
}
