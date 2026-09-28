import { vi } from "vitest";
import { EXTERNAL_ID, type UnkeyClient } from "../unkey-keys";

/** Unkey's 400 for a body it refuses, as the SDK throws it. */
function refuseExternalId(externalId: string | undefined) {
  if (externalId !== undefined && !EXTERNAL_ID.test(externalId))
    throw Object.assign(
      new Error(
        `'${externalId}' does not match pattern '${EXTERNAL_ID.source}'`,
      ),
      { statusCode: 400 },
    );
}

/** A key as the fake Unkey holds it. */
export type FakeUnkeyKey = {
  keyId: string;
  secret: string;
  externalId?: string;
  /** Credits left; undefined for unlimited. */
  credits?: number;
  refill?: number;
  enabled: boolean;
  createdAt: number;
  /** When the key stops verifying (ms); a rolled-away key's is its roll. */
  expires?: number;
  /** Its keyspace; `ks_test` when not given. */
  keyspaceId?: string;
};

/**
 * A fake Unkey client, no network: keys in memory, credits spent by
 * `verifyKey`'s cost as Unkey spends them. `mode` makes `verifyKey` throw
 * (as the SDK does for a 5xx or a network error) or never answer.
 */
export function fakeUnkey(keys: FakeUnkeyKey[] = []) {
  const state = { mode: "ok" as "ok" | "throw" | "hang", next: 1 };

  const verifyKey = vi.fn(
    async ({
      key,
      credits,
      keyspaces,
    }: {
      key: string;
      credits?: { cost: number };
      keyspaces?: string[];
    }) => {
      if (state.mode === "throw") throw new Error("Unkey is down");
      if (state.mode === "hang") return new Promise<never>(() => {});
      const found = keys.find((k) => k.secret === key);
      const data = (() => {
        if (
          !found ||
          (keyspaces && !keyspaces.includes(found.keyspaceId ?? "ks_test"))
        )
          return { valid: false, code: "NOT_FOUND" as const };
        if (!found.enabled) return { valid: false, code: "DISABLED" as const };
        if (found.expires !== undefined && found.expires <= Date.now())
          return {
            valid: false,
            code: "EXPIRED" as const,
            keyId: found.keyId,
          };
        const cost = credits?.cost ?? 1;
        if (found.credits !== undefined) {
          if (found.credits < cost)
            return {
              valid: false,
              code: "USAGE_EXCEEDED" as const,
              keyId: found.keyId,
              credits: found.credits,
            };
          found.credits -= cost;
        }
        return {
          valid: true,
          code: "VALID" as const,
          keyId: found.keyId,
          credits: found.credits,
          identity: found.externalId
            ? { id: `id_${found.externalId}`, externalId: found.externalId }
            : undefined,
        };
      })();
      return { meta: { requestId: "req_fake" }, data };
    },
  );

  const client = {
    keys: {
      verifyKey,
      createKey: vi.fn(async (request) => {
        refuseExternalId(request.externalId);
        const key: FakeUnkeyKey = {
          keyId: `key_fake${state.next}`,
          secret: `${request.prefix}_secret${state.next}`,
          externalId: request.externalId,
          credits: request.credits?.remaining ?? undefined,
          refill: request.credits?.refill?.amount,
          enabled: true,
          createdAt: 1_790_000_000_000 + state.next,
        };
        state.next += 1;
        keys.push(key);
        return {
          meta: { requestId: "req_fake" },
          data: { keyId: key.keyId, key: key.secret },
        };
      }),
      // As Unkey rerolls: a new key (new id and secret) with the old one's
      // credits and identity; the old one expires `expiration` ms from now.
      rerollKey: vi.fn(async ({ keyId, expiration }) => {
        const found = keys.find((k) => k.keyId === keyId);
        if (!found)
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        const rolled: FakeUnkeyKey = {
          ...found,
          keyId: `key_rolled${state.next}`,
          secret: `sb_rolled${state.next}`,
          createdAt: found.createdAt + state.next,
          expires: undefined,
        };
        state.next += 1;
        found.expires = Date.now() + expiration;
        keys.push(rolled);
        return {
          meta: { requestId: "req_fake" },
          data: { keyId: rolled.keyId, key: rolled.secret },
        };
      }),
      deleteKey: vi.fn(async ({ keyId }) => {
        const i = keys.findIndex((k) => k.keyId === keyId);
        if (i < 0)
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        keys.splice(i, 1);
        return { meta: { requestId: "req_fake" }, data: {} };
      }),
      migrateKeys: vi.fn(async ({ keys: migrating }) => {
        for (const k of migrating as { externalId?: string }[])
          refuseExternalId(k.externalId);
        return {
          meta: { requestId: "req_fake" },
          data: {
            migrated: migrating.map((k: { hash: string }, i: number) => ({
              hash: k.hash,
              keyId: `key_migrated${i}`,
            })),
            failed: [] as string[],
          },
        };
      }),
      getKey: vi.fn(),
    },
    apis: {
      listKeys: vi.fn(async ({ externalId }: { externalId?: string }) => ({
        result: {
          meta: { requestId: "req_fake" },
          data: keys
            .filter((k) => !externalId || k.externalId === externalId)
            .map((k) => ({
              keyId: k.keyId,
              start: k.secret.slice(0, 7),
              enabled: k.enabled,
              createdAt: k.createdAt,
              expires: k.expires,
              credits:
                k.credits === undefined
                  ? undefined
                  : {
                      remaining: k.credits,
                      refill:
                        k.refill === undefined
                          ? undefined
                          : { interval: "daily" as const, amount: k.refill },
                    },
              identity: k.externalId
                ? { id: `id_${k.externalId}`, externalId: k.externalId }
                : undefined,
            })),
          pagination: { hasMore: false },
        },
      })),
    },
  };
  return {
    client: client as unknown as UnkeyClient,
    keys,
    state,
    verifyKey,
    fake: client,
  };
}
