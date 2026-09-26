import { Card } from "~/components/ui/card";
import { ProvenanceBadge } from "~/components/ui/provenance-badge";
import type { Source } from "~/domain/catalog";
import { dayOf } from "~/lib/dates";
import { cn } from "~/lib/utils";

/**
 * Where a Spec was found: each Source with its Provenance, its URL (as
 * text: a Source is a claim, not a link we vouch for) and when it was last
 * verified. `headingClassName` styles the section's `h2`.
 */
export function Sources({
  sources,
  headingClassName,
}: {
  sources: Pick<Source, "id" | "url" | "provenance" | "lastVerifiedAt">[];
  headingClassName?: string;
}) {
  return (
    <section aria-labelledby="sources">
      <h2 id="sources" className={cn(headingClassName)}>
        Sources
      </h2>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-sb-border">
          {sources.map((source) => (
            <li
              key={source.id}
              className="grid gap-1.5 px-4 py-3.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-baseline sm:gap-x-4"
            >
              <span>
                <ProvenanceBadge provenance={source.provenance} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="font-mono text-[13px] text-sb-text [overflow-wrap:anywhere]">
                  {source.url}
                </span>
                <span className="text-[13px] text-sb-text-muted">
                  Last verified{" "}
                  <time dateTime={source.lastVerifiedAt}>
                    {dayOf(source.lastVerifiedAt)}
                  </time>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
