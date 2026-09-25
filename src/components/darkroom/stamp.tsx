import { cn } from "~/lib/utils";

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** `2026-09-24T…` → `24 Sep 2026` (UTC). */
export function dayOf(iso: string): string {
  return DAY.format(new Date(iso));
}

/**
 * When a Spec was last verified. A Stale one reads washed out and says so:
 * a Lookup still answers with it, and queues a Verification.
 */
export function VerifiedStamp({
  verifiedAt,
  stale,
  on = "print",
  className,
}: {
  verifiedAt: string | null;
  stale: boolean;
  /** What it sits on: a print's enamel, or the bay. */
  on?: "print" | "bay";
  className?: string;
}) {
  if (!verifiedAt) return <span className={className}>Not verified</span>;
  return (
    <span
      className={cn(
        stale && (on === "bay" ? "text-ink-2" : "text-print-ink-2"),
        className,
      )}
    >
      <time dateTime={verifiedAt}>{dayOf(verifiedAt)}</time>
      {stale ? " · Stale" : null}
    </span>
  );
}
