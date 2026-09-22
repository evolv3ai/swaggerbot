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
  format: SpecFormat;
};

export type ApiWithSpecs = {
  api: Api;
  vendor: Vendor;
  /** Oldest first. `confirmedAt` is null for a Spec that is only Unconfirmed. */
  specs: { spec: Spec; sources: Source[]; confirmedAt: string | null }[];
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
     * again returns the existing Spec unchanged.
     */
    putSpec(apiId: string, bytes: Uint8Array, meta: SpecMeta): Spec {
      const id = specIdOf(bytes);
      db.insert(specs)
        .values({
          id,
          apiId,
          specVersion: meta.specVersion,
          apiVersion: meta.apiVersion,
          format: meta.format,
          byteLength: bytes.byteLength,
          publishedBytes: Buffer.from(bytes),
        })
        .onConflictDoNothing({ target: specs.id })
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
     * Records where a Spec was found. Adding the same url again returns the
     * existing Source. With `verifiedAt` (an ISO timestamp), a new Source is
     * first seen then, and an existing one is marked verified then.
     */
    addSource(
      specId: string,
      url: string,
      provenance: Provenance,
      verifiedAt?: string,
    ): Source {
      const insert = db.insert(sources).values({
        specId,
        url,
        provenance: Provenance.parse(provenance),
        ...(verifiedAt
          ? { firstSeenAt: verifiedAt, lastVerifiedAt: verifiedAt }
          : {}),
      });
      const target = [sources.specId, sources.url];
      if (verifiedAt)
        insert
          .onConflictDoUpdate({ target, set: { lastVerifiedAt: verifiedAt } })
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
        .select({ spec: specColumns, confirmedAt: specs.confirmedAt })
        .from(specs)
        .where(eq(specs.apiId, apiId))
        .orderBy(asc(specs.createdAt), asc(specs.id))
        .all();
      return {
        ...row,
        specs: apiSpecs.map(({ spec, confirmedAt }) => ({
          spec,
          sources: sourcesOf(spec.id),
          confirmedAt,
        })),
      };
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
