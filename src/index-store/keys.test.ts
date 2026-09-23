import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, MIGRATIONS_FOLDER, openDb } from "./db";
import {
  createKeys,
  DEFAULT_DAILY_QUOTA,
  dailyQuotaOf,
  defaultDailyQuota,
  type Keys,
  keyHashOf,
  utcDay,
} from "./keys";
import { apiKeys } from "./schema";

describe("keys", () => {
  let dir: string;
  let db: Db;
  let keys: Keys;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-keys-"));
    db = openDb(join(dir, "test.db"));
    keys = createKeys(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds a created key by its secret, and stores only the secret's hash", () => {
    const { id, secret } = keys.createKey("Ada Lovelace");

    expect(id).toMatch(/^key_[a-z2-7]{8}$/);
    expect(secret).toMatch(/^sb_[A-Za-z0-9_-]{43}$/);
    expect(keys.findKey(secret)).toEqual({
      id,
      owner: "Ada Lovelace",
      dailyQuota: null,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      revokedAt: null,
    });
    expect(keys.findKey(`${secret}x`)).toBeUndefined();

    const rows = db.select().from(apiKeys).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyHash).toBe(keyHashOf(secret));
    expect(rows[0]?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    const raw = JSON.stringify(
      db.$client.prepare("SELECT * FROM api_keys").all(),
    );
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(secret.slice(3));
  });

  it("doesn't find a revoked key, and revokes it only once", () => {
    const { id, secret } = keys.createKey("ada");

    expect(keys.revokeKey(id)).toBe(true);
    expect(keys.findKey(secret)).toBeUndefined();
    expect(keys.revokeKey(id)).toBe(false);
    expect(keys.revokeKey("key_nosuchid")).toBe(false);
    expect(keys.listKeys()[0]?.revokedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("lists keys without hashes or secrets, with the day's usage", () => {
    const a = keys.createKey("ada", 5);
    const b = keys.createKey("bob");
    keys.takeQuota(a.id, "2026-09-22", 5);
    keys.takeQuota(a.id, "2026-09-22", 5);
    keys.takeQuota(a.id, "2026-09-21", 5);

    const list = keys.listKeys("2026-09-22");
    expect(list.map((k) => [k.id, k.owner, k.dailyQuota, k.used])).toEqual([
      [a.id, "ada", 5, 2],
      [b.id, "bob", null, 0],
    ]);
    const shown = JSON.stringify(list);
    expect(shown).not.toContain("keyHash");
    expect(shown).not.toContain(a.secret);
    expect(shown).not.toContain(keyHashOf(a.secret));
  });

  it("allows exactly `limit` uses a day, then refuses, and starts a new day at zero", () => {
    const { id } = keys.createKey("ada");

    const first = keys.takeQuota(id, "2026-09-22", 3);
    const second = keys.takeQuota(id, "2026-09-22", 3);
    const third = keys.takeQuota(id, "2026-09-22", 3);
    expect([first, second, third]).toEqual([
      { allowed: true, used: 1, limit: 3 },
      { allowed: true, used: 2, limit: 3 },
      { allowed: true, used: 3, limit: 3 },
    ]);
    expect(keys.takeQuota(id, "2026-09-22", 3)).toEqual({
      allowed: false,
      used: 3,
      limit: 3,
    });
    expect(keys.takeQuota(id, "2026-09-22", 3).allowed).toBe(false);
    expect(keys.listKeys("2026-09-22")[0]?.used).toBe(3);

    expect(keys.takeQuota(id, "2026-09-23", 3)).toEqual({
      allowed: true,
      used: 1,
      limit: 3,
    });
  });

  it("refuses every use under a limit of zero", () => {
    const { id } = keys.createKey("ada");
    expect(keys.takeQuota(id, "2026-09-22", 0)).toEqual({
      allowed: false,
      used: 0,
      limit: 0,
    });
  });

  it("gives a key's own quota over DAILY_QUOTA and the default", () => {
    const own = keys.createKey("ada", 7);
    const plain = keys.createKey("bob");
    const [a, b] = keys.listKeys();
    if (!a || !b) throw new Error("expected two keys");
    expect([a.id, b.id]).toEqual([own.id, plain.id]);

    expect(dailyQuotaOf(a, {})).toBe(7);
    expect(dailyQuotaOf(a, { DAILY_QUOTA: "250" })).toBe(7);
    expect(dailyQuotaOf(b, {})).toBe(DEFAULT_DAILY_QUOTA);
    expect(dailyQuotaOf(b, { DAILY_QUOTA: "250" })).toBe(250);
  });

  it("rejects a key with no owner or a quota that isn't a positive integer", () => {
    expect(() => keys.createKey("  ")).toThrow(/owner/);
    expect(() => keys.createKey("ada", 0)).toThrow(/positive integer/);
    expect(() => keys.createKey("ada", 1.5)).toThrow(/positive integer/);
  });
});

describe("defaultDailyQuota", () => {
  it("is 100, or DAILY_QUOTA when that is a positive integer", () => {
    expect(DEFAULT_DAILY_QUOTA).toBe(100);
    expect(defaultDailyQuota({})).toBe(100);
    expect(defaultDailyQuota({ DAILY_QUOTA: " 20 " })).toBe(20);
  });

  it.each(["0", "-5", "ten", "1.5"])(
    "warns and ignores DAILY_QUOTA=%j",
    (raw) => {
      const warn = vi.fn();
      expect(defaultDailyQuota({ DAILY_QUOTA: raw }, warn)).toBe(100);
      expect(warn).toHaveBeenCalledOnce();
    },
  );
});

describe("utcDay", () => {
  it("is the UTC date", () => {
    expect(utcDay(new Date("2026-09-22T23:30:00-05:00"))).toBe("2026-09-23");
  });
});

describe("migration 0004", () => {
  let dir: string;
  let db: Db | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-migrate-"));
  });

  afterEach(() => {
    db?.$client.close();
    db = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds the key tables to an Index from before it, keeping its data", () => {
    // The migrations up to 0003 only, as a database from before this one.
    const before = join(dir, "drizzle");
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= 3,
    );
    writeFileSync(journalPath, JSON.stringify(journal));
    const path = join(dir, "old.db");
    const sqlite = new Database(path);
    migrate(drizzle({ client: sqlite }), { migrationsFolder: before });
    sqlite
      .prepare("INSERT INTO vendors (id, name, domain) VALUES (?, ?, ?)")
      .run("stripe.com", "Stripe", "stripe.com");
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name = 'api_keys'")
        .get(),
    ).toBeUndefined();
    sqlite.close();

    db = openDb(path);
    const keys = createKeys(db);
    const { id, secret } = keys.createKey("ada");
    expect(keys.findKey(secret)?.id).toBe(id);
    expect(keys.takeQuota(id, "2026-09-22", 1).allowed).toBe(true);
    expect(
      db.$client.prepare("SELECT count(*) AS n FROM vendors").get(),
    ).toEqual({ n: 1 });
  });
});
