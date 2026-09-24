import { and, asc, eq, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { bestProvenance } from "../domain/provenance";
import { SpecOutline, ValidityIssue } from "../domain/spec-forms";
import {
  FORMS_BUILDER_VERSION,
  type SpecForms,
  SpecFormsError,
} from "../spec-forms/build";
import type { Db } from "./db";
import { sources, specForms, specs } from "./schema";

/**
 * A build that fails this many times is given up: its Spec's forms are
 * `failed`, or, for a rebuild, the old forms are kept.
 */
export const MAX_FORMS_ATTEMPTS = 3;

/**
 * A Spec's forms as a Caller may see them, without the Normalized Form's
 * bytes (`getNormalizedBytes`). Only a `failed` Spec has `error`, and only
 * a `ready` one the other fields.
 */
export type StoredForms = {
  status: "ready" | "pending" | "failed";
  /** Why the last build failed. */
  error?: string;
  normalizedSpecVersion?: string;
  validityIssues?: ValidityIssue[];
  validityFindingCount?: number;
  normalizedFindingCount?: number;
  outline?: SpecOutline;
};

/** A Spec's forms status and every group of its Validity Issues (`getValidity`). */
export type SpecValidity = {
  status: StoredForms["status"];
  validityIssues: ValidityIssue[];
  validityFindingCount: number;
};

/** A Spec's Spec Outline, or why there is none yet (`getOutline`). */
export type StoredOutline =
  | { status: "ready"; outline: SpecOutline }
  | { status: "pending" }
  | { status: "failed"; error: string };

/** What a build of a Spec's forms reads. */
export type FormsBuildInput = {
  bytes: Uint8Array;
  format: "json" | "yaml";
  /**
   * The Source at the Spec's best Provenance, the most recently verified
   * there; `null` for a Spec with no Source.
   */
  sourceUrl: string | null;
};

const ValidityIssues = z.array(ValidityIssue);

/**
 * Whether a build failure can't be cured by trying again: the Published
 * Form is over `MAX_FORMS_BYTES`, or it isn't OpenAPI.
 */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof SpecFormsError &&
    (error.kind === "too-large" || error.kind === "not-openapi")
  );
}

/**
 * The forms worker's lanes (ADR 0004): `"external"` builds the Specs whose
 * build fetches external references, `"local"` all the others, so a Spec
 * whose references take long to fetch never holds up one that has none.
 */
export type FormsLane = "local" | "external";

