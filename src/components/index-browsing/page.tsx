import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/** The docs page column, as on `/`. */
export const PAGE = "max-w-[860px] px-4 pt-7 pb-16 sm:px-8 lg:px-14 lg:pt-11";

/** The tracked eyebrow above a page's title. */
export const EYEBROW =
  "font-display text-xs font-bold uppercase tracking-[0.3em] text-sb-accent-text";

/** A page's title: Montserrat 800, sentence case. */
export const H1 =
  "mt-2 mb-2.5 scroll-mt-20 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.01em] text-sb-text [overflow-wrap:anywhere] sm:text-[40px]";

/** A section heading. */
export const H2 =
  "mt-10 mb-3.5 scroll-mt-20 font-display text-xl font-bold tracking-[-0.01em] text-sb-text";

/** The lead under a page's title. */
export const LEAD = "max-w-[40em] text-[17px] text-sb-text-muted";

/** The eyebrow and title of an Index page. */
export function PageTitle({
  eyebrow,
  id,
  children,
}: {
  eyebrow: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <>
      <p className={EYEBROW}>{eyebrow}</p>
      <h1 id={id} className={H1}>
        {children}
      </h1>
    </>
  );
}

/** "All Vendors", back to `/vendors`, above a Vendor's page. */
export function BackToVendors({ className }: { className?: string }) {
  return (
    <p className={cn("mb-5 text-sm", className)}>
      <a
        href="/vendors"
        className="inline-flex items-center gap-1 text-sb-text-muted hover:text-sb-text"
      >
        <ChevronLeft aria-hidden="true" className="size-3.5" />
        All Vendors
      </a>
    </p>
  );
}
