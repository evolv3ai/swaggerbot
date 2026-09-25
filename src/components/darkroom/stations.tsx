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
    name: "Judged",
    note: "Is it the API you meant, and its Spec? Not sure means we say so.",
  },
] as const;

/**
 * The chain as numbered stations: the numbers carry the order a Lookup runs
 * in. `active` lights the station a Lookup is at.
 */
export function Stations({
  active,
  className,
}: {
  active?: number;
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
        const lit = active === i;
        return (
          <li
            key={station.name}
            aria-current={lit ? "step" : undefined}
            className={cn(
              "grid content-start gap-1.5 bg-bay p-4 transition-colors duration-300",
              lit && "bg-lamp text-[#0e0e0e]",
            )}
          >
            <span className="font-segment text-sm" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
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