/** The stored Normalized Forms, Validity Issues and Spec Outlines (ADR 0004). */
export function createSpecForms(db: Db) {
  return {
    /**
     * The next Spec whose forms are pending: it has no row, or one that is
     * neither `ready` nor `failed` (a retry, or a build a stopped process
     * left `building`). Fewest failed attempts first (no row counts as 0),
     * then oldest, so a Spec being retried never holds up one not yet tried.
     * Only among `lane`'s Specs: `"external"` has those whose build is known
     * to fetch external references, `"local"` the rest, including a Spec not
     * yet built.
     *
     * Only when none is pending, the next stale Spec: `ready`, but built by
     * an older `FORMS_BUILDER_VERSION` (or before versions were stored).
     * Current Specs (`superseded_at` null) first, since only they are served
     * by default, then oldest `built_at`; a superseded Spec is still rebuilt,
     * after every Current one in its lane. Its stored forms stay `ready` while it is
     * rebuilt. A `failed` Spec is never rebuilt. `undefined` when there is
     * neither.
     */
    nextToBuild(lane: FormsLane): string | undefined {
      const inLane =
        lane === "external"
          ? eq(specForms.externalRefs, true)
          : or(
              isNull(specForms.externalRefs),
              eq(specForms.externalRefs, false),
            );
      const pending = db
        .select({ id: specs.id })
        .from(specs)
        .leftJoin(specForms, eq(specForms.specId, specs.id))
        .where(
          and(
            or(
              isNull(specForms.specId),
              notInArray(specForms.status, ["ready", "failed"]),
            ),
            inLane,
          ),
        )
        .orderBy(
          asc(sql`coalesce(${specForms.attempts}, 0)`),
          asc(specs.createdAt),
          asc(sql`${specs}.rowid`),
        )
        .get()?.id;
      if (pending !== undefined) return pending;
      return db
        .select({ id: specForms.specId })
        .from(specForms)
        .innerJoin(specs, eq(specs.id, specForms.specId))
        .where(
          and(
            eq(specForms.status, "ready"),
            or(
              isNull(specForms.builderVersion),
              lt(specForms.builderVersion, FORMS_BUILDER_VERSION),
            ),
            inLane,
          ),
        )
        .orderBy(
          asc(sql`${specs.supersededAt} is not null`),
          asc(specForms.builtAt),
          asc(sql`${specForms}.rowid`),
        )
        .get()?.id;
    },

    /** What a build of `specId`'s forms reads; `undefined` for an unknown Spec. */
    buildInput(specId: string): FormsBuildInput | undefined {
      const spec = db
        .select({ bytes: specs.publishedBytes, format: specs.format })
        .from(specs)
        .where(eq(specs.id, specId))
        .get();
      if (!spec) return undefined;
      const found = db
        .select({
          url: sources.url,
          provenance: sources.provenance,
          lastVerifiedAt: sources.lastVerifiedAt,
        })
        .from(sources)
        .where(eq(sources.specId, specId))
        .orderBy(asc(sources.id))
        .all();
      // As `resolved` picks the Provenance: the best tier, verified last.
      const tier = bestProvenance(found.map((s) => s.provenance));
      const source = found
        .filter((s) => s.provenance === tier)
        .reduce<(typeof found)[number] | undefined>(
          (last, s) =>
            !last || s.lastVerifiedAt > last.lastVerifiedAt ? s : last,
          undefined,
        );
      return {
        bytes: new Uint8Array(spec.bytes),
        format: spec.format,
        sourceUrl: source?.url ?? null,
      };
    },

    /**
     * Records that a build of `specId`'s forms started at `at` (ISO). A
     * rebuild of `ready` forms leaves them `ready`: Callers keep getting
     * them until `saveBuilt` replaces them.
     */
    markBuilding(specId: string, at: string): void {
      db.insert(specForms)
        .values({ specId, status: "building", startedAt: at })
        .onConflictDoUpdate({
          target: specForms.specId,
          set: {
            status: sql`case when ${specForms.status} = 'ready' then 'ready' else 'building' end`,
            startedAt: at,
          },
        })
        .run();
    },

    /**
     * Stores a build's forms, built by `FORMS_BUILDER_VERSION`; `specId` is
     * then `ready`, with no failed attempt counted. `externalRefs`, when
     * given, says whether the build fetched external references.
     */
    saveBuilt(
      specId: string,
      forms: SpecForms,
      at: string,
      externalRefs?: boolean,
    ): void {
      const values = {
        status: "ready" as const,
        externalRefs,
        normalizedBytes: Buffer.from(forms.normalized),
        normalizedSpecVersion: forms.normalizedSpecVersion,
        validityIssues: JSON.stringify(forms.validityIssues),
        validityFindingCount: forms.validityFindingCount,
        normalizedFindingCount: forms.normalizedFindingCount,
        outline: JSON.stringify(forms.outline),
        attempts: 0,
        lastError: null,
        builtAt: at,
        builderVersion: FORMS_BUILDER_VERSION,
      };
      db.insert(specForms)
        .values({ specId, ...values })
        .onConflictDoUpdate({ target: specForms.specId, set: values })
        .run();
    },

    /**
     * Hands `specId` over to the `"external"` lane: the `"local"` lane found
     * that its build fetches external references. It stays pending, with no
     * failed attempt counted and no build started.
     */
    handOver(specId: string): void {
      db.update(specForms)
        .set({ externalRefs: true, startedAt: null })
        .where(eq(specForms.specId, specId))
        .run();
    },

    /**
     * Records a failed build. It is retried until `MAX_FORMS_ATTEMPTS`
     * failures, then `failed`; a Published Form over `MAX_FORMS_BYTES`, or
     * one that isn't OpenAPI, is `failed` at once.
     *
     * A failed rebuild of `ready` forms keeps them `ready`. It is retried
     * the same way; when it is given up, the row is stamped with
     * `FORMS_BUILDER_VERSION` so it isn't rebuilt again, and keeps
     * `last_error`.
     */
    saveFailure(specId: string, error: unknown, at: string): void {
      const row = db
        .select({ status: specForms.status, attempts: specForms.attempts })
        .from(specForms)
        .where(eq(specForms.specId, specId))
        .get();
      const attempts = (row?.attempts ?? 0) + 1;
      const failed = attempts >= MAX_FORMS_ATTEMPTS || isPermanent(error);
      const lastError = error instanceof Error ? error.message : String(error);
      if (row?.status === "ready") {
        db.update(specForms)
          .set({
            attempts,
            lastError,
            startedAt: null,
            builderVersion: failed ? FORMS_BUILDER_VERSION : undefined,
          })
          .where(eq(specForms.specId, specId))
          .run();
        return;
      }
      const values = {
        status: failed ? ("failed" as const) : ("building" as const),
        attempts,
        lastError,
        // A retry hasn't started yet; a failed build ended now.
        startedAt: failed ? undefined : null,
        builtAt: failed ? at : undefined,
      };
      db.insert(specForms)
        .values({ specId, ...values })
        .onConflictDoUpdate({ target: specForms.specId, set: values })
        .run();
    },

    /** `specId`'s forms, without the Normalized Form's bytes. */
    getForms(specId: string): StoredForms {
      const row = db
        .select({
          status: specForms.status,
          normalizedSpecVersion: specForms.normalizedSpecVersion,
          validityIssues: specForms.validityIssues,
          validityFindingCount: specForms.validityFindingCount,
          normalizedFindingCount: specForms.normalizedFindingCount,
          outline: specForms.outline,
          lastError: specForms.lastError,
        })
        .from(specForms)
        .where(eq(specForms.specId, specId))
        .get();
      if (!row || row.status === "building") return { status: "pending" };
      if (row.status === "failed")
        return { status: "failed", error: row.lastError ?? "unknown error" };
      return {
        status: "ready",
        normalizedSpecVersion: row.normalizedSpecVersion ?? undefined,
        validityIssues: ValidityIssues.parse(
          JSON.parse(row.validityIssues ?? "[]"),
        ),
        validityFindingCount: row.validityFindingCount ?? 0,
        normalizedFindingCount: row.normalizedFindingCount ?? 0,
        outline: row.outline
          ? SpecOutline.parse(JSON.parse(row.outline))
          : undefined,
      };
    },

    /**
     * `specId`'s forms status and Validity Issues, as an Outcome gives them:
     * only the small columns, never the Normalized Form or the Spec Outline.
     * A Spec that isn't `ready` has none.
     */
    getValidity(specId: string): SpecValidity {
      const row = db
        .select({
          status: specForms.status,
          validityIssues: specForms.validityIssues,
          validityFindingCount: specForms.validityFindingCount,
        })
        .from(specForms)
        .where(eq(specForms.specId, specId))
        .get();
      if (!row || row.status === "building")
        return {
          status: "pending",
          validityIssues: [],
          validityFindingCount: 0,
        };
      if (row.status === "failed")
        return {
          status: "failed",
          validityIssues: [],
          validityFindingCount: 0,
        };
      return {
        status: "ready",
        validityIssues: ValidityIssues.parse(
          JSON.parse(row.validityIssues ?? "[]"),
        ),
        validityFindingCount: row.validityFindingCount ?? 0,
      };
    },

    /**
     * `specId`'s Spec Outline once its forms are `ready`, else its status
     * (and why it failed): only the `outline` column, never the Normalized
     * Form.
     */
    getOutline(specId: string): StoredOutline {
      const row = db
        .select({
          status: specForms.status,
          outline: specForms.outline,
          lastError: specForms.lastError,
        })
        .from(specForms)
        .where(eq(specForms.specId, specId))
        .get();
      if (!row || row.status === "building") return { status: "pending" };
      if (row.status === "failed")
        return { status: "failed", error: row.lastError ?? "unknown error" };
      if (!row.outline)
        return { status: "failed", error: "no Spec Outline was stored" };
      return {
        status: "ready",
        outline: SpecOutline.parse(JSON.parse(row.outline)),
      };
    },

    /** The Normalized Form of a `ready` Spec, as minified JSON; else `undefined`. */
    getNormalizedBytes(specId: string): Uint8Array | undefined {
      const row = db
        .select({ bytes: specForms.normalizedBytes })
        .from(specForms)
        .where(and(eq(specForms.specId, specId), eq(specForms.status, "ready")))
        .get();
      return row?.bytes ? new Uint8Array(row.bytes) : undefined;
    },
  };
}

export type SpecFormsRepo = ReturnType<typeof createSpecForms>;
