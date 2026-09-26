import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The design system's Button (components/actions/Button): `primary` (blue,
 * the one key action per view), `secondary` (outlined, blue edge on hover),
 * `ghost`. Sizes 32 / 40 / 48. `buttonClass` styles a link as a button; it
 * carries `no-underline`, the link rule's opt-out.
 */
export const buttonClass = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border-2 font-display font-bold leading-none no-underline transition-[background-color,border-color,color,translate] duration-150 ease-[var(--sb-ease-out)] active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[1.15em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-sb-accent text-sb-text-on-accent hover:bg-sb-accent-hover active:bg-[var(--sb-accent-press)]",
        secondary:
          "border-sb-border-strong bg-transparent text-sb-text hover:border-sb-accent hover:text-sb-accent-text",
        ghost:
          "border-transparent bg-transparent text-sb-accent-text hover:bg-sb-accent-soft",
      },
      size: {
        sm: "h-8 rounded-sm px-3 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariants = VariantProps<typeof buttonClass>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & ButtonVariants) {
  return (
    <button
      type={type}
      className={cn(buttonClass({ variant, size }), className)}
      {...props}
    />
  );
}
