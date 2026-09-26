import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Provenance } from "~/domain/provenance";
import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { apis, sources, specs, vendors } from "~/index-store/schema";
import type { IndexedLookup } from "~/lookup/lookup";

/** One API as the Search page shows it: its Current Spec, from the Index. */
export type IndexPrint = {
  apiId: string;
  apiName: string;
  /** A name the Index answers a Lookup of this API by, for a link to it. */
  lookupName: string;
  vendorName: string;
  specId: string;
  provenance: Provenance | null;
  verifiedAt: string | null;
  /** Older than the freshness window: a Lookup would still answer, and queue a Verification. */
  stale: boolean;
  /** How long the Index took to answer, in milliseconds. */
  ms: number;
};

/** What the Index holds, and the APIs it verified most recently. */
export type IndexStats = {
  vendors: number;
  apis: number;
  /** Confirmed Specs that aren't Superseded. */
  specs: number;
  recent: IndexPrint[];
};

/**
 * The Search page's live facts: counts from the Index and the `limit` APIs
 * whose Specs were verified most recently, each answered as a default Lookup
 * answers it (`currentFromIndex`). Reads only: no Lookup, no Verification is
 * queued, so a page view never makes work.
 */
export function indexStats(
  db: Db,
  lookup: Pick<IndexedLookup, "currentFromIndex">,
  {
    now = new Date(),
    freshnessDays,
    limit = 4,
  }: { now?: Date; freshnessDays: number; limit?: number },
): IndexStats {
  const vendorCount =
    db
      .select({ n: sql<number>`count(distinct ${vendors.id})` })
      .from(vendors)
      .innerJoin(apis, eq(apis.vendorId, vendors.id))
      .get()?.n ?? 0;
  const apiCount =
    db.select({ n: sql<number>`count(*)` }).from(apis).get()?.n ?? 0;
  const specCount =
    db
      .select({ n: sql<number>`count(*)` })
      .from(specs)
      .where(and(isNotNull(specs.confirmedAt), isNull(specs.supersededAt)))
      .get()?.n ?? 0;

  const latest = sql<string>`max(${sources.lastVerifiedAt})`;
  const recentIds = db
    .select({ apiId: specs.apiId, latest })
    .from(specs)
    .innerJoin(sources, eq(sources.specId, specs.id))
    .where(and(isNotNull(specs.confirmedAt), isNull(specs.supersededAt)))
    .groupBy(specs.apiId)
    .orderBy(desc(latest))
    .limit(limit * 2)
    .all();

  const repo = createRepo(db);
  const staleAfterMs = freshnessDays * 24 * 60 * 60 * 1000;
  const recent: IndexPrint[] = [];
  for (const { apiId } of recentIds) {
    if (recent.length >= limit) break;
    const started = performance.now();
    const current = lookup.currentFromIndex(apiId);
    const ms = performance.now() - started;
    if (!current) continue;
    const verifiedAt = current.verifiedAt ?? null;
    const age = verifiedAt ? now.getTime() - Date.parse(verifiedAt) : NaN;
    recent.push({
      apiId,
      apiName: current.api.name,
      lookupName: repo.lookupNameOf(current.api),
      vendorName: current.vendor.name,
      specId: current.currentSpec.id,
      provenance: current.provenance ?? null,
      verifiedAt,
      stale: !(age <= staleAfterMs),
      ms: Math.round(ms * 10) / 10,
    });
  }

  return {
    vendors: vendorCount,
    apis: apiCount,
    specs: specCount,
    recent,
  };
}
