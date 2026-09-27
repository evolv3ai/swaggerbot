import { Check, CircleAlert, Copy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { pathBreakable } from "./path";

/**
 * Code to copy (a command, a call, a JSON answer) on the ink code ground, in
 * both themes, with a Copy button; a polite live region says when it has
 * copied. `code` is what is copied; `children`, when given, is what shows
 * (the same text with parts picked out). Line breaks and indentation are
 * kept; long lines wrap unless `scroll`, between a URL's parts (`pathBreakable`)
 * rather than inside a word. A shell command's first word (`curl`,
 * `claude`) is picked out in the code keyword colour.
 *
 * `elided` opts in to a display form: `children` is a shortened stand-in
 * for `code` (a part elided, as `SpecDownloadCurl` does), kept on one line
 * from `sm` up and wrapped at the usual size on a phone, hidden from screen
 * readers, which read the whole of `code` instead. Copy still copies
 * `code`, never the stand-in.
 *
 * When the clipboard refuses (no permission, an insecure origin, an old
 * browser), the button says so and the code is selected, ready for the
 * visitor's own copy.
 */
export function CodeBlock({
  code,
  children,
  scroll = false,
  elided = false,
  className,
}: {
  code: string;
  children?: ReactNode;
  scroll?: boolean;
  elided?: boolean;
  className?: string;
}) {
  const shown = children ?? commandWord(code);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const pre = useRef<HTMLPreElement>(null);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const settle = (next: "copied" | "failed", ms: number) => {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), ms);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      settle("copied", 2000);
    } catch {
      // Select the code, so the visitor's own copy takes it: in an elided
      // block, the whole command (hidden), not the stand-in.
      const target = pre.current?.querySelector("[data-copy]") ?? pre.current;
      const selection = window.getSelection();
      if (target && selection) {
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      settle("failed", 6000);
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
        ref={pre}
        className={cn(
          "min-w-0 flex-1 px-4 py-3.5 font-mono text-[12.5px] leading-[1.7]",
          scroll
            ? "overflow-x-auto whitespace-pre"
            : elided
              ? "whitespace-pre-wrap [overflow-wrap:anywhere] sm:overflow-x-auto sm:whitespace-pre"
              : "whitespace-pre-wrap [overflow-wrap:anywhere]",
        )}
      >
        {elided && children ? (
          <>
            <code aria-hidden="true">{pathBreakable(children)}</code>
            <span className="sr-only" data-copy>
              {code}
            </span>
          </>
        ) : (
          <code>{scroll ? shown : pathBreakable(shown)}</code>
        )}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="mt-2.5 mr-2.5 inline-flex h-7 shrink-0 pointer-coarse:mt-1.5 pointer-coarse:mr-1.5 pointer-coarse:h-11 pointer-coarse:px-3 items-center gap-1.5 rounded-sm border border-white/15 px-2 font-sans text-xs font-medium text-sb-code-text transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white [&_svg]:size-3.5"
      >
        {state === "copied" ? (
          <Check aria-hidden="true" />
        ) : state === "failed" ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy it yourself"
            : "Copy"}
      </button>
      <p className="sr-only" aria-live="polite">
        {state === "copied"
          ? "Copied to the clipboard"
          : state === "failed"
            ? "The browser didn't allow copying. The code is selected: copy it with your keyboard or menu."
            : ""}
      </p>
    </div>
  );
}

/** `code` with its command word (`curl`, `claude`) picked out, if any. */
function commandWord(code: string): ReactNode {
  const match = /^(curl|claude)(?=\s)/.exec(code);
  if (!match?.[1]) return code;
  return (
    <>
      <span className="text-sb-code-keyword">{match[1]}</span>
      {code.slice(match[1].length)}
    </>
  );
}

/** A Spec id as shown in an elided command: `1fdc1047…78a9`. */
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
    <CodeBlock code={code} elided className={className}>
      <span className="text-sb-code-keyword">curl</span> -o openapi.{format}{" "}
      {/* The elided path never breaks inside: on a phone it takes a line. */}
      <span className="whitespace-nowrap">
        …<span className="hidden sm:inline">/specs</span>/
        <span className="text-sb-code-accent">
          <span className="hidden sm:inline">{elideSpecId(id)}</span>
          <span className="sm:hidden">{`${id.slice(0, 4)}…${id.slice(-4)}`}</span>
        </span>
        {after}
      </span>
    </CodeBlock>
  );
}
