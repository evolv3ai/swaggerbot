import { useEffect, useRef } from "react";
import { cn } from "~/lib/utils";
import type { ShellAccount } from "~/server/account";
import { TOP_LINK } from "./nav";

/** Where "Sign in" goes: AuthKit's sign-in, back to `returnTo` after. */
export function signInHref(returnTo: string): string {
  return `/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}

export const SIGN_OUT_HREF = "/auth/sign-out";
/** The signed-in person's key page (`/keys`, Slice 7 #3). */
export const YOUR_KEY_HREF = "/keys";

/** The first letter of `name`, as the account button shows it. */
export function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

const MENU_ITEM =
  "flex items-center rounded-md px-3 py-2 text-sm text-sb-text no-underline transition-colors hover:bg-sb-accent-soft pointer-coarse:min-h-11";

/**
 * Sign-in in the top bar: nothing when it is off; "Sign in" (a link, back
 * to this page after) when no one is signed in; the signed-in person's
 * initial, which opens a menu with "Your key" and "Sign out". The menu is a
 * disclosure, so it opens before script runs; Escape or a click elsewhere
 * closes it.
 */
export function AccountMenu({
  account,
  returnTo,
  className,
}: {
  account: ShellAccount;
  returnTo: string;
  className?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (focus: boolean) => {
      const el = menu.current;
      if (!el?.open) return;
      el.open = false;
      if (focus) el.querySelector("summary")?.focus();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  if (account.signIn === "off") return null;
  if (account.signIn === "signed-out") {
    return (
      <a href={signInHref(returnTo)} className={cn(TOP_LINK, className)}>
        Sign in
      </a>
    );
  }
  return (
    <details ref={menu} className={cn("relative", className)}>
      <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-full bg-sb-accent-soft font-display text-sm font-bold text-sb-accent-soft-text transition-colors hover:text-sb-text pointer-coarse:size-11 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true">{initialOf(account.name)}</span>
        <span className="sr-only">Your account</span>
      </summary>
      <div className="absolute top-full right-0 z-50 mt-2 w-60 rounded-[12px] border border-sb-border bg-sb-surface-raised p-1.5 shadow-[var(--sb-shadow-md)]">
        <p className="border-b border-sb-border-strong px-3 pt-1.5 pb-2.5 text-[13px] text-sb-text-muted">
          Signed in as{" "}
          <span className="block truncate font-medium text-sb-text">
            {account.email}
          </span>
        </p>
        <ul className="mt-1.5 grid gap-0.5">
          <li>
            <a href={YOUR_KEY_HREF} className={MENU_ITEM}>
              Your key
            </a>
          </li>
          <li>
            <a href={SIGN_OUT_HREF} className={MENU_ITEM}>
              Sign out
            </a>
          </li>
        </ul>
      </div>
    </details>
  );
}

/**
 * The same, as links in the menu drawer, for phones, where the top bar has
 * no room for them.
 */
export function AccountLinks({
  account,
  returnTo,
  className,
}: {
  account: ShellAccount;
  returnTo: string;
  className?: string;
}) {
  if (account.signIn === "off") return null;
  const link = cn(TOP_LINK, "w-fit pointer-coarse:py-3");
  if (account.signIn === "signed-out") {
    return (
      <a href={signInHref(returnTo)} className={cn(link, className)}>
        Sign in
      </a>
    );
  }
  return (
    <div className={cn("grid gap-3", className)}>
      <p className="truncate text-[13px] text-sb-text-muted">
        Signed in as{" "}
        <span className="font-medium text-sb-text">{account.email}</span>
      </p>
      <a href={YOUR_KEY_HREF} className={link}>
        Your key
      </a>
      <a href={SIGN_OUT_HREF} className={link}>
        Sign out
      </a>
    </div>
  );
}
