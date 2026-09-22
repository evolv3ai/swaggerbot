/**
 * The fields of a Spec that the Judge sees instead of the whole document
 * (ADR 0001: Jev never reads whole Specs). Built by `sniffSpec` in
 * `src/fetch/sniff.ts`.
 */
export type SpecExtract = {
  title: string | null;
  /** The first 500 characters of `info.description`. */
  description: string | null;
  /** Hostnames from `servers[].url` (OpenAPI 3) or `host` (Swagger 2). */
  serverHosts: string[];
  /** The first 20 tag names. */
  tags: string[];
  /** The first 20 keys of `paths`. */
  samplePaths: string[];
  pathCount: number;
};

export const SPEC_EXTRACT_LIMITS = {
  description: 500,
  tags: 20,
  samplePaths: 20,
} as const;
