import { ChevronLeft } from "lucide-react";
import { cn } from "~/lib/utils";

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
