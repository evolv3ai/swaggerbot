import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { buttonClass } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { ShellAccount } from "~/server/account";
import type { IndexStats } from "~/server/index-stats";
import { AccountLinks, AccountMenu } from "./account";
import { REPO } from "./benchmark";
import { HealthStatus } from "./health-status";
import { TOP_LINK } from "./nav";
import { QuickLookup, useQuickLookupKeys } from "./quick-lookup";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

/**
 * The mark (as supplied, never redrawn) and the wordmark in Montserrat 800.
 * `wordmarkClassName` lets the top bar drop the wordmark on the narrowest
 * phones; the link's name stays "SwaggerBot home".
 */
function Home({
  className,
  wordmarkClassName,
}: {
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <Link
      to="/"
      aria-label="SwaggerBot home"
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-sm font-display text-lg font-extrabold text-sb-text no-underline pointer-coarse:min-h-11",
        className,
      )}
    >
      <img
        src="/brand/mark-64.png"
        alt=""
        width={30}
        height={30}
        className="block size-[30px]"
      />
      <span className={wordmarkClassName}>SwaggerBot</span>
    </Link>
  );
}

/**
 * The frame around every page but `/embed/…`, a docs shell: the sticky top
 * bar (home, the Quick Lookup, Vendors, GitHub, the service's status, the
 * theme, "Get an API key"), the sidebar on wide screens (a drawer behind
 * the menu button on narrow ones), the page, and the footer. With sign-in
 * on, the top bar also offers "Sign in" or the signed-in person's menu
 * (from `sm`; in the drawer below it). Pages opt into
 * the "On this page" rail themselves (`WithOnThisPage`).
 */
export function Shell({
  facts,
  account,
  children,
}: {
  facts: IndexStats | null;
  account: ShellAccount;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const openMenu = useCallback(() => setMenu(true), []);
  const closeMenu = useCallback(() => {
    setMenu(false);
    menuButton.current?.focus();
  }, []);
  useQuickLookupKeys(openMenu);

  // A link followed from the drawer closes it.
  const where = useRouterState({
    select: (s) => `${s.location.pathname}#${s.location.hash}`,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on a change of location
  useEffect(() => setMenu(false), [where]);
  // Where "Sign in" comes back to: this page.
  const returnTo = useRouterState({
    select: (s) => `${s.location.pathname}${s.location.searchStr}`,
  });

  const vendors = facts?.vendors ?? null;
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only z-[60] rounded-md bg-sb-accent px-4 py-2 font-semibold text-sb-text-on-accent no-underline focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-sb-border bg-[color-mix(in_srgb,var(--sb-bg)_85%,transparent)] backdrop-blur-[8px]">
        {/* On phones the bar holds the mark, "Get an API key" and the menu:
            the wordmark goes below 360px and the key button says "Get a key"
            below 390px, so the bar never scrolls sideways (320px and up). */}
        <div className="flex h-[60px] items-center gap-3 px-4 sm:gap-4 lg:gap-6 lg:px-6">
          <Home
            className="lg:min-w-[232px]"
            wordmarkClassName="max-[359px]:hidden"
          />
          <QuickLookup className="hidden max-w-[520px] flex-1 md:block" />
          <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:gap-[22px]">
            <Link
              to="/vendors"
              search={{ query: undefined, cursor: undefined }}
              className={cn(TOP_LINK, "hidden lg:inline")}
            >
              Vendors
            </Link>
            <a href={REPO} className={cn(TOP_LINK, "hidden lg:inline")}>
              GitHub
            </a>
            <HealthStatus className="hidden lg:flex" />
            <ThemeToggle className="hidden sm:inline-grid" />
            <AccountMenu
              account={account}
              returnTo={returnTo}
              className="hidden sm:block"
            />
            <Link
              to="/docs"
              hash="keys"
              className={buttonClass({
                size: "sm",
                className: "h-9 px-3 pointer-coarse:h-11",
              })}
            >
              <span className="max-[389px]:hidden">Get an API key</span>
              <span className="min-[390px]:hidden">Get a key</span>
            </Link>
            <button
              ref={menuButton}
              type="button"
              aria-expanded={menu}
              aria-controls="shell-menu"
              onClick={() => setMenu(true)}
              className="inline-grid size-9 place-items-center rounded-md text-sb-text hover:bg-sb-accent-soft pointer-coarse:size-11 lg:hidden"
            >
              <Menu aria-hidden="true" className="size-5" />
              <span className="sr-only">Menu</span>
            </button>
          </div>
        </div>
      </header>
      {menu ? (
        <Drawer
          vendors={vendors}
          account={account}
          returnTo={returnTo}
          onClose={closeMenu}
        />
      ) : null}
      <div className="mx-auto w-full max-w-[1440px] flex-1 lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
        <aside className="hidden border-r border-sb-border lg:block">
          <div className="sticky top-[60px] max-h-[calc(100dvh-60px)] overflow-y-auto px-5 py-[26px]">
            <Sidebar vendors={vendors} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <main
            id="content"
            tabIndex={-1}
            className="flex-1 focus:outline-none"
          >
            {children}
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-sb-border px-4 py-6 text-[13px] text-sb-text-muted sm:px-8 lg:px-14">
      <p className="flex flex-wrap items-center gap-x-6 gap-y-1 pointer-coarse:gap-y-0 [&_a]:pointer-coarse:inline-block [&_a]:pointer-coarse:py-3">
        <span>
          <span className="font-semibold text-sb-text">SwaggerBot</span> ·
          swaggerbot.dev
        </span>
        <a href={REPO} className="text-sb-text">
          Source on GitHub
        </a>
        {/* The Benchmark's figures are said once, on Search. */}
        <a href="/#benchmark" className="text-sb-text">
          Benchmark
        </a>
      </p>
    </footer>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * The sidebar as a modal drawer, below `lg`: with the Quick Lookup, the
 * top bar's links (sign-in's too, below `sm`), the status and the theme. Focus moves into it and stays
 * there; Escape, the close button or the scrim close it, and focus goes
 * back to the menu button.
 */
function Drawer({
  vendors,
  account,
  returnTo,
  onClose,
}: {
  vendors: number | null;
  account: ShellAccount;
  returnTo: string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [
      ...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ].filter((el) => el.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--sb-overlay)]"
      />
      <div
        ref={panel}
        id="shell-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col gap-5 overflow-y-auto border-r border-sb-border bg-sb-bg px-5 pt-3 pb-8 shadow-[var(--sb-shadow-lg)]"
      >
        <div className="flex h-[48px] items-center justify-between">
          <Home />
          <button
            type="button"
            onClick={onClose}
            className="inline-grid size-9 place-items-center rounded-md text-sb-text hover:bg-sb-accent-soft pointer-coarse:size-11"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Close the menu</span>
          </button>
        </div>
        <QuickLookup />
        <Sidebar vendors={vendors} />
        <div className="grid gap-3 border-t border-sb-border pt-5">
          <AccountLinks
            account={account}
            returnTo={returnTo}
            className="sm:hidden"
          />
          <a href={REPO} className={cn(TOP_LINK, "w-fit pointer-coarse:py-3")}>
            GitHub
          </a>
          <HealthStatus />
          <div className="flex items-center gap-2 text-sm text-sb-text-muted">
            <ThemeToggle className="-ml-2" />
            Theme
          </div>
        </div>
      </div>
    </div>
  );
}
