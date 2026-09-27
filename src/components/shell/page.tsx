import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/** The docs page column: at most 860px, the shell's gutters. */
export const PAGE = "max-w-[860px] px-4 pt-7 pb-16 sm:px-8 lg:px-14 lg:pt-11";

/** A page's title: Montserrat 800, 28px, 40px from `sm`, sentence case. */
export const H1 =
  "mb-2.5 scroll-mt-20 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.01em] text-sb-text sm:text-[40px]";

/** A section heading: Montserrat 700, 20px, 40px above, 14px below. */
export const H2 =
  "mt-10 mb-3.5 scroll-mt-20 font-display text-xl font-bold tracking-[-0.01em] text-sb-text";

/** The lead under a page's title. */
export const LEAD = "max-w-[40em] text-[17px] text-sb-text-muted";

/**
 * A page's title, one per page. No category label above it: the sidebar
 * and the title already say where the visitor is (the One Tagline Rule).
 * A title that is a name from outside (a Vendor's, an API's) adds
 * `[overflow-wrap:anywhere]`, so a long one can't overflow a phone.
 */
export function PageTitle({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <h1 id={id} className={cn(H1, className)}>
      {children}
    </h1>
  );
}
