import type { Provenance } from "~/domain/provenance";
import { cn } from "~/lib/utils";
import { Badge, type BadgeTone } from "./badge";

/**
 * Each tier's badge, strongest first: Official and Endorsed filled (Official
 * with the status "eye"), Mirror and Community in outline, Community's
 * dashed. The tier's name is always written: the style is never the only
 * signal.
 */
const TIER: Record<
  Provenance,
  { tone: BadgeTone; dot: boolean; className?: string }
> = {
  Official: { tone: "accent", dot: true },
  Endorsed: { tone: "neutral", dot: false },
  Mirror: { tone: "outline", dot: false },
  Community: { tone: "outline", dot: false, className: "border-dashed" },
};

/**
 * A Spec's Provenance as a badge, in the style of `AnswerBadge`. `label`
 * adds "Provenance: " for screen readers, where the badge stands alone.
 */
export function ProvenanceBadge({
  provenance,
  label = true,
  className,
}: {
  provenance: Provenance;
  label?: boolean;
  className?: string;
}) {
  const tier = TIER[provenance];
  return (
    <Badge
      tone={tier.tone}
      dot={tier.dot}
      className={cn(tier.className, className)}
    >
      {label ? <span className="sr-only">Provenance: </span> : null}
      {provenance}
    </Badge>
  );
}
