import type { Api, Source, Vendor } from "~/domain/catalog";
import { bestProvenance, type Provenance } from "~/domain/provenance";
import type { ValidityIssue } from "~/domain/spec-forms";
import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import type { IndexedLookup } from "~/lookup/lookup";
import { isSpecId } from "./downloads";
import { type SpecForm, tooLargeToView } from "./spec-embed";

/** Another Spec of the same API, as the viewer links to it. */
export type AlternateSpec = {
  specId: string;
  apiVersion: string | null;
  specVersion: string;
  /** The API's Current Spec, as a default Lookup answers it. */
  current: boolean;
};

/** What the Spec viewer (`/specs/{specId}`) shows around the frame. */
export type SpecView = {
  api: Api;
  /** A name the Index answers a Lookup of the API by, for a link to it. */
  lookupName: string;
  vendor: Vendor;
  spec: {
    id: string;
    specVersion: string;
    apiVersion: string | null;
    isPreview: boolean;
    superseded: boolean;
    /** The API's Current Spec, as a default Lookup answers it. */
    current: boolean;
  };
  /** Its best Provenance; null for a Spec with no Source. */
  provenance: Provenance | null;
  /** When a Source at that Provenance was last verified. */
  verifiedAt: string | null;
  /** Where this Spec was found: each Source, as a Lookup result lists them. */
  sources: Pick<Source, "id" | "url" | "provenance" | "lastVerifiedAt">[];
  stale: boolean;
  /** The form the page shows. */
  form: SpecForm;
  forms: {
    published: { bytes: number; format: "json" | "yaml"; url: string };
    normalized:
      | { status: "ready"; bytes: number; url: string }
      | { status: "pending"; url: string }
      | { status: "failed"; error: string; url: string };
  };
  /** Every group of Validity Issues, the largest first; empty until the forms are built. */
  validityIssues: ValidityIssue[];
  validityFindingCount: number;
  /**
   * Whether the frame is loaded: the chosen form exists and is at most
   * `MAX_VIEW_BYTES`.
   */
  frame: "show" | "too-large" | "pending" | "failed";
  /** The Spec Outline of this Spec, for a Spec too large to view. */
  outlineUrl: string;
  alternates: AlternateSpec[];
};

/**
 * The Spec viewer's facts for `specId`, from the Index alone: its API and
 * Vendor, its own Provenance, `verifiedAt` and Sources, both forms with their sizes,
 * its Validity Issues, and the API's other Specs as a default Lookup answers
 * them (`currentFromIndex`). Reads only. `null` for an unknown Spec.
 */
export function specView(
  db: Db,
  lookup: Pick<IndexedLookup, "currentFromIndex">,
  specId: string,
  form: SpecForm,
  { now = new Date(), freshnessDays }: { now?: Date; freshnessDays: number },
): SpecView | null {
  if (!isSpecId(specId)) return null;
  const repo = createRepo(db);
  const spec = repo.getSpec(specId);
  if (!spec) return null;
  const stored = repo.getApiWithSpecs(spec.apiId);
  if (!stored) return null;
  const sources = stored.specs.find((s) => s.spec.id === specId)?.sources ?? [];
  const provenance = bestProvenance(sources.map((s) => s.provenance)) ?? null;
  const verifiedAt =
    sources
      .filter((s) => s.provenance === provenance)
      .map((s) => s.lastVerifiedAt)
      .sort()
      .at(-1) ?? null;
  const age = verifiedAt ? now.getTime() - Date.parse(verifiedAt) : NaN;

  const forms = createSpecForms(db);
  const validity = forms.getValidity(specId);
  const normalizedBytes = forms.getNormalizedByteLength(specId);
  const urls = {
    published: `/api/specs/${specId}/published`,
    normalized: `/api/specs/${specId}/normalized`,
  };
  const normalized: SpecView["forms"]["normalized"] =
    normalizedBytes !== undefined
      ? { status: "ready", bytes: normalizedBytes, url: urls.normalized }
      : validity.status === "failed"
        ? {
            status: "failed",
            error: forms.getForms(specId).error ?? "unknown error",
            url: urls.normalized,
          }
        : { status: "pending", url: urls.normalized };
  const chosen = form === "published" ? spec.byteLength : normalizedBytes;
  const frame: SpecView["frame"] =
    chosen === undefined
      ? normalized.status === "failed"
        ? "failed"
        : "pending"
      : tooLargeToView(chosen)
        ? "too-large"
        : "show";

  const current = lookup.currentFromIndex(spec.apiId);
  const listed = current
    ? [current.currentSpec, ...current.alternateSpecs]
    : [];
  const alternates = listed
    .filter((s) => s.id !== specId)
    .map((s) => ({
      specId: s.id,
      apiVersion: s.apiVersion,
      specVersion: s.specVersion,
      current: s.id === current?.currentSpec.id,
    }));

  return {
    api: stored.api,
    lookupName: repo.lookupNameOf(stored.api),
    vendor: stored.vendor,
    spec: {
      id: spec.id,
      specVersion: spec.specVersion,
      apiVersion: spec.apiVersion,
      isPreview: spec.isPreview,
      superseded: spec.supersededAt !== null,
      current: current?.currentSpec.id === specId,
    },
    provenance,
    verifiedAt,
    sources: sources.map(({ id, url, provenance, lastVerifiedAt }) => ({
      id,
      url,
      provenance,
      lastVerifiedAt,
    })),
    stale: !(age <= freshnessDays * 24 * 60 * 60 * 1000),
    form,
    forms: {
      published: {
        bytes: spec.byteLength,
        format: spec.format,
        url: urls.published,
      },
      normalized,
    },
    validityIssues: [...validity.validityIssues].sort(
      (a, b) => b.count - a.count,
    ),
    validityFindingCount: validity.validityFindingCount,
    frame,
    outlineUrl: `/api/apis/${spec.apiId}/outline?specId=${specId}`,
    alternates,
  };
}
