import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "./db";
import { apiKeys, apiKeyUsage } from "./schema";

/** Discovery or `fresh` Lookups a key may make a UTC day, unless `DAILY_QUOTA` or its own quota says otherwise. */
export const DEFAULT_DAILY_QUOTA = 100;

/** An API key as it may be shown: never its hash or its secret. */
export type ApiKey = {
  id: string;
  owner: string;
  /** null means the default (`dailyQuotaOf`). */
  dailyQuota: number | null;
  createdAt: string;
  revokedAt: string | null;
};

export type QuotaUse = { allowed: boolean; used: number; limit: number };

/**
 * What verifying a key spends: 0 for a request the Index answers (a bad key
 * is still refused, and nothing is spent), 1 for Discovery or `fresh`.
 */
export type KeyCost = 0 | 1;

export type VerifyOptions = {
  cost: KeyCost;
  /** The local store's clock; Unkey keeps its own. */
  now?: Date;
  /** The local store's quota for a key without its own; Unkey's is the key's credits. */
  dailyQuota?: number;
};

/** A live key as verification finds it. Quota figures are left out when the store doesn't know them. */
export type VerifiedKey = {
  id: string;
  owner: string;
  remaining?: number;
  limit?: number;
  /** When the quota is next refilled: the next UTC midnight. */
  resetsAt?: string;
};

/**
 * A key's verification, in words every store can give: never a store's own
 * codes. `unavailable` is the store not answering (an error, a timeout).
 */
export type Verification =
  | { ok: true; key: VerifiedKey }
  | {
      ok: false;
      reason: "unknown" | "revoked" | "quota" | "unavailable";
      /** With `quota`, when the store knows them. */
      limit?: number;
      used?: number;
      resetsAt?: string;
    };

/** An owner's live key as their key page shows it: never its secret. */
export type LiveKey = {
  id: string;
  /** The secret's first characters, as far as the store keeps them. */
  start: string;
  createdAt: string;
  remaining?: number;
  limit?: number;
  resetsAt?: string;
};

/**
 * The key seam `/api/lookup`, `/mcp` and the key page run on, met by the
 * SQLite store (`createKeys`) and by Unkey (`createUnkeyKeys`), chosen at
 * start by `createKeyStore`.
 */
export type KeyStore = {
  verify(secret: string, options: VerifyOptions): Promise<Verification>;
  /** Issues a key to `ownerId`; its secret is returned here only. */
  create(
    ownerId: string,
    quota?: number,
  ): Promise<{ id: string; secret: string }>;
  /** The owner's live key, the newest when there are several. */
  liveKeyOf(ownerId: string): Promise<LiveKey | undefined>;
  /**
   * A new secret for a live key, keeping its quota and the day's usage;
   * undefined when there is no such live key. The id may change (Unkey's
   * reroll issues a new key), so use the one returned.
   */
  roll(id: string): Promise<{ id: string; secret: string } | undefined>;
  /** False when there is no such live key. */
  revoke(id: string): Promise<boolean>;
};

/** The next UTC midnight after `now`, when a day's quota is refilled, as an ISO string. */
export function nextUtcMidnight(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

const keyColumns = {
  id: apiKeys.id,
  owner: apiKeys.owner,
  dailyQuota: apiKeys.dailyQuota,
  createdAt: apiKeys.createdAt,
  revokedAt: apiKeys.revokedAt,
};

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A new secret: `sb_` + 32 random bytes, base64url. */
function newSecret(): string {
  return `sb_${randomBytes(32).toString("base64url")}`;
}

/** `key_` + 8 base32 characters from 40 random bits. */
function newKeyId(): string {
  let n = randomBytes(5).readUIntBE(0, 5);
  let id = "";
  for (let i = 0; i < 8; i++) {
    id = BASE32[n % 32] + id;
    n = Math.floor(n / 32);
  }
  return `key_${id}`;
}

/** Lowercase hex sha256 of a key's secret: what is stored in its place. */
export function keyHashOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** The UTC day of `date`, `YYYY-MM-DD`: the day a quota is counted in. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** `DAILY_QUOTA` when it is a positive integer, else `DEFAULT_DAILY_QUOTA`. */
export function defaultDailyQuota(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = console.warn,
): number {
  const raw = env.DAILY_QUOTA?.trim();
  if (!raw) return DEFAULT_DAILY_QUOTA;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(value) && value > 0) return value;
  warn(
    `DAILY_QUOTA "${raw}" is not a positive integer; using ${DEFAULT_DAILY_QUOTA}.`,
  );
  return DEFAULT_DAILY_QUOTA;
}

/** A key's daily quota: its own when it has one, else the default. */
export function dailyQuotaOf(
  key: Pick<ApiKey, "dailyQuota">,
  env: Record<string, string | undefined> = process.env,
  warn?: (message: string) => void,
): number {
  return key.dailyQuota ?? defaultDailyQuota(env, warn);
}

function assertQuota(quota: number): void {
  if (!Number.isSafeInteger(quota) || quota < 1)
    throw new Error(`A daily quota must be a positive integer (got ${quota}).`);
}

/**
 * The API keys and their daily usage, in the Index database: the local key
 * store, used without Unkey (D9). Besides the key seam (`KeyStore`) it has
 * the synchronous calls `scripts/keys.ts` and the tests use.
 */
