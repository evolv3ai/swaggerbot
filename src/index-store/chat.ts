import { and, countDistinct, eq, gte, lt, sql, sum } from "drizzle-orm";
import type { Db } from "./db";
import type { QuotaUse } from "./keys";
import { chatTurns, chatUsage } from "./schema";

/** Ask this Spec turns a signed-in person may take a UTC day, unless `CHAT_DAILY_TURNS` says otherwise (D4). */
export const DEFAULT_CHAT_DAILY_TURNS = 30;

/** Days a turn's row is kept before the daily sweep deletes it (D8). */
export const CHAT_TURNS_KEPT_DAYS = 90;

/** One turn as it is logged; `at` defaults to now. */
export type ChatTurnRow = {
  at?: string;
  specId: string;
  apiId: string;
  userId: string;
  model: string;
  effort: string;
  /** Input tokens not read from the cache, cache writes included. */
  inputTokens: number;
  /** Input tokens read from the cache. */
  cachedTokens: number;
  outputTokens: number;
  latencyMs: number;
  operationsSent: number;
  schemasSent: number;
  bytesSent: number;
  citations: number;
  stopReason: string | null;
  refusalCategory?: string | null;
  /** The error's class (`err.name`), never its message. */
  error?: string | null;
  /** Kept only when the store logs text (`CHAT_LOG_TEXT=1`). */
  question?: string;
  answer?: string;
};

/** One model's share of the turns `stats` counted. */
export type ChatModelStats = {
  model: string;
  turns: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
};

export type ChatStats = {
  turns: number;
  /** Distinct signed-in people who asked. */
  people: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** Turns whose stop reason was `refusal`. */
  refusals: number;
  /** Turns that ended in an error. */
  errors: number;
  /** By model, most turns first. */
  byModel: ChatModelStats[];
};

/** `CHAT_DAILY_TURNS` when it is a positive integer, else `DEFAULT_CHAT_DAILY_TURNS`. */
export function chatDailyTurnsOf(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = console.warn,
): number {
  const raw = env.CHAT_DAILY_TURNS?.trim();
  if (!raw) return DEFAULT_CHAT_DAILY_TURNS;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(value) && value > 0) return value;
  warn(
    `CHAT_DAILY_TURNS "${raw}" is not a positive integer; using ${DEFAULT_CHAT_DAILY_TURNS}.`,
  );
  return DEFAULT_CHAT_DAILY_TURNS;
}

/** Whether turns are logged with their question and answer: `CHAT_LOG_TEXT=1` only. */
export function chatLogTextOf(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CHAT_LOG_TEXT?.trim() === "1";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ask this Spec's meter and turn log, in the Index database (Slice 9, D4
 * and D8): how many questions each person asked a UTC day, and one row per
 * turn with what it cost. A turn's question and answer are kept only when
 * `logText` is on (`CHAT_LOG_TEXT=1`).
 */
export function createChatStore(
  db: Db,
  {
    logText = false,
    now = () => new Date(),
  }: { logText?: boolean; now?: () => Date } = {},
) {
  /** `userId`'s count on `day`; 0 when they have none. */
  function usedToday(userId: string, day: string): number {
    return (
      db
        .select({ count: chatUsage.count })
        .from(chatUsage)
        .where(and(eq(chatUsage.userId, userId), eq(chatUsage.day, day)))
        .get()?.count ?? 0
    );
  }

  return {
    usedToday,

    /**
     * Counts one turn of `userId`'s on `day` only if they have taken fewer
     * than `limit` that day. The check and the increment are one upsert, as
     * `takeQuota`'s, so two concurrent turns can't both take the last one.
     */
    takeTurn(userId: string, day: string, limit: number): QuotaUse {
      const counted =
        limit > 0
          ? db
              .insert(chatUsage)
              .values({ userId, day, count: 1 })
              .onConflictDoUpdate({
                target: [chatUsage.userId, chatUsage.day],
                set: { count: sql`${chatUsage.count} + 1` },
                setWhere: lt(chatUsage.count, limit),
              })
              .returning({ count: chatUsage.count })
              .get()
          : undefined;
      if (counted) return { allowed: true, used: counted.count, limit };
      return { allowed: false, used: usedToday(userId, day), limit };
    },

    /** Logs one turn; its question and answer only when the store logs text. */
    logTurn(row: ChatTurnRow): void {
      const { question, answer, at, ...figures } = row;
      db.insert(chatTurns)
        .values({
          ...figures,
          at: at ?? now().toISOString(),
          refusalCategory: row.refusalCategory ?? null,
          error: row.error ?? null,
          question: logText ? (question ?? null) : null,
          answer: logText ? (answer ?? null) : null,
        })
        .run();
    },

    /**
     * Deletes the turns logged more than `days` days ago, and the meter's
     * rows for days before that; how many turns went.
     */
    deleteOlderThan(days: number): number {
      const cutoff = new Date(now().getTime() - days * DAY_MS);
      // ISO timestamps and `YYYY-MM-DD` days in UTC order as text.
      const { changes } = db
        .delete(chatTurns)
        .where(lt(chatTurns.at, cutoff.toISOString()))
        .run();
      db.delete(chatUsage)
        .where(lt(chatUsage.day, cutoff.toISOString().slice(0, 10)))
        .run();
      return changes;
    },

    /** The turns logged on or after `since` (`YYYY-MM-DD`, UTC), or all of them. */
    stats({ since }: { since?: string } = {}): ChatStats {
      const where = since ? gte(chatTurns.at, since) : undefined;
      const totals = db
        .select({
          turns: sql<number>`count(*)`,
          people: countDistinct(chatTurns.userId),
          refusals: sql<number>`count(*) filter (where ${chatTurns.stopReason} = 'refusal')`,
          errors: sql<number>`count(${chatTurns.error})`,
        })
        .from(chatTurns)
        .where(where)
        .get();
      const byModel = db
        .select({
          model: chatTurns.model,
          turns: sql<number>`count(*)`,
          inputTokens: sum(chatTurns.inputTokens).mapWith(Number),
          cachedTokens: sum(chatTurns.cachedTokens).mapWith(Number),
          outputTokens: sum(chatTurns.outputTokens).mapWith(Number),
        })
        .from(chatTurns)
        .where(where)
        .groupBy(chatTurns.model)
        .orderBy(sql`count(*) desc`, chatTurns.model)
        .all();
      const total = (key: "inputTokens" | "cachedTokens" | "outputTokens") =>
        byModel.reduce((n, m) => n + m[key], 0);
      return {
        turns: totals?.turns ?? 0,
        people: totals?.people ?? 0,
        inputTokens: total("inputTokens"),
        cachedTokens: total("cachedTokens"),
        outputTokens: total("outputTokens"),
        refusals: totals?.refusals ?? 0,
        errors: totals?.errors ?? 0,
        byModel,
      };
    },
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
