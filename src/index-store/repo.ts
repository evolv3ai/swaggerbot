import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  Api,
  type Source,
  type Spec,
  type SpecFormat,
  Vendor,
} from "../domain/catalog";
import { Provenance } from "../domain/provenance";
import type { Db } from "./db";
import { apiNames, apis, sources, specs, vendors } from "./schema";

export type SpecMeta = {
  specVersion: string;
  apiVersion: string | null;
  /** Default false. */
  isPreview?: boolean;
  format: SpecFormat;
  /** How many paths it has; default null, unknown. */
  pathCount?: number | null;
  /** Its Vendor marks it deprecated. Default false. */
  deprecated?: boolean;
  /** Its place among the Choice's origin URLs; default null, not found at one. */
  originRank?: number | null;
};

/**
 * What the Current Spec rules read of a stored Spec, beside its API Version.
 * Kept out of the domain Spec, and so out of the Outcome.
 */
export type SpecRanking = {
  /** null for a Spec stored before path counts were kept. */
  pathCount: number | null;
  deprecated: boolean;
  /** null when it was not found at an origin URL, or stored before this was kept. */
  originRank: number | null;
};

export type ApiWithSpecs = {
  api: Api;
  vendor: Vendor;
  /** Oldest first. `confirmedAt` is null for a Spec that is only Unconfirmed. */
  specs: ({
    spec: Spec;
    sources: Source[];
    confirmedAt: string | null;
  } & SpecRanking)[];
};

/**
 * The key a name is remembered under: lowercased, trimmed, whitespace
 * collapsed, and a trailing " api" stripped (`"Stripe  API "` → `"stripe"`).
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ").replace(/ api$/, "");
}

/** Lowercase hex sha256 of a Spec's Published Form: its Spec id. */
export function specIdOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const nowIso = () => new Date().toISOString();

const specColumns = {
  id: specs.id,
  apiId: specs.apiId,
  specVersion: specs.specVersion,
  apiVersion: specs.apiVersion,
  isPreview: specs.isPreview,
  supersededAt: specs.supersededAt,
  format: specs.format,
  byteLength: specs.byteLength,
};

const apiColumns = { id: apis.id, vendorId: apis.vendorId, name: apis.name };

const vendorColumns = {
  id: vendors.id,
  name: vendors.name,
  domain: vendors.domain,
};

