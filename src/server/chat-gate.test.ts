import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChatStore, createChatStore } from "~/index-store/chat";
import { type Db, openDb } from "~/index-store/db";
import { createChatGate, meterRefusalOf } from "./chat-gate";
import { createPerPersonQueue } from "./per-person-queue";

const NOW = new Date("2026-10-18T19:00:00.000Z");

/** A promise and the function that settles it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createChatGate", () => {
  let dir: string;
  let db: Db;
  let store: ChatStore;
  let clock: Date;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-chat-gate-"));
    db = openDb(join(dir, "test.db"));
    store = createChatStore(db);
    clock = NOW;
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const gateOf = (limit: number) =>
    createChatGate({ store, limit, now: () => clock });

  it("counts a turn it lets through and hands the turn the meter", async () => {
    const gate = gateOf(30);
    expect(gate.meter("user_ada")).toEqual({
      used: 0,
      limit: 30,
      resetsAt: "2026-10-19T00:00:00.000Z",
    });
    const answer = await gate.run("user_ada", async (meter) => meter);
    expect(answer).toEqual({ allowed: true, used: 1, limit: 30 });
    expect(gate.meter("user_ada").used).toBe(1);
  });

  it("refuses past the day's limit in words, with the reset", async () => {
    const gate = gateOf(2);
    await gate.run("user_ada", async () => "one");
    await gate.run("user_ada", async () => "two");
    let ran = false;
    const refused = await gate.run("user_ada", async () => {
      ran = true;
    });
    expect(ran).toBe(false);
    expect(refused).toEqual({
      ok: false,
      status: 429,
      error:
        "You've asked 2 questions today; the count resets at 00:00 UTC, in 5 h.",
      retryAfterSeconds: 5 * 3600,
    });
    expect(gate.meter("user_ada").used).toBe(2);
    // The next UTC day starts afresh.
    clock = new Date("2026-10-19T00:00:01.000Z");
    expect(await gate.run("user_ada", async () => "three")).toBe("three");
  });

  it("refuses a second turn while one is in flight, without counting it", async () => {
    const gate = gateOf(30);
    const first = deferred<string>();
    const running = gate.run("user_ada", () => first.promise);
    expect(await gate.run("user_ada", async () => "second")).toEqual({
      ok: false,
      status: 409,
      error:
        "Your last question is still being answered. Ask again when it ends.",
    });
    // Someone else isn't held up.
    expect(await gate.run("user_bob", async () => "bob")).toBe("bob");
    expect(gate.meter("user_ada").used).toBe(1);
    first.resolve("first");
    expect(await running).toBe("first");
    expect(await gate.run("user_ada", async () => "third")).toBe("third");
  });

  it("frees the person for the next turn when one fails", async () => {
    const gate = gateOf(30);
    await expect(
      gate.run("user_ada", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await gate.run("user_ada", async () => "next")).toBe("next");
  });
});

describe("meterRefusalOf", () => {
  it("says the wait in hours, or minutes in the last hour", () => {
    expect(meterRefusalOf(30, new Date("2026-10-18T00:00:00.000Z"))).toEqual({
      ok: false,
      status: 429,
      error:
        "You've asked 30 questions today; the count resets at 00:00 UTC, in 24 h.",
      retryAfterSeconds: 86_400,
    });
    expect(meterRefusalOf(1, new Date("2026-10-18T23:20:00.000Z")).error).toBe(
      "You've asked 1 question today; the count resets at 00:00 UTC, in 40 min.",
    );
  });
});

describe("createPerPersonQueue", () => {
  it("runs one person's actions in order and is busy until they settle", async () => {
    const queue = createPerPersonQueue();
    const order: string[] = [];
    const first = deferred<void>();
    const a = queue.run("ada", async () => {
      await first.promise;
      order.push("a");
    });
    const b = queue.run("ada", async () => {
      order.push("b");
    });
    expect(queue.busy("ada")).toBe(true);
    expect(queue.busy("bob")).toBe(false);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
    expect(queue.busy("ada")).toBe(false);
  });
});
