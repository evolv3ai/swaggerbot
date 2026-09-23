import { and, asc, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { bestProvenance } from "../domain/provenance";
import { SpecOutline, ValidityIssue } from "../domain/spec-forms";
import { type SpecForms, SpecFormsError } from "../spec-forms/build";
import type { Db } from "./db";
import { sources, specForms, specs } from "./schema";

/** A build that fails this many times is given up: its Spec's forms are `failed`. */
export const MAX_FORMS_ATTEMPTS = 3;

/**
 * A Spec's forms as a Caller may see them, without the Normalized Form's
 * bytes (`getNormalizedBytes`). Only a `ready` Spec has the other fields.
 */
export type StoredForms = {
  status: "ready" | "pending" | "failed";
  normalizedSpecVersion?: string;
  validityIssues?: ValidityIssue[];
  validityFindingCount?: number;
  normalizedFindingCount?: number;
  outline?: SpecOutline;
};

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

/** The stored Normalized Forms, Validity Issues and Spec Outlines (ADR 0004). */
export function createSpecForms(db: Db) {
  return {
    /**
     * The oldest Spec whose forms are pending: it has no row, or one that is
     * neither `ready` nor `failed` (a retry, or a build a stopped process
     * left `building`). `undefined` when there is none.
     */
    nextToBuild(): string | undefined {
      return db
        .select({ id: specs.id })
        .from(specs)
        .leftJoin(specForms, eq(specForms.specId, specs.id))
        .where(
          or(
            isNull(specForms.specId),
            notInArray(specForms.status, ["ready", "failed"]),
          ),
        )
        .orderBy(asc(specs.createdAt), asc(sql`${specs}.rowid`))
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

    /** Records that a build of `specId`'s forms started at `at` (ISO). */
    markBuilding(specId: string, at: string): void {
      db.insert(specForms)
        .values({ specId, status: "building", startedAt: at })
        .onConflictDoUpdate({
          target: specForms.specId,
          set: { status: "building", startedAt: at },
        })
        .run();
    },

    /** Stores a build's forms; `specId` is then `ready`. */
    saveBuilt(specId: string, forms: SpecForms, at: string): void {
      const values = {
        status: "ready" as const,
        normalizedBytes: Buffer.from(forms.normalized),
        normalizedSpecVersion: forms.normalizedSpecVersion,
        validityIssues: JSON.stringify(forms.validityIssues),
        validityFindingCount: forms.validityFindingCount,
        normalizedFindingCount: forms.normalizedFindingCount,
        outline: JSON.stringify(forms.outline),
        lastError: null,
        builtAt: at,
      };
      db.insert(specForms)
        .values({ specId, ...values })
        .onConflictDoUpdate({ target: specForms.specId, set: values })
        .run();
    },

    /**
     * Records a failed build. It is retried until `MAX_FORMS_ATTEMPTS`
     * failures, then `failed`; a Published Form over `MAX_FORMS_BYTES`, or
     * one that isn't OpenAPI, is `failed` at once.
     */
    saveFailure(specId: string, error: unknown, at: string): void {
      const attempts =
        (db
          .select({ attempts: specForms.attempts })
          .from(specForms)
          .where(eq(specForms.specId, specId))
          .get()?.attempts ?? 0) + 1;
      const failed = attempts >= MAX_FORMS_ATTEMPTS || isPermanent(error);
      const values = {
        status: failed ? ("failed" as const) : ("building" as const),
        attempts,
        lastError: error instanceof Error ? error.message : String(error),
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
        })
        .from(specForms)
        .where(eq(specForms.specId, specId))
        .get();
      if (!row || row.status === "building") return { status: "pending" };
      if (row.status === "failed") return { status: "failed" };
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
