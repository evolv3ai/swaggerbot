import { ChevronRight } from "lucide-react";
import { Badge, type BadgeTone } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

/** The six steps of a Lookup (PRD "Discovery"), in the order it walks them. */
export const STEPS = [
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

export type StepName = (typeof STEPS)[number]["name"];

/**
 * How a Lookup was answered: `index` (the Index answered, the usual case
 * on this page, which never holds a key), `missed` (the Index didn't know
 * the name, and the rest is Discovery, which needs a key), or the later
 * step that answered a keyed Lookup.
 */
export type Answered =
  | { by: "index"; ms: number }
  | { by: "missed" }
  | { by: "step"; step: StepName };

const H2 =
  "mb-3.5 scroll-mt-20 font-display text-xl font-bold tracking-[-0.01em] text-sb-text";

/**
 * "How it was answered": for an Index answer, one line, with the six steps
 * behind a disclosure; otherwise the six steps, each with what it did.
 */
export function HowAnswered({ answered }: { answered: Answered }) {
  return (
    <section aria-labelledby="how-answered" className="mt-10">
      <h2 id="how-answered" className={H2}>
        How it was answered
      </h2>
      {answered.by === "index" ? (
        <>
          <p className="max-w-[40em] text-sb-text-muted">
            Answered from the Index in {answered.ms.toFixed(1)} ms; no later
            step was needed.
          </p>
          <details className="group mt-3">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium text-sb-text-muted hover:text-sb-text [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="size-4 transition-transform duration-150 group-open:rotate-90"
              />
              The six steps of a Lookup
            </summary>
            <StepList answered={answered} className="mt-3" />
          </details>
        </>
      ) : (
        <>
          <p className="mb-4 max-w-[40em] text-sb-text-muted">
            {answered.by === "missed"
              ? "The Index doesn't hold the name. The five steps after it are Discovery, which needs an API key."
              : `Past the Index, by Discovery: answered at ${answered.step}.`}
          </p>
          <StepList answered={answered} />
        </>
      )}
    </section>
  );
}

/** What a step did for this Lookup, and its badge's tone. */
function statusOf(
  i: number,
  answered: Answered,
): { text: string; tone: BadgeTone } {
  if (answered.by === "index")
    return i === 0
      ? { text: "Answered here", tone: "success" }
      : { text: "Not needed", tone: "outline" };
  if (answered.by === "missed")
    return i === 0
      ? { text: "Not here", tone: "neutral" }
      : { text: "Needs a key", tone: "outline" };
  const at = STEPS.findIndex((s) => s.name === answered.step);
  if (i < at) return { text: "Checked", tone: "neutral" };
  if (i === at) return { text: "Answered here", tone: "success" };
  return { text: "Not needed", tone: "outline" };
}

/** The six steps, numbered, each with what it does and what it did. */
function StepList({
  answered,
  className,
}: {
  answered: Answered;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden rounded-[12px]", className)}>
      <ol className="divide-y divide-sb-border">
        {STEPS.map((step, i) => {
          const status = statusOf(i, answered);
          const here = status.text === "Answered here";
          return (
            <li
              key={step.name}
              aria-current={here ? "step" : undefined}
              className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[28px_minmax(0,1fr)_auto] sm:items-center"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 place-items-center rounded-md font-mono text-xs font-bold",
                  here
                    ? "bg-sb-accent text-sb-text-on-accent"
                    : "bg-sb-accent-soft text-sb-accent-soft-text",
                )}
              >
                {i + 1}
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="text-sm font-semibold">{step.name}</span>
                <span className="text-[13px] leading-snug text-sb-text-muted">
                  {step.note}
                </span>
              </span>
              <span className="col-start-2 sm:col-start-3">
                <Badge tone={status.tone}>{status.text}</Badge>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
