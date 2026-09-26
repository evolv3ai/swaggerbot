import { createServerFn } from "@tanstack/react-start";
import type { IndexStats } from "./index-stats";

/**
 * The Index facts every page's shell shows (the counts, the most recently
 * verified APIs), read on the server. Null when the Index can't be read, so a page
 * still renders without them. Server-only modules are imported inside the
 * handler, keeping them out of the client bundle.
 */
export const getShellFacts = createServerFn({ method: "GET" }).handler(
  async (): Promise<IndexStats | null> => {
    const [{ getApp }, { indexStats }, { freshnessDaysOf }] = await Promise.all(
      [
        import("./app-instance"),
        import("./index-stats"),
        import("~/lookup/app"),
      ],
    );
    try {
      const { db, lookup } = getApp();
      return indexStats(db, lookup, {
        freshnessDays: freshnessDaysOf(process.env),
      });
    } catch (error) {
      console.error("Shell facts unavailable:", error);
      return null;
    }
  },
);
