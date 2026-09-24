import { setImmediate } from "node:timers/promises";
import type { Fetcher } from "~/fetch/fetcher";
import type { Db } from "~/index-store/db";
import { createSpecForms, type FormsLane } from "~/index-store/spec-forms";
import { buildSpecForms } from "./build";

/** How long `start()` waits between polls while no Spec's forms are pending. */
export const FORMS_POLL_MS = 5_000;

/**
 * The time all the external references of one Spec may take to fetch,
 * together, from the first. Room for DigitalOcean's: its `$ref` closure is
 * 2,976 files on one host, which at the fetcher's one request per second
 * per host takes about 53 min.
 */
export const FORMS_REF_BUDGET_MS = 75 * 60_000;

export type FormsWorker = {
  /**
   * Builds the forms of `lane`'s next pending Spec, and stores them, the
   * failure, or its hand-over to the `"external"` lane. Without a lane, the
   * `"local"` lane's next, then the `"external"` lane's. `false` when no
   * Spec's forms were pending there.
   */
  runOnce(lane?: FormsLane): Promise<boolean>;
  /**
   * Builds pending forms one Spec at a time per lane, each lane polling
   * every `FORMS_POLL_MS` while none of its Specs are pending. Its timers
   * never keep the process alive.
   */
  start(): void;
  stop(): void;
};

const LANES: readonly FormsLane[] = ["local", "external"];

/**
 * The background worker that builds each Spec's Normalized Form, Validity
 * Issues and Spec Outline (ADR 0004): in-process, over the `spec_forms`
 * table, one Spec at a time per lane. A Spec stored before the table existed
 * has no row, so it is pending and gets built too: that is the backfill.
 * When no Spec is pending, a lane rebuilds its `ready` Specs built by an
 * older `FORMS_BUILDER_VERSION`, whose stored forms stay `ready` meanwhile.
 *
 * Every Spec is built first in the `"local"` lane, which never fetches. A
 * build there that asks for an external reference is discarded and its Spec
 * handed over to the `"external"` lane, which builds it again fetching its
 * references, so a Spec whose references take most of an hour to fetch
 * never holds up one that has none. External references go through
 * `fetcher`, so robots.txt, the per-host rate limit and the User-Agent apply
 * to them as to any fetch.
 */
export function createFormsWorker({
  db,
  fetcher,
  now = () => new Date(),
  env = process.env,
  refBudgetMs = FORMS_REF_BUDGET_MS,
}: {
  db: Db;
  fetcher: Fetcher;
  now?: () => Date;
  /** Default `FORMS_REF_BUDGET_MS`. */
  refBudgetMs?: number;
  /** Where `MAX_FORMS_BYTES` is read from. */
  env?: Record<string, string | undefined>;
}): FormsWorker {
  const forms = createSpecForms(db);
  let running = false;
  const timers = new Map<FormsLane, NodeJS.Timeout>();

  /**
   * Fetches same-origin references for one Spec, within one shared budget,
   * in the background so a Lookup's requests to the same host go first; in
   * the `"local"` lane, fetches none and rejects at once. `called` says
   * whether the build asked for a reference, `ranOut` whether the budget
   * ran out.
   */
  function refFetcher(lane: FormsLane) {
    let budget: AbortSignal | undefined;
    let called = false;
    return {
      fetchRef: async (url: string) => {
        called = true;
        if (lane === "local")
          throw new Error(`${url} is fetched in the external lane`);
        budget ??= AbortSignal.timeout(refBudgetMs);
        return (
          await fetcher.fetchUrl(url, { signal: budget, background: true })
        ).bytes;
      },
      called: () => called,
      ranOut: () => budget?.aborted ?? false,
    };
  }

  async function runLane(lane: FormsLane): Promise<boolean> {
    const specId = forms.nextToBuild(lane);
    if (specId === undefined) return false;
    forms.markBuilding(specId, now().toISOString());
    // The builder takes a rejected `fetchRef` for an unresolved reference,
    // so whether one was asked for is read here, not caught.
    const refs = refFetcher(lane);
    const handOver = () => lane === "local" && refs.called();
    try {
      const input = forms.buildInput(specId);
      if (!input) throw new Error(`Spec ${specId} is not in the Index`);
      const built = await buildSpecForms({
        bytes: input.bytes,
        format: input.format,
        sourceUrl: input.sourceUrl ?? "",
        fetchRef: refs.fetchRef,
        env,
        // Lets a pending HTTP request run between the build's steps.
        onStep: () => setImmediate(),
      });
      if (handOver()) {
        forms.handOver(specId);
        wake("external");
      } else if (refs.ranOut()) {
        // References left unresolved by the budget are ours, not the
        // Vendor's Validity Issues: try the build again instead.
        forms.saveFailure(
          specId,
          `external references not all fetched within ${refBudgetMs / 60_000} min`,
          now().toISOString(),
        );
      } else {
        forms.saveBuilt(specId, built, now().toISOString(), refs.called());
      }
    } catch (error) {
      if (handOver()) {
        forms.handOver(specId);
        wake("external");
      } else forms.saveFailure(specId, error, now().toISOString());
    }
    return true;
  }

  async function runOnce(lane?: FormsLane): Promise<boolean> {
    if (lane) return runLane(lane);
    const local = await runLane("local");
    return (await runLane("external")) || local;
  }

  function schedule(lane: FormsLane, ms: number) {
    const timer = setTimeout(() => tick(lane), ms);
    timer.unref();
    timers.set(lane, timer);
  }

  /** Ends `lane`'s wait for its next poll, if it is waiting. */
  function wake(lane: FormsLane) {
    const timer = timers.get(lane);
    if (!running || !timer) return;
    clearTimeout(timer);
    schedule(lane, 0);
  }

  async function tick(lane: FormsLane) {
    timers.delete(lane);
    let ran = false;
    try {
      ran = await runLane(lane);
    } catch {
      // The Index itself failed; try again after the poll interval.
    }
    if (running && !timers.has(lane)) schedule(lane, ran ? 0 : FORMS_POLL_MS);
  }

  return {
    runOnce,
    start() {
      if (running) return;
      running = true;
      for (const lane of LANES) schedule(lane, 0);
    },
    stop() {
      running = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
