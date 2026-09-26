import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

export type BadgeTone =
  | "accent"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "outline";

const TONE: Record<BadgeTone, string> = {
  accent: "bg-sb-accent-soft text-sb-accent-soft-text",
  neutral: "bg-sb-surface-sunken text-sb-text dark:bg-sb-border",
  success: "bg-sb-success-soft text-sb-success-text",
  warning: "bg-sb-warning-soft text-sb-warning-text",
  danger: "bg-sb-danger-soft text-sb-danger-text",
  outline:
    "border-[1.5px] border-sb-border-strong bg-transparent text-sb-text-muted",
};

/**
 * The design system's Badge (components/display/Badge): a small pill, in
 * Montserrat bold capitals. `dot` adds the round status "eye".
 */
export function Badge({
  tone = "accent",
  dot = false,
  className,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 font-display text-[11px] font-bold uppercase leading-none tracking-[0.06em]",
        TONE[tone],
        dot &&
          "before:size-1.5 before:rounded-full before:bg-current before:content-['']",
        className,
      )}
      {...props}
    />
  );
}
