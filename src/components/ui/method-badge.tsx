import { cn } from "~/lib/utils";

export type HttpMethod = "GET" | "POST";

/**
 * An HTTP method tag, as the sidebar's HTTP API links carry it: POST and GET
 * in their own tints, in mono. `md` is the size for a route heading.
 */
export function MethodBadge({
  method,
  size = "sm",
  className,
}: {
  method: HttpMethod;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-[5px] font-mono font-medium",
        size === "sm"
          ? "px-[5px] py-px text-[10.5px] leading-4"
          : "px-1.5 py-0.5 text-[12px] leading-[18px]",
        method === "POST"
          ? "bg-[color-mix(in_srgb,#6ea8ff_16%,transparent)] text-[#1d4ed8] dark:text-[#8fbaff]"
          : "bg-sb-accent-soft text-sb-accent-soft-text",
        className,
      )}
    >
      {method}
    </span>
  );
}

/**
 * `POST /api/lookup` → its method and the rest. Anything that doesn't start
 * with a method has none.
 */
export function splitRoute(route: string): {
  method: HttpMethod | null;
  rest: string;
} {
  const match = /^(GET|POST)\s+(.*)$/s.exec(route);
  return match
    ? { method: match[1] as HttpMethod, rest: match[2] ?? "" }
    : { method: null, rest: route };
}
