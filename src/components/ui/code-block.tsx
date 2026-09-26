import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "~/lib/utils";

/**
 * Code to copy (a command, a call, a JSON answer) on the ink code ground, in
 * both themes, with a Copy button; a polite live region says when it has
 * copied. `code` is what is copied; `children`, when given, is what shows
 * (the same text with parts picked out). Line breaks and indentation are
 * kept; long lines wrap unless `scroll`.
 *
 * `oneLine` opts in to a display form: `children` is a shortened stand-in
 * for `code` (a part elided, as `SpecDownloadCurl` does), kept on one line
 * (scrolling sideways on a screen too narrow even for that), hidden from
 * screen readers, which read the whole of `code` instead. Copy still copies
 * `code`, never the stand-in.
 */
export function CodeBlock({
  code,
  children,
  scroll = false,
  oneLine = false,
  className,
}: {
  code: string;
  children?: ReactNode;
  scroll?: boolean;
  oneLine?: boolean;
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
          "min-w-0 flex-1 py-3.5 font-mono leading-[1.7]",
          oneLine
            ? "px-2.5 text-[10.5px] max-[380px]:text-[10px] sm:px-4 sm:text-[12.5px]"
            : "px-4 text-[12.5px]",
          oneLine || scroll
            ? "overflow-x-auto whitespace-pre"
            : "whitespace-pre-wrap [overflow-wrap:anywhere]",
        )}
      >
        {oneLine && children ? (
          <>
            <code aria-hidden="true">{children}</code>
            <span className="sr-only">{code}</span>
          </>
        ) : (
          <code>{children ?? code}</code>
        )}
      </pre>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "mt-2.5 mr-2.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-white/15 px-2 font-sans text-xs font-medium text-[#cfd5de] transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white [&_svg]:size-3.5",
          // A one-line block keeps its line on a phone: the button is its icon.
          oneLine && "px-[7px] sm:px-2",
        )}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {oneLine ? (
          <span className="sr-only sm:not-sr-only">
            {copied ? "Copied" : "Copy"}
          </span>
        ) : copied ? (
          "Copied"
        ) : (
          "Copy"
        )}
      </button>
      <p className="sr-only" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </p>
    </div>
  );
}

/** A Spec id as shown in a one-line command: `1fdc1047…78a9`. */
export function elideSpecId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/**
 * The download command for a Spec, `curl -o openapi.{format} {url}`, on one
 * line as the mock shows it: the origin and most of the Spec id elided, the
 * id picked out in the accent (`…/specs/1fdc1047…78a9/published`; on a
 * phone `…/1fdc…78a9/published`).
 * Copy copies the whole, real command; a screen reader reads it whole.
 */
export function SpecDownloadCurl({
  url,
  format,
  className,
}: {
  url: string;
  format: string;
  className?: string;
}) {
  const code = `curl -o openapi.${format} ${url}`;
  const match = url.match(/^(.*\/specs\/)([0-9a-f]{16,})(\/.*)?$/);
  if (!match) return <CodeBlock code={code} className={className} />;
  const [, , id = "", after = ""] = match;
  return (
    <CodeBlock code={code} oneLine className={className}>
      <span className="text-[#8fbaff]">curl</span> -o openapi.{format} …
      <span className="hidden sm:inline">/specs</span>/
      <span className="text-[#5cbfeb]">
        <span className="hidden sm:inline">{elideSpecId(id)}</span>
        <span className="sm:hidden">{`${id.slice(0, 4)}…${id.slice(-4)}`}</span>
      </span>
      {after}
    </CodeBlock>
  );
}
