import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeUnkey } from "./__fixtures__/fake-unkey";
import { openDb } from "./db";
import { createKeyStore } from "./key-store";
import { keyHashOf } from "./keys";
import {
  createUnkeyKeys,
  EXTERNAL_ID,
  migrateLocalKeys,
  operatorExternalId,
  unkeyHashOf,
  VERIFY_TIMEOUT_MS,
} from "./unkey-keys";

const NOW = new Date("2026-09-27T21:00:00.000Z");
const MIDNIGHT = "2026-09-28T00:00:00.000Z";

function store(unkey = fakeUnkey()) {
  return {
    ...unkey,
    keys: createUnkeyKeys({
      client: unkey.client,
      apiId: "api_test",
      env: {},
      now: () => NOW,
    }),
    held: unkey.keys,
  };
}

const live = (credits = 5) => ({
  keyId: "key_1",
  secret: "sb_live",
  externalId: "user_1",
  credits,
  refill: 5,
  enabled: true,
  createdAt: Date.parse("2026-09-01T00:00:00.000Z"),
});

describe("createUnkeyKeys: verify", () => {
  it("spends nothing at cost 0 and one at cost 1", async () => {
    const { keys, held, verifyKey } = store(fakeUnkey([live()]));

    expect(await keys.verify("sb_live", { cost: 0 })).toEqual({
      ok: true,
      key: { id: "key_1", owner: "user_1", remaining: 5, resetsAt: MIDNIGHT },
    });
    expect(held[0]?.credits).toBe(5);

    expect(await keys.verify("sb_live", { cost: 1 })).toMatchObject({
      ok: true,
      key: { remaining: 4 },
    });
    expect(held[0]?.credits).toBe(4);
    expect(verifyKey.mock.calls.map(([request]) => request)).toEqual([
      { key: "sb_live", credits: { cost: 0 } },
      { key: "sb_live", credits: { cost: 1 } },
    ]);
  });

  it("is quota on USAGE_EXCEEDED, resetting at the next UTC midnight", async () => {
    const { keys, verifyKey } = store(fakeUnkey([live(0)]));
    // Unkey may refuse even a cost of 0 once credits are spent: the key is
    // still live, so a request the Index answers still passes.
    verifyKey.mockResolvedValueOnce({
      meta: { requestId: "r" },
      data: {
        valid: false,
        code: "USAGE_EXCEEDED",
        keyId: "key_1",
        credits: 0,
      },
    });
    expect(await keys.verify("sb_live", { cost: 0 })).toEqual({
      ok: true,
      key: { id: "key_1", owner: "", remaining: 0, resetsAt: MIDNIGHT },
    });

    expect(await keys.verify("sb_live", { cost: 1 })).toEqual({
      ok: false,
      reason: "quota",
      resetsAt: MIDNIGHT,
    });
  });

  it.each([
    ["NOT_FOUND", "unknown"],
    ["DISABLED", "unknown"],
    ["EXPIRED", "unknown"],
    ["USAGE_EXCEEDED", "quota"],
    ["RATE_LIMITED", "unavailable"],
    ["FORBIDDEN", "unavailable"],
    ["INSUFFICIENT_PERMISSIONS", "unavailable"],
    ["SOMETHING_NEW", "unavailable"],
  ])("maps %s to %s, never passing the code on", async (code, reason) => {
    const { keys, verifyKey } = store();
    verifyKey.mockResolvedValueOnce({
      meta: { requestId: "r" },
      data: { valid: false, code } as never,
    });

    const verified = await keys.verify("sb_x", { cost: 0 });

    expect(verified).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(verified)).not.toContain(code);
  });

  it("is unavailable when the client throws", async () => {
    const unkey = fakeUnkey([live()]);
    unkey.state.mode = "throw";

    expect(await store(unkey).keys.verify("sb_live", { cost: 1 })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("is unavailable after 2 s without an answer, and aborts the request", async () => {
    vi.useFakeTimers();
    try {
      const unkey = fakeUnkey([live()]);
      unkey.state.mode = "hang";
      const pending = store(unkey).keys.verify("sb_live", { cost: 1 });
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(VERIFY_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(await pending).toEqual({ ok: false, reason: "unavailable" });
      const [, options] = unkey.verifyKey.mock.calls[0] as unknown as [
        unknown,
        { timeoutMs: number; signal: AbortSignal },
      ];
      expect(options.timeoutMs).toBe(2_000);
      expect(options.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createUnkeyKeys: managing keys", () => {
  it("creates a key with prefix sb, the owner as externalId and daily credits", async () => {
    const { keys, fake } = store();

    const created = await keys.create("user_1", 100);

    expect(created).toEqual({ id: "key_fake1", secret: "sb_secret1" });
    expect(fake.keys.createKey).toHaveBeenCalledWith({
      apiId: "api_test",
      prefix: "sb",
      externalId: "user_1",
      credits: {
        remaining: 100,
        refill: { interval: "daily", amount: 100 },
      },
    });
  });

  it("gives credits of DAILY_QUOTA when no quota is given", async () => {
    const unkey = fakeUnkey();
    const keys = createUnkeyKeys({
      client: unkey.client,
      apiId: "api_test",
      env: { DAILY_QUOTA: "7" },
    });

    await keys.create("user_1");

    expect(unkey.fake.keys.createKey.mock.calls[0]?.[0].credits).toEqual({
      remaining: 7,
      refill: { interval: "daily", amount: 7 },
    });
  });

  it("finds an owner's live key, with its credits and reset", async () => {
    const { keys } = store(fakeUnkey([live(3)]));

    expect(await keys.liveKeyOf("user_1")).toEqual({
      id: "key_1",
      start: "sb_live",
      createdAt: "2026-09-01T00:00:00.000Z",
      remaining: 3,
      limit: 5,
      resetsAt: MIDNIGHT,
    });
    expect(await keys.liveKeyOf("user_2")).toBeUndefined();
  });

  it("rolls a key to a new key, with a new id, the old one no longer verifying", async () => {
    const { keys, fake } = store(fakeUnkey([live(3)]));

    const rolled = await keys.roll("key_1");

    expect(rolled).toEqual({ id: "key_rolled1", secret: "sb_rolled1" });
    expect(fake.keys.rerollKey).toHaveBeenCalledWith({
      keyId: "key_1",
      expiration: 0,
    });
    expect(await keys.verify("sb_live", { cost: 0 })).toMatchObject({
      reason: "unknown",
    });
    expect(await keys.verify("sb_rolled1", { cost: 0 })).toMatchObject({
      ok: true,
      key: { id: "key_rolled1", owner: "user_1", remaining: 3 },
    });
    expect(await keys.roll("key_nope")).toBeUndefined();
  });

  it("never gives a rolled-away key as the owner's live key", async () => {
    // On the real clock: the fake expires the old key at the roll's Date.now().
    const keys = createUnkeyKeys({
      client: fakeUnkey([live()]).client,
      apiId: "api_test",
      env: {},
    });

    const rolled = await keys.roll("key_1");
    expect((await keys.liveKeyOf("user_1"))?.id).toBe(rolled?.id);

    await keys.revoke(rolled?.id as string);
    expect(await keys.liveKeyOf("user_1")).toBeUndefined();
  });

  it("asks Unkey for a fresh list, not its cache", async () => {
    const { keys, fake } = store(fakeUnkey([live()]));

    await keys.liveKeyOf("user_1");

    expect(fake.apis.listKeys.mock.calls[0]?.[0]).toMatchObject({
      revalidateKeysCache: true,
    });
  });

  it("refuses a key from another keyspace when the keyspace is set", async () => {
    const unkey = fakeUnkey([
      live(),
      {
        ...live(),
        keyId: "key_other",
        secret: "sb_other",
        keyspaceId: "ks_notra",
      },
    ]);
    const keys = createUnkeyKeys({
      client: unkey.client,
      apiId: "api_test",
      keyspaceId: "ks_test",
      env: {},
    });

    expect(await keys.verify("sb_other", { cost: 1 })).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(unkey.verifyKey.mock.calls[0]?.[0]).toMatchObject({
      keyspaces: ["ks_test"],
    });
    expect(await keys.verify("sb_live", { cost: 0 })).toMatchObject({
      ok: true,
    });
  });

  it("refuses a secret without the sb_ prefix without asking Unkey", async () => {
    const { keys, verifyKey } = store(fakeUnkey([live()]));

    expect(await keys.verify("notra_live", { cost: 1 })).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(verifyKey).not.toHaveBeenCalled();
  });

  it("reports an outage by the error's name and status, never the key", async () => {
    const unkey = fakeUnkey([live()]);
    unkey.verifyKey.mockRejectedValueOnce(
      Object.assign(new Error("boom sb_live"), {
        name: "APIError",
        statusCode: 502,
      }),
    );
    const warn = vi.fn();
    const keys = createUnkeyKeys({
      client: unkey.client,
      apiId: "api_test",
      env: {},
      warn,
    });

    expect(await keys.verify("sb_live", { cost: 1 })).toMatchObject({
      reason: "unavailable",
    });
    expect(warn.mock.calls).toEqual([
      ["keys: Unkey unavailable (APIError 502)"],
    ]);
  });

  it("revokes by deleting the key", async () => {
    const { keys } = store(fakeUnkey([live()]));

    expect(await keys.revoke("key_1")).toBe(true);
    expect(await keys.verify("sb_live", { cost: 0 })).toMatchObject({
      reason: "unknown",
    });
    expect(await keys.revoke("key_1")).toBe(false);
  });
});

describe("unkeyHashOf", () => {
  it("re-encodes our sha256 hex as base64 of the same bytes", () => {
    // sha256("") in both encodings.
    expect(
      unkeyHashOf(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ),
    ).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    const secret = "sb_example";
    expect(unkeyHashOf(keyHashOf(secret))).toBe(
      createHash("sha256").update(secret).digest("base64"),
    );
  });

  it("refuses anything that isn't a sha256 hex hash", () => {
    expect(() => unkeyHashOf("abc")).toThrow(/sha256/);
  });
});

describe("migrateLocalKeys", () => {
  it("sends each key's hash, owner and quota, and says which moved", async () => {
    const unkey = fakeUnkey();
    const hash = keyHashOf("sb_old");

    const result = await migrateLocalKeys(
      unkey.client,
      { apiId: "api_test", migrationId: "mig_1" },
      [{ id: "key_abcdefgh", owner: "Ada", keyHash: hash, quota: 250 }],
    );

    expect(result).toEqual({ migrated: ["key_abcdefgh"], failed: [] });
    expect(unkey.fake.keys.migrateKeys).toHaveBeenCalledWith({
      apiId: "api_test",
      migrationId: "mig_1",
      keys: [
        {
          hash: unkeyHashOf(hash),
          name: "key_abcdefgh",
          externalId: "operator.Ada",
          enabled: true,
          credits: {
            remaining: 250,
            refill: { interval: "daily", amount: 250 },
          },
        },
      ],
    });
  });

  it("reports the keys Unkey couldn't take by their ids", async () => {
    const unkey = fakeUnkey();
    const hash = keyHashOf("sb_old");
    unkey.fake.keys.migrateKeys.mockResolvedValueOnce({
      meta: { requestId: "r" },
      data: { migrated: [], failed: [unkeyHashOf(hash)] },
    });

    expect(
      await migrateLocalKeys(
        unkey.client,
        { apiId: "api_test", migrationId: "mig_1" },
        [{ id: "key_abcdefgh", owner: "Ada", keyHash: hash, quota: 1 }],
      ),
    ).toEqual({ migrated: [], failed: ["key_abcdefgh"] });
  });
});

describe("createKeyStore", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function db() {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-keystore-"));
    return openDb(join(dir, "test.db"));
  }

  it.each([
    [{}, "keys: local"],
    [{ UNKEY_ROOT_KEY: "unkey_root" }, "keys: local"],
    [{ UNKEY_API_ID: "api_test" }, "keys: local"],
    [{ UNKEY_ROOT_KEY: " ", UNKEY_API_ID: "api_test" }, "keys: local"],
    [{ UNKEY_ROOT_KEY: "unkey_root", UNKEY_API_ID: "api_test" }, "keys: unkey"],
  ])("with %j logs %s once", async (env, line) => {
    const index = db();
    const log = vi.fn();
    const unkey = fakeUnkey();
    const unkeyClient = vi.fn(() => unkey.client);

    const keys = createKeyStore(index, env, { log, unkeyClient });
    await keys.verify("sb_nope", { cost: 0 });

    expect(log.mock.calls).toEqual([[line]]);
    expect(unkey.verifyKey).toHaveBeenCalledTimes(
      line === "keys: unkey" ? 1 : 0,
    );
    if (line === "keys: unkey")
      expect(unkeyClient).toHaveBeenCalledWith("unkey_root");
    index.$client.close();
  });
});

describe("operatorExternalId", () => {
  it("is operator.<owner>, in what Unkey accepts as an externalId", () => {
    expect(operatorExternalId("Ada")).toBe("operator.Ada");
    expect(operatorExternalId(" keycheck-test ")).toBe(
      "operator.keycheck-test",
    );
    expect(operatorExternalId("Ada Lovelace <ada@example.com>")).toBe(
      "operator.Ada-Lovelace-ada-example.com",
    );
    expect(operatorExternalId("::")).toBe("operator.unnamed");
    for (const owner of ["Ada", "a b", "x:y", "é"])
      expect(operatorExternalId(owner)).toMatch(EXTERNAL_ID);
  });

  it("lets the fake Unkey refuse an externalId the real one refuses", async () => {
    const { keys } = store();
    await expect(keys.create("operator:ada")).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
