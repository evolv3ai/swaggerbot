import { CodeBlock } from "~/components/ui/code-block";
import { cn } from "~/lib/utils";

/**
 * TEMPORARY: the Darkroom's code line, now the design system's CodeBlock,
 * for the pages not yet migrated (Docs, the Lookup result). Use CodeBlock.
 */
export function CodeLine({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  return (
    <CodeBlock
      code={code}
      className={cn(
        "overflow-hidden rounded-md border border-sb-border",
        className,
      )}
    />
  );
}
