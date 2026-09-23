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

const keyColumns = {
  id: apiKeys.id,
  owner: apiKeys.owner,
  dailyQuota: apiKeys.dailyQuota,
  createdAt: apiKeys.createdAt,
  revokedAt: apiKeys.revokedAt,
};

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

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

/** The API keys and their daily usage, in the Index database. */
export function createKeys(db: Db) {
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

  return {
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
      const secret = `sb_${randomBytes(32).toString("base64url")}`;
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
  };
}

export type Keys = ReturnType<typeof createKeys>;
