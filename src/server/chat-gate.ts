import type { ChatStore } from "~/index-store/chat";
import { nextUtcMidnight, type QuotaUse, utcDay } from "~/index-store/keys";
import { createPerPersonQueue } from "./per-person-queue";

/**
 * Ask this Spec's last two checks before the model is called (Slice 9, D4
 * and D6): the person's daily meter (429 with the reset), then one turn in
 * flight per person (409). The checks before them (the per-IP gate, the
 * origin check, sign-in, the feature, the Spec's forms) are the route's.
 */

/** A refusal, in words the panel shows as they are. */
export type ChatRefusal = {
  ok: false;
  status: 409 | 429;
  error: string;
  retryAfterSeconds?: number;
};

/** A person's questions today, as `/keys` shows them: "Questions today: 3 of 30". */
export type ChatMeter = { used: number; limit: number; resetsAt: string };

/** How long until `resetsAt`, as the panel says it: "5 h", "40 min". */
function untilOf(seconds: number): string {
  return seconds < 3600
    ? `${Math.max(1, Math.ceil(seconds / 60))} min`
    : `${Math.round(seconds / 3600)} h`;
}

function secondsUntil(resetsAt: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(resetsAt) - now.getTime()) / 1000));
}

/**
 * The meter's refusal: "You've asked 30 questions today; the count resets
 * at 00:00 UTC, in 5 h."
 */
export function meterRefusalOf(limit: number, now: Date): ChatRefusal {
  const retryAfterSeconds = secondsUntil(nextUtcMidnight(now), now);
  return {
    ok: false,
    status: 429,
    error: `You've asked ${limit} question${limit === 1 ? "" : "s"} today; the count resets at 00:00 UTC, in ${untilOf(retryAfterSeconds)}.`,
    retryAfterSeconds,
  };
}

const IN_FLIGHT: ChatRefusal = {
  ok: false,
  status: 409,
  error: "Your last question is still being answered. Ask again when it ends.",
};

export type ChatGateDeps = {
  store: Pick<ChatStore, "takeTurn" | "usedToday">;
  /** Turns a person may take a UTC day: `CHAT_DAILY_TURNS`. */
  limit: number;
  now?: () => Date;
};

export function createChatGate({
  store,
  limit,
  now = () => new Date(),
}: ChatGateDeps) {
  const queue = createPerPersonQueue();

  return {
    /** `userId`'s questions today. */
    meter(userId: string): ChatMeter {
      const at = now();
      return {
        used: store.usedToday(userId, utcDay(at)),
        limit,
        resetsAt: nextUtcMidnight(at),
      };
    },

    /**
     * Runs `turn` for `userId` unless their meter is spent (429) or they
     * already have a turn in flight (409). A turn is counted once it is let
     * through, before the model is called; a refused one isn't. `turn`
     * should settle when the answer ends, so the next one can start.
     */
    run<T>(
      userId: string,
      turn: (meter: QuotaUse) => Promise<T>,
    ): Promise<T | ChatRefusal> {
      const at = now();
      const day = utcDay(at);
      if (store.usedToday(userId, day) >= limit)
        return Promise.resolve(meterRefusalOf(limit, at));
      if (queue.busy(userId)) return Promise.resolve(IN_FLIGHT);
      const taken = store.takeTurn(userId, day, limit);
      if (!taken.allowed) return Promise.resolve(meterRefusalOf(limit, at));
      return queue.run(userId, () => turn(taken));
    },
  };
}

export type ChatGate = ReturnType<typeof createChatGate>;
