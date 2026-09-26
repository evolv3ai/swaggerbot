import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "~/lib/utils";

/**
 * Code to copy (a command, a call, a JSON answer) on the ink code ground, in
 * both themes, with a Copy button; a polite live region says when it has
 * copied. `code` is what is copied; `children`, when given, is what shows
 * (the same text with parts picked out). Line breaks and indentation are
 * kept; long lines wrap unless `scroll`.
 */
export function CodeBlock({
  code,
  children,
  scroll = false,
  className,
}: {
  code: string;
  children?: ReactNode;
  scroll?: boolean;
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
    <div
      className={cn(
        "group relative flex min-w-0 items-start gap-3 bg-sb-code-bg text-sb-code-text",
        className,
      )}
    >
      <pre
        className={cn(
          "min-w-0 flex-1 px-4 py-3.5 font-mono text-[12.5px] leading-[1.7]",
          scroll
            ? "overflow-x-auto whitespace-pre"
            : "whitespace-pre-wrap [overflow-wrap:anywhere]",
        )}
      >
        <code>{children ?? code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="mt-2.5 mr-2.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-white/15 px-2 font-sans text-xs font-medium text-[#cfd5de] transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white [&_svg]:size-3.5"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <p className="sr-only" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </p>
    </div>
  );
}
