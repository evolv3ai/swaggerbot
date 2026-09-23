import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "~/index-store/db";
import { verifications } from "~/index-store/schema";
import type { Lookup } from "./lookup";
import { createVerifier, MAX_VERIFICATION_ATTEMPTS } from "./verify";

const NOW = "2026-09-22T10:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "swaggerbot-verify-"));
  db = openDb(join(dir, "index.db"));
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A verifier over `lookup` whose clock `at` moves, from `NOW`. */
function setup(lookup: Lookup = vi.fn(async () => unknown("payco"))) {
  let clock = new Date(NOW);
  const verifier = createVerifier({
    db,
    lookup,
    now: () => clock,
    freshnessDays: 7,
  });
  return {
    verifier,
    lookup,
    at: (ms: number) => {
      clock = new Date(Date.parse(NOW) + ms);
      return clock.toISOString();
    },
  };
}

const unknown = (name: string) => ({ outcome: "Unknown" as const, name });
const rows = () => db.select().from(verifications).all();

describe("createVerifier", () => {
  it("runs a queued name's Lookup with skipIndex and marks it finished", async () => {
    const { verifier, lookup, at } = setup();
    expect(verifier.enqueue("PayCo API ")).toBe(true);
    const finished = at(60_000);

    expect(await verifier.runOnce()).toBe(true);

    expect(lookup).toHaveBeenCalledExactlyOnceWith(
      { name: "payco" },
      { skipIndex: true },
    );
    expect(rows()).toEqual([
      {
        nameNormalized: "payco",
        requestedAt: NOW,
        startedAt: finished,
        finishedAt: finished,
        attempts: 0,
        lastError: null,
      },
    ]);
  });

  it("answers false with nothing queued", async () => {
    const { verifier, lookup } = setup();

    expect(await verifier.runOnce()).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("runs the oldest queued name first", async () => {
    const { verifier, lookup, at } = setup();
    verifier.enqueue("payco");
    at(1);
    verifier.enqueue("shipco");

    await verifier.runOnce();

    expect(lookup).toHaveBeenCalledExactlyOnceWith(
      { name: "payco" },
      { skipIndex: true },
    );
  });

  it(`retries a throwing Lookup up to ${MAX_VERIFICATION_ATTEMPTS} attempts`, async () => {
    const lookup = vi.fn(async () => {
      throw new Error("index locked");
    });
    const { verifier, at } = setup(lookup);
    verifier.enqueue("payco");

    await verifier.runOnce();
    expect(rows()).toMatchObject([
      {
        startedAt: null,
        finishedAt: null,
        attempts: 1,
        lastError: "index locked",
      },
    ]);
    await verifier.runOnce();
    const gaveUp = at(60_000);
    await verifier.runOnce();

    expect(lookup).toHaveBeenCalledTimes(MAX_VERIFICATION_ATTEMPTS);
    expect(rows()).toMatchObject([
      { finishedAt: gaveUp, attempts: 3, lastError: "index locked" },
    ]);
    expect(await verifier.runOnce()).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(MAX_VERIFICATION_ATTEMPTS);
  });

  it("makes a duplicate enqueue a no-op", async () => {
    const { verifier, lookup, at } = setup();
    verifier.enqueue("payco");
    at(60_000);

    expect(verifier.enqueue("PayCo")).toBe(false);
    expect(rows()).toMatchObject([{ requestedAt: NOW }]);
    await verifier.runOnce();
    expect(await verifier.runOnce()).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("queues a name again only once its last Verification is older than the window", async () => {
    const { verifier, at } = setup();
    verifier.enqueue("payco");
    await verifier.runOnce();

    at(7 * DAY - 1);
    expect(verifier.enqueue("payco")).toBe(false);
    const later = at(7 * DAY + 1);
    expect(verifier.enqueue("payco")).toBe(true);

    expect(rows()).toEqual([
      {
        nameNormalized: "payco",
        requestedAt: later,
        startedAt: null,
        finishedAt: null,
        attempts: 0,
        lastError: null,
      },
    ]);
  });

  it("requeues on start a Verification a previous process left running", async () => {
    db.insert(verifications)
      .values({ nameNormalized: "payco", requestedAt: NOW, startedAt: NOW })
      .run();
    let done: () => void = () => {};
    const ran = new Promise<void>((resolve) => {
      done = resolve;
    });
    const lookup = vi.fn(async () => {
      done();
      return unknown("payco");
    });
    const { verifier } = setup(lookup);

    expect(await verifier.runOnce()).toBe(false);
    verifier.start();
    await ran;
    verifier.stop();

    expect(lookup).toHaveBeenCalledExactlyOnceWith(
      { name: "payco" },
      { skipIndex: true },
    );
  });

  it("polls an empty queue until stopped", async () => {
    vi.useFakeTimers();
    try {
      const { verifier, lookup } = setup();
      verifier.start();
      await vi.advanceTimersByTimeAsync(0);
      verifier.enqueue("payco");
      await vi.advanceTimersByTimeAsync(4_999);
      expect(lookup).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(lookup).toHaveBeenCalledTimes(1);

      verifier.stop();
      verifier.enqueue("shipco");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
