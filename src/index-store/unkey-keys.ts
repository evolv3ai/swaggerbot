import { Unkey } from "@unkey/api";
import {
  defaultDailyQuota,
  type KeyStore,
  type LiveKey,
  nextUtcMidnight,
  type Verification,
} from "./keys";

/** How long a verification may take before the key is `unavailable` (D3). */
export const VERIFY_TIMEOUT_MS = 2_000;

/** The prefix of every secret Unkey issues for swagger.bot: keys read `sb_…` (D1). */
export const KEY_PREFIX = "sb";

/** The keys API of an Unkey client: what the store calls, so a test can fake it. */
export type UnkeyClient = {
  keys: Pick<
    Unkey["keys"],
    | "verifyKey"
    | "createKey"
    | "rerollKey"
    | "deleteKey"
    | "migrateKeys"
    | "getKey"
  >;
  apis: Pick<Unkey["apis"], "listKeys">;
};

/** An Unkey client for `rootKey`, retrying nothing: a slow verification is `unavailable`, not retried. */
export function createUnkeyClient(rootKey: string): UnkeyClient {
  return new Unkey({ rootKey, retryConfig: { strategy: "none" } });
}

/** A key as the operator's `scripts/keys.ts list` shows it. */
export type UnkeyListedKey = LiveKey & { owner: string | undefined };

/**
 * The key seam against Unkey (ADR 0006), in the keyspace `apiId`. A key's
 * owner is its identity's `externalId`; its quota is credits refilled daily.
 * Revoking deletes the key (D6). Unkey's codes never leave this file: they
 * are mapped to a `Verification`.
 *
 * A root key allowed to verify in other keyspaces would accept their keys
 * too, so verification is limited to `keyspaceId` (the API's `ks_…` id,
 * not its `api_…` id) when it is given, and a secret without the `sb_`
 * prefix is refused without asking Unkey.
 */
export function createUnkeyKeys({
  client,
  apiId,
  keyspaceId,
  env = process.env,
  timeoutMs = VERIFY_TIMEOUT_MS,
  now = () => new Date(),
  warn = console.warn,
}: {
  client: UnkeyClient;
  apiId: string;
  keyspaceId?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  now?: () => Date;
  /** Where an outage is reported: the error's name and status, never the request. */
  warn?: (message: string) => void;
}) {
  /** Every key in the keyspace, or only `externalId`'s, following Unkey's pages. */
  async function listKeys(externalId?: string) {
    const all = [];
    let cursor: string | undefined;
    do {
      // Unkey serves the list from a cache unless asked: a key just created,
      // rolled or revoked must show as it is now.
      const page = await client.apis.listKeys({
        apiId,
        externalId,
        cursor,
        limit: 100,
        revalidateKeysCache: true,
      });
      all.push(...page.result.data);
      cursor = page.result.pagination?.hasMore
        ? page.result.pagination.cursor
        : undefined;
    } while (cursor);
    return all;
  }

  /** A key's figures as a key page shows them. */
  function liveKey(key: Awaited<ReturnType<typeof listKeys>>[number]): LiveKey {
    const credits = key.credits;
    return {
      id: key.keyId,
      start: key.start,
      createdAt: new Date(key.createdAt).toISOString(),
      remaining: credits?.remaining ?? undefined,
      limit: credits?.refill?.amount,
      resetsAt:
        credits?.refill?.interval === "daily"
          ? nextUtcMidnight(now())
          : undefined,
    };
  }

  return {
    async verify(secret, { cost }): Promise<Verification> {
      if (!secret.startsWith(`${KEY_PREFIX}_`))
        return { ok: false, reason: "unknown" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("timeout");
        }, timeoutMs);
      });
      try {
        const answer = await Promise.race([
          client.keys.verifyKey(
            {
              key: secret,
              credits: { cost },
              ...(keyspaceId ? { keyspaces: [keyspaceId] } : {}),
            },
            { timeoutMs, signal: controller.signal },
          ),
          timedOut,
        ]);
        if (answer === "timeout") {
          warn(`keys: Unkey didn't answer in ${timeoutMs} ms`);
          return { ok: false, reason: "unavailable" };
        }
        const { data } = answer;
        // A key whose credits are spent is still live: at cost 0 (a request
        // the Index answers) it passes, as it did before Unkey.
        const spentButLive = cost === 0 && data.code === "USAGE_EXCEEDED";
        if (
          data.keyId &&
          ((data.valid && data.code === "VALID") || spentButLive)
        )
          return {
            ok: true,
            key: {
              id: data.keyId,
              owner: data.identity?.externalId ?? "",
              remaining: data.credits ?? undefined,
              resetsAt:
                data.credits === undefined ? undefined : nextUtcMidnight(now()),
            },
          };
        switch (data.code) {
          case "NOT_FOUND":
          case "DISABLED":
          case "EXPIRED":
            return { ok: false, reason: "unknown" };
          case "USAGE_EXCEEDED":
            return {
              ok: false,
              reason: "quota",
              resetsAt: nextUtcMidnight(now()),
            };
          default:
            warn(`keys: Unkey answered ${data.code}`);
            return { ok: false, reason: "unavailable" };
        }
      } catch (err) {
        warn(`keys: Unkey unavailable (${describeError(err)})`);
        return { ok: false, reason: "unavailable" };
      } finally {
        clearTimeout(timer);
      }
    },

    /** Credits per D7: `quota` (default `DAILY_QUOTA`), refilled to it daily. */
    async create(ownerId: string, quota?: number) {
      const amount = quota ?? defaultDailyQuota(env);
      const { data } = await client.keys.createKey({
        apiId,
        prefix: KEY_PREFIX,
        externalId: ownerId,
        credits: {
          remaining: amount,
          refill: { interval: "daily", amount },
        },
      });
      return { id: data.keyId, secret: data.key };
    },

    async liveKeyOf(ownerId) {
      // A rolled-away key is expired, not disabled, until Unkey deletes it.
      const at = now().getTime();
      const keys = (await listKeys(ownerId)).filter(
        (k) => k.enabled && (k.expires === undefined || k.expires > at),
      );
      const newest = keys.sort((a, b) => b.createdAt - a.createdAt)[0];
      return newest ? liveKey(newest) : undefined;
    },

    /**
     * Unkey's reroll: a new key with a new id and secret, its credits and
     * identity copied; the old one expires at once (D6).
     */
    async roll(id) {
      try {
        const { data } = await client.keys.rerollKey({
          keyId: id,
          expiration: 0,
        });
        return { id: data.keyId, secret: data.key };
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },

    async revoke(id) {
      try {
        await client.keys.deleteKey({ keyId: id });
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },

    /** Every key in the keyspace, for `scripts/keys.ts list`. */
    async listKeys(): Promise<UnkeyListedKey[]> {
      return (await listKeys()).map((key) => ({
        ...liveKey(key),
        owner: key.identity?.externalId,
      }));
    },
  } satisfies KeyStore & { listKeys(): Promise<UnkeyListedKey[]> };
}

