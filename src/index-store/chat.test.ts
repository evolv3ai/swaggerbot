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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ChatTurnRow,
  chatDailyTurnsOf,
  chatLogTextOf,
  createChatStore,
  DEFAULT_CHAT_DAILY_TURNS,
} from "./chat";
import { type Db, MIGRATIONS_FOLDER, openDb } from "./db";
import { chatTurns, chatUsage } from "./schema";

const NOW = new Date("2026-10-18T21:00:00.000Z");

/** A turn's figures, overridden by `extra`. */
function turn(extra: Partial<ChatTurnRow> = {}): ChatTurnRow {
  return {
    specId: "a".repeat(64),
    apiId: "stripe.com:stripe",
    userId: "user_ada",
    model: "claude-opus-5-5",
    effort: "low",
    inputTokens: 1000,
    cachedTokens: 9000,
    outputTokens: 400,
    latencyMs: 2100,
    operationsSent: 3,
    schemasSent: 2,
    bytesSent: 21_000,
    citations: 4,
    stopReason: "end_turn",
    question: "How do I create a customer?",
    answer: "POST /v1/customers.",
    ...extra,
  };
}

describe("createChatStore", () => {
  let dir: string;
  let path: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-chat-"));
    path = join(dir, "test.db");
    db = openDb(path);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("takes exactly `limit` turns a day and refuses the next", () => {
    const chat = createChatStore(db);
    const day = "2026-10-18";
    expect(chat.usedToday("user_ada", day)).toBe(0);
    expect(chat.takeTurn("user_ada", day, 3)).toEqual({
      allowed: true,
      used: 1,
      limit: 3,
    });
    expect(chat.takeTurn("user_ada", day, 3).used).toBe(2);
    expect(chat.takeTurn("user_ada", day, 3).used).toBe(3);
    expect(chat.takeTurn("user_ada", day, 3)).toEqual({
      allowed: false,
      used: 3,
      limit: 3,
    });
    expect(chat.usedToday("user_ada", day)).toBe(3);
    // Someone else's meter is their own.
    expect(chat.takeTurn("user_bob", day, 3).allowed).toBe(true);
  });

  it("refuses every turn under a limit of zero", () => {
    expect(createChatStore(db).takeTurn("user_ada", "2026-10-18", 0)).toEqual({
      allowed: false,
      used: 0,
      limit: 0,
    });
  });

  it("lets only one of two connections take the last turn", () => {
    const other = openDb(path);
    try {
      const a = createChatStore(db);
      const b = createChatStore(other);
      const day = "2026-10-18";
      expect(a.takeTurn("user_ada", day, 2).allowed).toBe(true);
      const results = [
        a.takeTurn("user_ada", day, 2),
        b.takeTurn("user_ada", day, 2),
      ];
      expect(results.map((r) => r.allowed)).toEqual([true, false]);
      expect(b.usedToday("user_ada", day)).toBe(2);
    } finally {
      other.$client.close();
    }
  });

  it("starts each UTC day afresh", () => {
    const chat = createChatStore(db);
    expect(chat.takeTurn("user_ada", "2026-10-18", 1).allowed).toBe(true);
    expect(chat.takeTurn("user_ada", "2026-10-18", 1).allowed).toBe(false);
    expect(chat.takeTurn("user_ada", "2026-10-19", 1)).toEqual({
      allowed: true,
      used: 1,
      limit: 1,
    });
    expect(chat.usedToday("user_ada", "2026-10-18")).toBe(1);
  });

  it("logs a turn's figures without its question or answer by default", () => {
    createChatStore(db, { now: () => NOW }).logTurn(turn());
    const [row] = db.select().from(chatTurns).all();
    expect(row).toMatchObject({
      at: NOW.toISOString(),
      userId: "user_ada",
      model: "claude-opus-5-5",
      effort: "low",
      inputTokens: 1000,
      cachedTokens: 9000,
      outputTokens: 400,
      bytesSent: 21_000,
      stopReason: "end_turn",
      refusalCategory: null,
      error: null,
      question: null,
      answer: null,
    });
  });

  it("logs the question and answer under CHAT_LOG_TEXT", () => {
    createChatStore(db, { logText: true }).logTurn(turn());
    createChatStore(db, { logText: true }).logTurn(
      turn({ question: undefined, answer: undefined, error: "TimeoutError" }),
    );
    const rows = db.select().from(chatTurns).all();
    expect(rows.map((r) => [r.question, r.answer, r.error])).toEqual([
      ["How do I create a customer?", "POST /v1/customers.", null],
      [null, null, "TimeoutError"],
    ]);
  });

  it("deletes turns and meter days older than the cutoff", () => {
    const chat = createChatStore(db, { now: () => NOW });
    chat.logTurn(turn({ at: "2026-07-20T20:59:59.999Z" }));
    chat.logTurn(turn({ at: "2026-07-20T21:00:00.000Z" }));
    chat.logTurn(turn());
    chat.takeTurn("user_ada", "2026-07-19", 30);
    chat.takeTurn("user_ada", "2026-07-20", 30);
    chat.takeTurn("user_ada", "2026-10-18", 30);

    expect(chat.deleteOlderThan(90)).toBe(1);
    expect(
      db
        .select({ at: chatTurns.at })
        .from(chatTurns)
        .all()
        .map((r) => r.at),
    ).toEqual(["2026-07-20T21:00:00.000Z", NOW.toISOString()]);
    expect(
      db
        .select({ day: chatUsage.day })
        .from(chatUsage)
        .all()
        .map((r) => r.day),
    ).toEqual(["2026-07-20", "2026-10-18"]);
    expect(chat.deleteOlderThan(90)).toBe(0);
  });

  it("counts turns, people, tokens, refusals and errors, by model", () => {
    const chat = createChatStore(db);
    chat.logTurn(turn({ at: "2026-10-01T10:00:00.000Z" }));
    chat.logTurn(
      turn({
        at: "2026-10-02T10:00:00.000Z",
        userId: "user_bob",
        stopReason: "refusal",
        refusalCategory: "cyber",
        outputTokens: 0,
      }),
    );
    chat.logTurn(
      turn({
        at: "2026-10-03T10:00:00.000Z",
        model: "claude-haiku-5-5",
        stopReason: null,
        error: "APIConnectionError",
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
      }),
    );

    expect(chat.stats()).toEqual({
      turns: 3,
      people: 2,
      inputTokens: 2000,
      cachedTokens: 18_000,
      outputTokens: 400,
      refusals: 1,
      errors: 1,
      byModel: [
        {
          model: "claude-opus-5-5",
          turns: 2,
          inputTokens: 2000,
          cachedTokens: 18_000,
          outputTokens: 400,
        },
        {
          model: "claude-haiku-5-5",
          turns: 1,
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
        },
      ],
    });
    expect(chat.stats({ since: "2026-10-02" })).toMatchObject({
      turns: 2,
      people: 2,
      refusals: 1,
      errors: 1,
    });
    expect(chat.stats({ since: "2026-10-04" })).toEqual({
      turns: 0,
      people: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      refusals: 0,
      errors: 0,
      byModel: [],
    });
  });
});

