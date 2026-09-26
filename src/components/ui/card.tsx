import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The design system's Card (components/display/Card): a 16px-radius surface
 * with a 1px edge. `outline` is the 2px blue highlight, once per view;
 * `raised` trades the edge for a shadow.
 */
export function Card({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "outline" | "raised" }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-sb-surface text-sb-text",
        variant === "default" && "border border-sb-border",
        variant === "outline" &&
          "border-2 border-sb-accent shadow-[var(--sb-shadow-box)]",
        variant === "raised" && "shadow-[var(--sb-shadow-md)]",
        className,
      )}
      {...props}
    />
  );
}
