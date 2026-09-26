import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

type Entry = { id: string; label: string };

/**
 * A page with the "On this page" rail (xl and up): the page's own content,
 * and beside it the list of its sections, read from its `h2`s that have an
 * `id` (an `h2` inside `[data-toc-skip]` is left out). `first` is an entry
 * put before them (the page's title, on `/`). The section in view is
 * marked as it scrolls. Pages opt in by rendering their content in it.
 */
export function WithOnThisPage({
  children,
  first,
  className,
}: {
  children: ReactNode;
  first?: Entry;
  className?: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  const firstId = first?.id;
  const firstLabel = first?.label;
  const [entries, setEntries] = useState<Entry[]>(first ? [first] : []);
  const [current, setCurrent] = useState<string | undefined>(first?.id);

  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const headings = [
      ...root.querySelectorAll<HTMLHeadingElement>("h2[id]"),
    ].filter((h) => !h.closest("[data-toc-skip]"));
    const read = headings.map((h) => ({
      id: h.id,
      label: h.textContent?.trim() ?? h.id,
    }));
    setEntries(
      firstId && firstLabel
        ? [{ id: firstId, label: firstLabel }, ...read]
        : read,
    );

    const targets = [
      ...(firstId ? [document.getElementById(firstId)] : []),
      ...headings,
    ].filter((el): el is HTMLElement => el !== null);
    // The current section: the last heading above the top fifth of the view.
    const update = () => {
      const line = window.innerHeight * 0.2;
      let id = targets[0]?.id;
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= line) id = el.id;
      }
      setCurrent(id);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [firstId, firstLabel]);

  return (
    <div
      className={cn(
        "xl:grid xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-4",
        className,
      )}
    >
      <div ref={content} className="min-w-0">
        {children}
      </div>
      {entries.length > 1 ? (
        <nav
          aria-label="On this page"
          className="hidden xl:block"
          data-toc-skip
        >
          <div className="sticky top-[60px] px-5 pt-11 text-[13px]">
            <p className="mb-2.5 font-semibold text-sb-text">On this page</p>
            <ul>
              {entries.map((e) => (
                <li key={e.id}>
                  <a
                    href={`#${e.id}`}
                    aria-current={e.id === current ? "location" : undefined}
                    className="block border-l border-sb-border py-1 pl-3 text-sb-text-muted no-underline transition-colors hover:text-sb-text aria-[current]:border-sb-accent aria-[current]:text-sb-accent-text"
                  >
                    {e.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
