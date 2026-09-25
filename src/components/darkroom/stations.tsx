import { cn } from "~/lib/utils";

/** The Source chain (PRD "Discovery"), in the order a Lookup walks it. */
export const STATIONS = [
  {
    name: "Index",
    note: "Specs verified before. Answered in milliseconds, no key needed.",
  },
  { name: "APIs.guru", note: "The public directory of API descriptions." },
  { name: "Developer Portal", note: "Found with a web search." },
  {
    name: "Vendor domain",
    note: "Known paths, apis.json, then a shallow crawl.",
  },
  { name: "GitHub", note: "The Vendor's organisation first, then the rest." },
  {
    // A Jev judgment (ADR 0001); "Verification" in CONTEXT.md is the
    // re-check of an Index entry, a different thing.
    name: "Judged",
    note: "Is it the API you meant, and its Spec? Not sure means we say so.",
  },
] as const;

/**
 * Where a Lookup is on the chain. `checking`: at the Index. `answered`: the
 * Index answered, so no later station was needed.
 */
export type ChainState = "idle" | "checking" | "answered";

/**
 * The chain as numbered stations: the numbers carry the order a Lookup runs
 * in. The Index station lights while a Lookup is there; once the Index has
 * answered, the stations after it say they weren't needed.
 */
export function Stations({
  state,
  className,
}: {
  state: ChainState;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-rule bg-rule sm:grid-cols-3 xl:grid-cols-6",
        className,
      )}
    >
      {STATIONS.map((station, i) => {
        const lit = i === 0 && state !== "idle";
        const skipped = i > 0 && state === "answered";
        return (
          <li
            key={station.name}
            aria-current={lit ? "step" : undefined}
            className={cn(
              "grid content-start gap-1.5 bg-bay p-4 transition-colors duration-500",
              lit && "bg-lamp text-[#0e0e0e]",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-segment text-sm" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              {i === 0 && state === "answered" ? (
                <span className="rounded-[2px] bg-[#0e0e0e] px-1.5 py-px font-caps text-xs font-semibold uppercase tracking-[0.12em] text-lamp">
                  Answered here
                </span>
              ) : null}
              {skipped ? (
                <span className="font-caps text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">
                  Not needed
                </span>
              ) : null}
            </span>
            <span className="font-caps text-lg font-semibold uppercase leading-tight tracking-wide">
              {station.name}
            </span>
            <span
              className={cn(
                "text-sm leading-snug text-ink-2",
                lit && "text-[#3a2206]",
              )}
            >
              {station.note}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
