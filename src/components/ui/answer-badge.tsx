import type { OutcomeKind } from "~/domain/outcome";
import { cn } from "~/lib/utils";
import { Badge, type BadgeTone } from "./badge";

/**
 * The five answers, sure to not found, with the design system's fixed
 * colours (readme, "Answer → colour mapping"): Resolved green, Unconfirmed
 * amber, Ambiguous blue, No Spec neutral, Unknown outline.
 */
export const ANSWERS: {
  outcome: OutcomeKind;
  name: string;
  short: string;
  tone: BadgeTone;
}[] = [
  { outcome: "Resolved", name: "Resolved", short: "Resolved", tone: "success" },
  {
    outcome: "Unconfirmed",
    name: "Unconfirmed",
    short: "Unconf.",
    tone: "warning",
  },
  { outcome: "Ambiguous", name: "Ambiguous", short: "Ambig.", tone: "accent" },
  { outcome: "NoSpec", name: "No Spec", short: "No Spec", tone: "neutral" },
  { outcome: "Unknown", name: "Unknown", short: "Unknown", tone: "outline" },
];

const BY_OUTCOME = new Map(ANSWERS.map((a) => [a.outcome, a]));
const UNKNOWN = {
  name: "Unknown",
  short: "Unknown",
  tone: "outline",
} as const satisfies Pick<(typeof ANSWERS)[number], "name" | "short" | "tone">;

/**
 * One Lookup answer as a badge. Its name is always written: the colour is
 * never the only signal.
 */
export function AnswerBadge({
  outcome,
  short = false,
  className,
}: {
  outcome: OutcomeKind;
  short?: boolean;
  className?: string;
}) {
  const answer = BY_OUTCOME.get(outcome) ?? UNKNOWN;
  return (
    <Badge tone={answer.tone} dot className={cn(className)}>
      {short ? (
        <abbr title={answer.name} className="no-underline">
          {answer.short}
        </abbr>
      ) : (
        answer.name
      )}
    </Badge>
  );
}
