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