describe("chat settings", () => {
  it("reads CHAT_DAILY_TURNS, falling back to the default", () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(chatDailyTurnsOf({}, warn)).toBe(DEFAULT_CHAT_DAILY_TURNS);
    expect(chatDailyTurnsOf({ CHAT_DAILY_TURNS: " 12 " }, warn)).toBe(12);
    expect(chatDailyTurnsOf({ CHAT_DAILY_TURNS: "0" }, warn)).toBe(30);
    expect(chatDailyTurnsOf({ CHAT_DAILY_TURNS: "lots" }, warn)).toBe(30);
    expect(warnings).toHaveLength(2);
  });

  it("logs text only for CHAT_LOG_TEXT=1", () => {
    expect(chatLogTextOf({})).toBe(false);
    expect(chatLogTextOf({ CHAT_LOG_TEXT: "1" })).toBe(true);
    expect(chatLogTextOf({ CHAT_LOG_TEXT: "true" })).toBe(false);
  });
});

describe("migration 0010", () => {
  let dir: string;
  let db: Db | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-migrate-chat-"));
  });

  afterEach(() => {
    db?.$client.close();
    db = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds the chat tables to an Index from before it, keeping its data", () => {
    // The migrations up to 0009 only, as a database from before this one.
    const before = join(dir, "drizzle");
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= 9,
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
        .prepare("SELECT name FROM sqlite_master WHERE name = 'chat_turns'")
        .get(),
    ).toBeUndefined();
    sqlite.close();

    db = openDb(path);
    const chat = createChatStore(db);
    expect(chat.takeTurn("user_ada", "2026-10-18", 30).allowed).toBe(true);
    chat.logTurn(turn());
    expect(chat.stats().turns).toBe(1);
    expect(
      db.$client.prepare("SELECT count(*) AS n FROM vendors").get(),
    ).toEqual({ n: 1 });
  });
});
