import { Link, useRouterState } from "@tanstack/react-router";
import { useId } from "react";
import { cn } from "~/lib/utils";
import { activeLink, NAV, type NavLink } from "./nav";

/** A method tag on an HTTP API link: POST and GET in their own tints. */
function Method({ method }: { method: NonNullable<NavLink["method"]> }) {
  return (
    <span
      className={cn(
        "mr-1.5 inline-block rounded-[5px] px-[5px] py-px font-mono text-[10.5px] font-medium leading-4",
        method === "POST"
          ? "bg-[color-mix(in_srgb,#6ea8ff_16%,transparent)] text-[#1d4ed8] dark:text-[#8fbaff]"
          : "bg-sb-accent-soft text-sb-accent-soft-text",
      )}
    >
      {method}
    </span>
  );
}

/**
 * The docs sidebar: Get started, The Index, HTTP API, MCP. The link for
 * where the visitor is (path and anchor) is marked current. `vendors` is
 * the Index's live Vendor count.
 */
export function Sidebar({
  vendors,
  className,
}: {
  vendors: number | null;
  className?: string;
}) {
  const base = useId();
  const { pathname, hash } = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, hash: s.location.hash }),
  });
  const active = activeLink(pathname, hash);
  return (
    <nav aria-label="Docs" className={cn("text-sm", className)}>
      {NAV.map((group, g) => (
        <div key={group.title} className={cn(g > 0 && "mt-[22px]")}>
          <p
            id={`${base}-${g}`}
            className="mb-2 text-xs font-semibold text-sb-text"
          >
            {group.title}
          </p>
          <ul aria-labelledby={`${base}-${g}`}>
            {group.links.map((link) => {
              const on = link === active;
              return (
                <li key={`${link.to}#${link.hash ?? ""}`}>
                  <Link
                    to={link.to}
                    hash={link.hash}
                    activeOptions={{ exact: true, includeHash: true }}
                    activeProps={{}}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "-ml-2.5 flex items-center rounded-md px-2.5 py-[5px] no-underline transition-colors",
                      on
                        ? "bg-sb-accent-soft font-medium text-sb-accent-text"
                        : "text-sb-text-muted hover:bg-sb-accent-soft/50 hover:text-sb-text",
                    )}
                  >
                    {link.method ? <Method method={link.method} /> : null}
                    <span>{link.label}</span>
                    {link.count === "vendors" && vendors !== null ? (
                      <span className="ml-auto pl-2 text-xs tabular-nums">
                        {vendors}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
