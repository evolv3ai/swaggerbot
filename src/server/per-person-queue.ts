/**
 * Actions keyed by person, run one at a time: each starts after the
 * person's earlier one has settled. Used by the key page (two quick clicks
 * on "Create" can't issue two keys) and by Ask this Spec's gate, which
 * refuses a second turn while one is `busy` instead of queueing it.
 */
export function createPerPersonQueue() {
  const queues = new Map<string, Promise<unknown>>();

  return {
    /** Runs `action` after any earlier action of `key`'s has settled. */
    run<T>(key: string, action: () => Promise<T>): Promise<T> {
      const prior = queues.get(key) ?? Promise.resolve();
      // Cleared before the caller's await resumes, so `busy` is false for
      // a turn started right after the last one ends.
      const run = prior.then(action, action).finally(() => {
        if (queues.get(key) === settled) queues.delete(key);
      });
      const settled = run.catch(() => undefined);
      queues.set(key, settled);
      return run;
    },

    /** Whether an action of `key`'s is queued or running. */
    busy(key: string): boolean {
      return queues.has(key);
    },
  };
}

export type PerPersonQueue = ReturnType<typeof createPerPersonQueue>;
