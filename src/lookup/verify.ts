import { and, asc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Db } from "~/index-store/db";
import { normalizeName } from "~/index-store/repo";
import { verifications } from "~/index-store/schema";
import type { Lookup } from "./lookup";
import { DEFAULT_FRESHNESS_DAYS, freshnessMs } from "./thresholds";

/** A Verification that throws this many times is given up until it is queued again. */
export const MAX_VERIFICATION_ATTEMPTS = 3;

/** How long `start()` waits between polls of an empty queue. */
export const VERIFICATION_POLL_MS = 5_000;

/**
 * Queues a Verification of `name`, unless it already has one waiting or
 * running, or its last one finished within the freshness window. `true`
 * when it was queued.
 */
export function enqueueVerification(
  db: Db,
  name: string,
  at: Date,
  freshnessDays: number = DEFAULT_FRESHNESS_DAYS,
): boolean {
  const requestedAt = at.toISOString();
  const cutoff = new Date(at.getTime() - freshnessMs(freshnessDays));
  const { changes } = db
    .insert(verifications)
    .values({ nameNormalized: normalizeName(name), requestedAt })
    .onConflictDoUpdate({
      target: verifications.nameNormalized,
      set: {
        requestedAt,
        startedAt: null,
        finishedAt: null,
        attempts: 0,
        lastError: null,
      },
      // ISO timestamps in UTC order as text.
      where: and(
        isNotNull(verifications.finishedAt),
        lt(verifications.finishedAt, cutoff.toISOString()),
      ),
    })
    .run();
  return changes > 0;
}

export type Verifier = {
  /** Queues a Verification of `name` (see `enqueueVerification`). */
  enqueue(name: string): boolean;
  /**
   * Runs the oldest waiting Verification: a Lookup of its name that skips
   * the Index. `false` when the queue was empty.
   */
  runOnce(): Promise<boolean>;
  /**
   * Requeues Verifications a previous process left running, then runs the
   * queue one at a time, polling every `VERIFICATION_POLL_MS` while it is
   * empty. Its timer never keeps the process alive.
   */
  start(): void;
  stop(): void;
};

/**
 * The background Verification worker (ADR 0002): runs in-process over the
 * `verifications` table. A Verification is a Discovery of the name, so it
 * re-fetches the Sources and moves their `lastVerifiedAt`. A Lookup that
 * throws is requeued, until `MAX_VERIFICATION_ATTEMPTS`.
 */
export function createVerifier({
  db,
  lookup,
  now = () => new Date(),
  freshnessDays = DEFAULT_FRESHNESS_DAYS,
}: {
  db: Db;
  lookup: Lookup;
  now?: () => Date;
  freshnessDays?: number;
}): Verifier {
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  function claim(): string | undefined {
    const next = db
      .select({ name: verifications.nameNormalized })
      .from(verifications)
      .where(
        and(isNull(verifications.startedAt), isNull(verifications.finishedAt)),
      )
      .orderBy(asc(verifications.requestedAt))
      .get();
    if (!next) return undefined;
    db.update(verifications)
      .set({ startedAt: now().toISOString() })
      .where(eq(verifications.nameNormalized, next.name))
      .run();
    return next.name;
  }

  async function runOnce(): Promise<boolean> {
    const name = claim();
    if (name === undefined) return false;
    const row = eq(verifications.nameNormalized, name);
    try {
      await lookup({ name }, { skipIndex: true });
      db.update(verifications)
        .set({ finishedAt: now().toISOString(), lastError: null })
        .where(row)
        .run();
    } catch (error) {
      const attempts =
        (db
          .select({ attempts: verifications.attempts })
          .from(verifications)
          .where(row)
          .get()?.attempts ?? 0) + 1;
      const lastError = error instanceof Error ? error.message : String(error);
      db.update(verifications)
        .set(
          attempts < MAX_VERIFICATION_ATTEMPTS
            ? { attempts, lastError, startedAt: null }
            : { attempts, lastError, finishedAt: now().toISOString() },
        )
        .where(row)
        .run();
    }
    return true;
  }

  function schedule(ms: number) {
    timer = setTimeout(tick, ms);
    timer.unref();
  }

  async function tick() {
    timer = undefined;
    let ran = false;
    try {
      ran = await runOnce();
    } catch {
      // The Index itself failed; try again after the poll interval.
    }
    if (running && !timer) schedule(ran ? 0 : VERIFICATION_POLL_MS);
  }

  return {
    enqueue: (name) => enqueueVerification(db, name, now(), freshnessDays),
    runOnce,
    start() {
      if (running) return;
      running = true;
      // Started but never finished: the process died mid-run.
      db.update(verifications)
        .set({ startedAt: null })
        .where(
          and(
            isNotNull(verifications.startedAt),
            isNull(verifications.finishedAt),
          ),
        )
        .run();
      schedule(0);
    },
    stop() {
      running = false;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
