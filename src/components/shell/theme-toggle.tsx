import { Moon, Sun } from "lucide-react";
import { cn } from "~/lib/utils";
import { currentTheme, setTheme } from "./theme";

/**
 * Switches between the dark theme (the default) and the light one. Which
 * icon and name show is decided by CSS from the theme attribute, so the
 * server's markup is right for either theme before script runs.
 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => setTheme(currentTheme() === "dark" ? "light" : "dark")}
      className={cn(
        "inline-grid size-9 place-items-center rounded-md text-sb-text-muted transition-colors hover:bg-sb-accent-soft hover:text-sb-text [&_svg]:size-[18px]",
        className,
      )}
    >
      <span className="hidden dark:contents">
        <Sun aria-hidden="true" />
        <span className="sr-only">Use the light theme</span>
      </span>
      <span className="contents dark:hidden">
        <Moon aria-hidden="true" />
        <span className="sr-only">Use the dark theme</span>
      </span>
    </button>
  );
}
