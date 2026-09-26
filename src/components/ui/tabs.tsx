import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "~/lib/utils";

export type Tab = { id: string; label: string; content: ReactNode };

/**
 * The design system's Tabs (components/navigation/Tabs), as the WAI-ARIA
 * tabs pattern: one tab in the Tab order, the arrow keys (and Home, End)
 * move between tabs and show each one's panel. Without script the first
 * panel shows.
 */
export function Tabs({
  tabs,
  label,
  className,
  listClassName,
}: {
  tabs: Tab[];
  /** The tab list's accessible name. */
  label: string;
  className?: string;
  listClassName?: string;
}) {
  const base = useId();
  const [selected, setSelected] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const next = (to + tabs.length) % tabs.length;
    setSelected(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(selected + 1),
      ArrowLeft: () => move(selected - 1),
      Home: () => move(0),
      End: () => move(tabs.length - 1),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };
  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className={cn("flex gap-5 px-4", listClassName)}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-${tab.id}-tab`}
            aria-selected={i === selected}
            aria-controls={`${base}-${tab.id}-panel`}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)}
            onKeyDown={onKeyDown}
            className="relative py-2.5 text-[13px] font-medium text-sb-text-muted transition-colors hover:text-sb-text aria-selected:text-sb-text aria-selected:shadow-[inset_0_-2px_var(--sb-accent)] focus-visible:outline-offset-[-2px]"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-${tab.id}-panel`}
          aria-labelledby={`${base}-${tab.id}-tab`}
          hidden={i !== selected}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
