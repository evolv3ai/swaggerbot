import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "~/lib/utils";

/**
 * The top bar's Lookup: a name, sent as a GET to `/lookup` (so it works
 * without script). ⌘K / Ctrl-K and `/` focus it (the shell listens for
 * them, `useQuickLookupKeys`).
 */
export function QuickLookup({ className }: { className?: string }) {
  const id = useId();
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  return (
    <search aria-label="Quick Lookup" className={cn("block", className)}>
      <form action="/lookup" method="get" className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-sb-text-muted"
        />
        <label htmlFor={`${id}-q`} className="sr-only">
          Look up an API by name
        </label>
        <input
          id={`${id}-q`}
          name="name"
          required
          autoComplete="off"
          spellCheck={false}
          data-quick-lookup
          aria-keyshortcuts="Meta+K Control+K /"
          placeholder="Look up an API by name"
          className="h-[38px] w-full rounded-md border border-sb-border bg-sb-bg-subtle pr-14 pl-9 text-sm text-sb-text placeholder:text-sb-text-muted hover:border-sb-border-strong focus-visible:border-sb-accent"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-[6px] border border-sb-border px-1.5 text-xs font-medium leading-5 text-sb-text-muted"
        >
          {mac ? "⌘K" : "Ctrl K"}
        </span>
      </form>
    </search>
  );
}

/**
 * ⌘K / Ctrl-K anywhere, and `/` when not typing, focus the first Quick
 * Lookup field on screen; when none is (the phone's top bar has none),
 * `onNone` runs (the shell opens its menu, which has one).
 */
export function useQuickLookupKeys(onNone: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      const combo = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey);
      const slash = e.key === "/" && !typing && !e.metaKey && !e.ctrlKey;
      if (!combo && !slash) return;
      e.preventDefault();
      const field = [
        ...document.querySelectorAll<HTMLInputElement>(
          "input[data-quick-lookup]",
        ),
      ].find((el) => el.getClientRects().length > 0);
      if (field) {
        field.focus();
        field.select();
      } else onNone();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onNone]);
}
