import { CodeBlock } from "~/components/ui/code-block";
import { cn } from "~/lib/utils";

/**
 * TEMPORARY: the Darkroom's code line, now the design system's CodeBlock,
 * for the pages not yet migrated (Docs, the Lookup result). Use CodeBlock.
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
  return (
    <CodeBlock
      code={code}
      label={label}
      className={cn(
        "overflow-hidden rounded-md border border-sb-border",
        className,
      )}
    />
  );
}