/** Synchronous access to the Index. */
export function createRepo(db: Db) {
  function getSpec(specId: string): Spec | undefined {
    return db.select(specColumns).from(specs).where(eq(specs.id, specId)).get();
  }

  function sourcesOf(specId: string): Source[] {
    return db
      .select()
      .from(sources)
      .where(eq(sources.specId, specId))
      .orderBy(asc(sources.id))
      .all();
  }

  return {
    upsertVendor(input: Vendor): Vendor {
      const vendor = Vendor.parse(input);
      db.insert(vendors)
        .values(vendor)
        .onConflictDoUpdate({
          target: vendors.id,
          set: {
            name: vendor.name,
            domain: vendor.domain,
            updatedAt: nowIso(),
          },
        })
        .run();
      return vendor;
    },

    upsertApi(input: Api): Api {
      const api = Api.parse(input);
      db.insert(apis)
        .values(api)
        .onConflictDoUpdate({
          target: apis.id,
          set: { vendorId: api.vendorId, name: api.name, updatedAt: nowIso() },
        })
        .run();
      return api;
    },

    /**
     * Stores a Spec's Published Form under its sha256. Storing the same bytes
     * again keeps the stored Spec, takes its API Version, Preview flag, path
     * count, deprecation and origin rank as read now, and clears
     * `supersededAt`: it was just found being served.
     */
    putSpec(apiId: string, bytes: Uint8Array, meta: SpecMeta): Spec {
      const id = specIdOf(bytes);
      const version = {
        apiVersion: meta.apiVersion,
        isPreview: meta.isPreview ?? false,
        pathCount: meta.pathCount ?? null,
        deprecated: meta.deprecated ?? false,
        originRank: meta.originRank ?? null,
      };
      db.insert(specs)
        .values({
          id,
          apiId,
          specVersion: meta.specVersion,
          ...version,
          format: meta.format,
          byteLength: bytes.byteLength,
          publishedBytes: Buffer.from(bytes),
        })
        .onConflictDoUpdate({
          target: specs.id,
          set: { ...version, supersededAt: null },
        })
        .run();
      const spec = getSpec(id);
      if (!spec) throw new Error(`Spec ${id} missing after insert`);
      return spec;
    },

    /** Marks a Spec as confirmed to describe its API; the first confirmation is kept. */
    confirmSpec(specId: string, at: string): void {
      db.update(specs)
        .set({ confirmedAt: at })
        .where(and(eq(specs.id, specId), isNull(specs.confirmedAt)))
        .run();
    },

    /**
     * Marks a Spec Superseded: every Source stopped serving it. The first
     * time is kept; `putSpec` of its bytes clears it.
     */
    supersedeSpec(specId: string, at: string): void {
      db.update(specs)
        .set({ supersededAt: at })
        .where(and(eq(specs.id, specId), isNull(specs.supersededAt)))
        .run();
    },

    /**
     * Records where a Spec was found. Adding the same url again returns the
     * existing Source. With `verifiedAt` (an ISO timestamp), a new Source is
     * first seen then, and an existing one is marked verified then and takes
     * `provenance`, the tier as computed now.
     */
    addSource(
      specId: string,
      url: string,
      provenance: Provenance,
      verifiedAt?: string,
    ): Source {
      const tier = Provenance.parse(provenance);
      const insert = db.insert(sources).values({
        specId,
        url,
        provenance: tier,
        ...(verifiedAt
          ? { firstSeenAt: verifiedAt, lastVerifiedAt: verifiedAt }
          : {}),
      });
      const target = [sources.specId, sources.url];
      if (verifiedAt)
        insert
          .onConflictDoUpdate({
            target,
            set: { lastVerifiedAt: verifiedAt, provenance: tier },
          })
          .run();
      else insert.onConflictDoNothing({ target }).run();
      const source = db
        .select()
        .from(sources)
        .where(and(eq(sources.specId, specId), eq(sources.url, url)))
        .get();
      if (!source) throw new Error(`Source ${url} missing after insert`);
      return source;
    },

    /** Remembers that `name` means `apiId`, so a later Lookup of it is answered from the Index. */
    rememberName(name: string, apiId: string): void {
      const nameNormalized = normalizeName(name);
      db.insert(apiNames)
        .values({ nameNormalized, apiId })
        .onConflictDoUpdate({ target: apiNames.nameNormalized, set: { apiId } })
        .run();
    },

    /**
     * A Spec's Published Form as stored, byte for byte, with its format and
     * API id; `undefined` for an unknown Spec.
     */
    getPublished(
      specId: string,
    ): { bytes: Uint8Array; format: SpecFormat; apiId: string } | undefined {
      const row = db
        .select({
          bytes: specs.publishedBytes,
          format: specs.format,
          apiId: specs.apiId,
        })
        .from(specs)
        .where(eq(specs.id, specId))
        .get();
      return row && { ...row, bytes: new Uint8Array(row.bytes) };
    },

    findApiByName(name: string): Api | undefined {
      return db
        .select(apiColumns)
        .from(apiNames)
        .innerJoin(apis, eq(apis.id, apiNames.apiId))
        .where(eq(apiNames.nameNormalized, normalizeName(name)))
        .get();
    },

    getApiWithSpecs(apiId: string): ApiWithSpecs | undefined {
      const row = db
        .select({ api: apiColumns, vendor: vendorColumns })
        .from(apis)
        .innerJoin(vendors, eq(vendors.id, apis.vendorId))
        .where(eq(apis.id, apiId))
        .get();
      if (!row) return undefined;
      const apiSpecs = db
        .select({
          spec: specColumns,
          confirmedAt: specs.confirmedAt,
          pathCount: specs.pathCount,
          deprecated: specs.deprecated,
          originRank: specs.originRank,
        })
        .from(specs)
        .where(eq(specs.apiId, apiId))
        .orderBy(asc(specs.createdAt), asc(specs.id))
        .all();
      return {
        ...row,
        specs: apiSpecs.map(({ spec, ...rest }) => ({
          spec,
          sources: sourcesOf(spec.id),
          ...rest,
        })),
      };
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
