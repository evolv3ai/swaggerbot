/**
 * The shell's destinations, in order. Each screen's issue adds its own line
 * (Slice 6 backlog, wave 2): one line per screen, so parallel PRs conflict
 * here only mechanically.
 */
export type NavItem = { to: string; label: string };

export const NAV: NavItem[] = [{ to: "/", label: "Search" }];
