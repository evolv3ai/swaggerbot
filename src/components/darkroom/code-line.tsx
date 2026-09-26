import { useState } from "react";
import { cn } from "~/lib/utils";

/**
 * A line to copy (a command, a call) on dense black, with the attached amber
 * Copy; a polite live region says when it has copied. Line breaks and
 * indentation in `code` are kept, so an answer's JSON reads as printed.
 * `label` is the button's word ("Copy", or "Copy URL" beside a URL).
 */
export function CodeLine({
  code,
  label = "Copy",
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={cn("grid", className)}>
      <div className="flex min-w-0 items-stretch overflow-hidden rounded-[3px] border border-ink bg-strip-5">
        <code className="min-w-0 flex-1 px-3 py-2.5 font-mono text-sm leading-relaxed text-print whitespace-pre-wrap [overflow-wrap:anywhere]">
          {code}
        </code>
        <button
          type="button"
          onClick={copy}
          className={cn(
            "shrink-0 border-l border-ink bg-lamp px-3 font-caps text-sm font-bold uppercase tracking-[0.12em] text-[#0e0e0e]",
            // On a block of several lines, Copy sits by its first line.
            code.includes("\n") && "flex items-start pt-3",
          )}
        >
          {copied ? "Copied" : label}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </p>
    </div>
  );
}
