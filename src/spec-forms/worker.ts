import { setImmediate } from "node:timers/promises";
import type { Fetcher } from "~/fetch/fetcher";
import type { Db } from "~/index-store/db";
import { createSpecForms } from "~/index-store/spec-forms";
import { buildSpecForms } from "./build";

/** How long `start()` waits between polls while no Spec's forms are pending. */
export const FORMS_POLL_MS = 5_000;

/**
 * The time all the external references of one Spec may take to fetch,
 * together, from the first. Room for DigitalOcean's 697 files on one host at
 * the fetcher's one request per second (about 12 min).
 */
export const FORMS_REF_BUDGET_MS = 20 * 60_000;

export type FormsWorker = {
  /**
   * Builds the forms of the oldest Spec whose forms are pending, and stores
   * them, or the failure. `false` when no Spec's forms were pending.
   */
  runOnce(): Promise<boolean>;
  /**
   * Builds pending forms one Spec at a time, polling every `FORMS_POLL_MS`
   * while none are pending. Its timer never keeps the process alive.
   */
  start(): void;
  stop(): void;
};

/**
 * The background worker that builds each Spec's Normalized Form, Validity
 * Issues and Spec Outline (ADR 0004): in-process, one Spec at a time, over
 * the `spec_forms` table. A Spec stored before the table existed has no row,
 * so it is pending and gets built too: that is the backfill. External
 * references go through `fetcher`, so robots.txt, the per-host rate limit
 * and the User-Agent apply to them as to any fetch.
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
  let timer: NodeJS.Timeout | undefined;

  /**
   * Fetches same-origin references for one Spec, within one shared budget,
   * in the background so a Lookup's requests to the same host go first.
   * `ranOut` says whether the budget ran out.
   */
  function refFetcher() {
    let budget: AbortSignal | undefined;
    return {
      fetchRef: async (url: string) => {
        budget ??= AbortSignal.timeout(refBudgetMs);
        return (
          await fetcher.fetchUrl(url, { signal: budget, background: true })
        ).bytes;
      },
      ranOut: () => budget?.aborted ?? false,
    };
  }

  async function runOnce(): Promise<boolean> {
    const specId = forms.nextToBuild();
    if (specId === undefined) return false;
    forms.markBuilding(specId, now().toISOString());
    try {
      const input = forms.buildInput(specId);
      if (!input) throw new Error(`Spec ${specId} is not in the Index`);
      const refs = refFetcher();
      const built = await buildSpecForms({
        bytes: input.bytes,
        format: input.format,
        sourceUrl: input.sourceUrl ?? "",
        fetchRef: refs.fetchRef,
        env,
        // Lets a pending HTTP request run between the build's steps.
        onStep: () => setImmediate(),
      });
      if (refs.ranOut()) {
        // References left unresolved by the budget are ours, not the
        // Vendor's Validity Issues: try the build again instead.
        forms.saveFailure(
          specId,
          `external references not all fetched within ${refBudgetMs / 60_000} min`,
          now().toISOString(),
        );
      } else {
        forms.saveBuilt(specId, built, now().toISOString());
      }
    } catch (error) {
      forms.saveFailure(specId, error, now().toISOString());
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
    if (running && !timer) schedule(ran ? 0 : FORMS_POLL_MS);
  }

  return {
    runOnce,
    start() {
      if (running) return;
      running = true;
      schedule(0);
    },
    stop() {
      running = false;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
