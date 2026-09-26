/**
 * The docs shell's sidebar: its groups and links, in order. Each link is a
 * path and, for a section of a page, its anchor (an `id` that exists on that
 * page: `/`'s sections, `/docs`'s sections and route examples). HTTP API
 * links carry their method tag. A screen's issue adds its own line.
 */
export type NavLink = {
  to: string;
  hash?: string;
  label: string;
  method?: "GET" | "POST";
  /** Shows the Index's live Vendor count after the label. */
  count?: "vendors";
};

export type NavGroup = { title: string; links: NavLink[] };

export const NAV: NavGroup[] = [
  {
    title: "Get started",
    links: [
      { to: "/", label: "Look up an API" },
      { to: "/", hash: "what-you-get-back", label: "What you get back" },
      { to: "/", hash: "answers", label: "How answers work" },
    ],
  },
  {
    title: "The Index",
    links: [
      { to: "/vendors", label: "Vendors", count: "vendors" },
      { to: "/", hash: "benchmark", label: "Benchmark" },
    ],
  },
  {
    title: "HTTP API",
    links: [
      { to: "/docs", hash: "lookup", label: "/api/lookup", method: "POST" },
      { to: "/docs", hash: "vendors", label: "/api/vendors", method: "GET" },
      { to: "/docs", hash: "outline", label: "…/outline", method: "GET" },
      {
        to: "/docs",
        hash: "published",
        label: "/api/specs/{id}",
        method: "GET",
      },
    ],
  },
  {
    title: "MCP",
    links: [
      { to: "/docs", hash: "mcp-add", label: "Add to Claude Code" },
      { to: "/docs", hash: "tools", label: "Tools" },
      { to: "/docs", hash: "access", label: "Keys and limits" },
    ],
  },
];

/**
 * The link the sidebar marks as the current page: of the links to this
 * path (or, for a nested page, its section), the one whose anchor is the
 * location's; else the one without an anchor.
 */
export function activeLink(
  pathname: string,
  hash: string,
  links: NavLink[] = NAV.flatMap((g) => g.links),
): NavLink | undefined {
  const onPath = links.filter(
    (l) =>
      pathname === l.to || (l.to !== "/" && pathname.startsWith(`${l.to}/`)),
  );
  const anchor = hash.replace(/^#/, "");
  return (
    (anchor ? onPath.find((l) => l.hash === anchor) : undefined) ??
    onPath.find((l) => !l.hash)
  );
}
