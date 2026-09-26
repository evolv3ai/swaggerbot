import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The design system's Input (components/forms/Input): 2px edge, 10px
 * radius, the edge turns blue on focus. `mono` for URLs, ids and paths.
 */
export function Input({
  className,
  mono,
  ...props
}: ComponentProps<"input"> & { mono?: boolean }) {
  return (
    <input
      className={cn(
        "h-10 w-full min-w-0 rounded-md border-2 border-sb-border bg-sb-bg px-3 text-sm text-sb-text transition-colors duration-150 placeholder:text-sb-text-faint hover:border-sb-border-strong focus-visible:border-sb-accent disabled:cursor-not-allowed disabled:bg-sb-surface-sunken disabled:text-sb-text-faint",
        mono && "font-mono text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

/** A form label in the design system's style. */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or wrap the control
    <label
      className={cn(
        "font-display text-[13px] font-bold text-sb-text",
        className,
      )}
      {...props}
    />
  );
}
