import { vi } from "vitest";
import type { UnkeyClient } from "../unkey-keys";

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
};

/**
 * A fake Unkey client, no network: keys in memory, credits spent by
 * `verifyKey`'s cost as Unkey spends them. `mode` makes `verifyKey` throw
 * (as the SDK does for a 5xx or a network error) or never answer.
 */
export function fakeUnkey(keys: FakeUnkeyKey[] = []) {
  const state = { mode: "ok" as "ok" | "throw" | "hang", next: 1 };

  const verifyKey = vi.fn(
    async ({ key, credits }: { key: string; credits?: { cost: number } }) => {
      if (state.mode === "throw") throw new Error("Unkey is down");
      if (state.mode === "hang") return new Promise<never>(() => {});
      const found = keys.find((k) => k.secret === key);
      const data = (() => {
        if (!found) return { valid: false, code: "NOT_FOUND" as const };
        if (!found.enabled) return { valid: false, code: "DISABLED" as const };
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
      rerollKey: vi.fn(async ({ keyId }) => {
        const found = keys.find((k) => k.keyId === keyId);
        if (!found)
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        found.secret = `sb_rolled${state.next++}`;
        return {
          meta: { requestId: "req_fake" },
          data: { keyId, key: found.secret },
        };
      }),
      deleteKey: vi.fn(async ({ keyId }) => {
        const i = keys.findIndex((k) => k.keyId === keyId);
        if (i < 0)
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        keys.splice(i, 1);
        return { meta: { requestId: "req_fake" }, data: {} };
      }),
      migrateKeys: vi.fn(async ({ keys: migrating }) => ({
        meta: { requestId: "req_fake" },
        data: {
          migrated: migrating.map((k: { hash: string }, i: number) => ({
            hash: k.hash,
            keyId: `key_migrated${i}`,
          })),
          failed: [] as string[],
        },
      })),
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
