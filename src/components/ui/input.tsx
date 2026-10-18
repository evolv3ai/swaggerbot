import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The design system's Input (components/forms/Input): 2px edge, 10px
 * radius, the edge turns blue on focus. `mono` for URLs, ids and paths.
 * On a touch screen it is 44px tall with 16px text: iOS zooms the page into
 * a field set smaller.
 */
export function Input({
  className,
  mono,
  ...props
}: ComponentProps<"input"> & { mono?: boolean }) {
  return (
    <input
      className={cn(
        "h-10 w-full min-w-0 rounded-md border-2 pointer-coarse:h-11 pointer-coarse:text-base border-sb-border-input bg-sb-bg px-3 text-sm text-sb-text transition-colors duration-150 placeholder:text-sb-text-faint hover:border-sb-border-input-hover focus-visible:border-sb-accent disabled:cursor-not-allowed disabled:bg-sb-surface-sunken disabled:text-sb-text-faint",
        mono && "font-mono text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The Input grown to a field of several lines (three by default), for a
 * question: the same edge, radius, ground and focus, 16px text on a touch
 * screen; it grows by hand, never sideways.
 */
export function Textarea({
  className,
  rows = 3,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "block w-full min-w-0 resize-y rounded-md border-2 border-sb-border-input bg-sb-bg px-3 py-2 text-sm leading-6 text-sb-text transition-colors duration-150 placeholder:text-sb-text-faint hover:border-sb-border-input-hover focus-visible:border-sb-accent disabled:cursor-not-allowed disabled:bg-sb-surface-sunken disabled:text-sb-text-faint pointer-coarse:text-base",
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