export type UnkeyKeys = ReturnType<typeof createUnkeyKeys>;

/** An SDK error as a log line: its name and HTTP status, nothing it carried. */
function describeError(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown error";
  const name =
    "name" in err && typeof err.name === "string" ? err.name : "Error";
  const status =
    "statusCode" in err && typeof err.statusCode === "number"
      ? ` ${err.statusCode}`
      : "";
  return `${name}${status}`;
}

/** Unkey's 404 for a key that doesn't exist (or was deleted). */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    err.statusCode === 404
  );
}

/** A key's sha256 as Unkey's `migrateKeys` takes it: base64 of the bytes our hex spells (D8). */
export function unkeyHashOf(hexHash: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hexHash))
    throw new Error(`Not a sha256 hex hash: ${hexHash}`);
  return Buffer.from(hexHash, "hex").toString("base64");
}

/** Keys sent to `migrateKeys` in one request. */
const MIGRATE_BATCH = 100;

/** A hand-issued key as `migrate` reads it from SQLite. */
export type LocalKeyToMigrate = {
  id: string;
  owner: string;
  keyHash: string;
  /** The key's own quota, or the default. */
  quota: number;
};

/**
 * Moves hand-issued keys into Unkey with their secrets unchanged (D8): each
 * key's hash re-encoded, its owner as `externalId: "operator:<owner>"`, its
 * quota as credits refilled daily. Returns the ids that moved and those that
 * didn't.
 */
export async function migrateLocalKeys(
  client: UnkeyClient,
  { apiId, migrationId }: { apiId: string; migrationId: string },
  keys: LocalKeyToMigrate[],
): Promise<{ migrated: string[]; failed: string[] }> {
  const byHash = new Map(keys.map((k) => [unkeyHashOf(k.keyHash), k.id]));
  const migrated: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < keys.length; i += MIGRATE_BATCH) {
    const { data } = await client.keys.migrateKeys({
      apiId,
      migrationId,
      keys: keys.slice(i, i + MIGRATE_BATCH).map((k) => ({
        hash: unkeyHashOf(k.keyHash),
        name: k.id,
        externalId: operatorExternalId(k.owner),
        enabled: true,
        credits: {
          remaining: k.quota,
          refill: { interval: "daily", amount: k.quota },
        },
      })),
    });
    migrated.push(...data.migrated.map((m) => byHash.get(m.hash) ?? m.hash));
    failed.push(...data.failed.map((hash) => byHash.get(hash) ?? hash));
  }
  return { migrated, failed };
}

/** The `externalId` of a key the operator issues by hand, as opposed to a WorkOS user's. */
export function operatorExternalId(owner: string): string {
  return `operator:${owner.trim()}`;
}