export function createKeys(
  db: Db,
  env: Record<string, string | undefined> = process.env,
) {
  /** Today's (or `day`'s) count for a key; 0 when it has none. */
  function usedOn(keyId: string, day: string): number {
    return (
      db
        .select({ count: apiKeyUsage.count })
        .from(apiKeyUsage)
        .where(and(eq(apiKeyUsage.keyId, keyId), eq(apiKeyUsage.day, day)))
        .get()?.count ?? 0
    );
  }

  const store = {
    /**
     * Issues a key to `owner`. Only the secret's hash is stored: the secret
     * returned here can't be shown again.
     */
    createKey(
      owner: string,
      dailyQuota?: number,
    ): { id: string; secret: string } {
      const name = owner.trim();
      if (!name) throw new Error("A key needs an owner.");
      if (dailyQuota !== undefined) assertQuota(dailyQuota);
      const id = newKeyId();
      const secret = newSecret();
      db.insert(apiKeys)
        .values({
          id,
          owner: name,
          keyHash: keyHashOf(secret),
          dailyQuota: dailyQuota ?? null,
        })
        .run();
      return { id, secret };
    },

    /** The live key whose secret this is; undefined when unknown or revoked. */
    findKey(secret: string): ApiKey | undefined {
      return db
        .select(keyColumns)
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.keyHash, keyHashOf(secret)),
            isNull(apiKeys.revokedAt),
          ),
        )
        .get();
    },

    /** Revokes a key. False when there is no such key or it was already revoked. */
    revokeKey(id: string): boolean {
      const result = db
        .update(apiKeys)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .run();
      return result.changes > 0;
    },

    /** Every key, in the order issued, with its usage on `day` (default today, UTC). */
    listKeys(day: string = utcDay()): (ApiKey & { used: number })[] {
      return db
        .select(keyColumns)
        .from(apiKeys)
        .orderBy(sql`rowid`)
        .all()
        .map((key) => ({ ...key, used: usedOn(key.id, day) }));
    },

    /** The live keys with their hashes and quotas, for `scripts/keys.ts migrate` (D8). */
    liveKeysToMigrate(): {
      id: string;
      owner: string;
      keyHash: string;
      quota: number;
    }[] {
      return db
        .select({ ...keyColumns, keyHash: apiKeys.keyHash })
        .from(apiKeys)
        .where(isNull(apiKeys.revokedAt))
        .orderBy(sql`rowid`)
        .all()
        .map((key) => ({
          id: key.id,
          owner: key.owner,
          keyHash: key.keyHash,
          quota: dailyQuotaOf(key, env),
        }));
    },

    /**
     * Counts one use of a key on `day` only if it has used fewer than `limit`
     * that day. The check and the increment are one upsert, so two concurrent
     * uses can't both take the last one.
     */
    takeQuota(keyId: string, day: string, limit: number): QuotaUse {
      const counted =
        limit > 0
          ? db
              .insert(apiKeyUsage)
              .values({ keyId, day, count: 1 })
              .onConflictDoUpdate({
                target: [apiKeyUsage.keyId, apiKeyUsage.day],
                set: { count: sql`${apiKeyUsage.count} + 1` },
                setWhere: lt(apiKeyUsage.count, limit),
              })
              .returning({ count: apiKeyUsage.count })
              .get()
          : undefined;
      if (counted) return { allowed: true, used: counted.count, limit };
      return { allowed: false, used: usedOn(keyId, day), limit };
    },

    /**
     * Cost 0 is `findKey`; cost 1 also takes one from the key's quota for
     * `now`'s UTC day (`takeQuota`).
     */
    async verify(
      secret: string,
      { cost, now = new Date(), dailyQuota }: VerifyOptions,
    ): Promise<Verification> {
      const found = db
        .select(keyColumns)
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHashOf(secret)))
        .get();
      if (!found) return { ok: false, reason: "unknown" };
      if (found.revokedAt) return { ok: false, reason: "revoked" };
      const key = { id: found.id, owner: found.owner };
      if (cost === 0) return { ok: true, key };
      const quota = store.takeQuota(
        found.id,
        utcDay(now),
        found.dailyQuota ?? dailyQuota ?? defaultDailyQuota(env),
      );
      const resetsAt = nextUtcMidnight(now);
      if (!quota.allowed)
        return {
          ok: false,
          reason: "quota",
          limit: quota.limit,
          used: quota.used,
          resetsAt,
        };
      return {
        ok: true,
        key: {
          ...key,
          remaining: Math.max(0, quota.limit - quota.used),
          limit: quota.limit,
          resetsAt,
        },
      };
    },

    async create(
      ownerId: string,
      quota?: number,
    ): Promise<{ id: string; secret: string }> {
      return store.createKey(ownerId, quota);
    },

    /** The start is only `sb_`: the local store keeps no part of a secret. */
    async liveKeyOf(ownerId: string): Promise<LiveKey | undefined> {
      const key = db
        .select(keyColumns)
        .from(apiKeys)
        .where(
          and(eq(apiKeys.owner, ownerId.trim()), isNull(apiKeys.revokedAt)),
        )
        .orderBy(sql`rowid desc`)
        .get();
      if (!key) return undefined;
      const now = new Date();
      const limit = dailyQuotaOf(key, env);
      return {
        id: key.id,
        start: "sb_",
        createdAt: key.createdAt,
        remaining: Math.max(0, limit - usedOn(key.id, utcDay(now))),
        limit,
        resetsAt: nextUtcMidnight(now),
      };
    },

    async roll(
      id: string,
    ): Promise<{ id: string; secret: string } | undefined> {
      const secret = newSecret();
      const result = db
        .update(apiKeys)
        .set({ keyHash: keyHashOf(secret) })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .run();
      return result.changes > 0 ? { id, secret } : undefined;
    },

    async revoke(id: string): Promise<boolean> {
      return store.revokeKey(id);
    },
  };
  return store satisfies KeyStore;
}

export type Keys = ReturnType<typeof createKeys>;
