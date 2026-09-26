import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

/**
 * Search: the name of an API (with an optional API Version and "Include
 * Community Specs"), sent as a GET to `/lookup`, so it works without
 * script. The Lookup box: the one blue-outlined card of the view. On `/`,
 * and on the Lookup views that ask for another name, with the name already
 * in the field. `children` follow the form inside the box (the Try chips,
 * on `/`).
 */
export function SearchForm({
  name,
  onType,
  onSubmit,
  children,
  className,
}: {
  name?: string;
  onType?: () => void;
  onSubmit?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <search aria-label="Look up an API" className={cn("block", className)}>
      <Card variant="outline" className="grid gap-3 p-4 sm:p-[18px]">
        <form
          action="/lookup"
          method="get"
          className="grid gap-3"
          onInput={onType}
          onSubmit={onSubmit}
        >
          <label htmlFor={`${id}-name`} className="sr-only">
            The name of an API
          </label>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Input
              id={`${id}-name`}
              name="name"
              defaultValue={name}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="Stripe, Jira Cloud, Val Town…"
              className="h-12 px-3.5 text-base sm:flex-1"
            />
            <button
              type="submit"
              className={cn(buttonClass({ size: "lg" }), "h-12 px-[18px]")}
            >
              Look up
            </button>
          </div>
          <div className="flex flex-wrap items-start gap-x-5 gap-y-2 text-[13px] text-sb-text-muted">
            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm hover:text-sb-text [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 transition-transform duration-150 group-open:rotate-90"
                />
                API Version (optional)
              </summary>
              <div className="mt-2">
                <label htmlFor={`${id}-version`} className="sr-only">
                  API Version{" "}
                  <span className="text-sb-text-muted">(optional)</span>
                </label>
                <Input
                  id={`${id}-version`}
                  name="apiVersion"
                  autoComplete="off"
                  placeholder="v3, 2024-06-20…"
                  className="w-56"
                />
              </div>
            </details>
            <label className="flex cursor-pointer items-center gap-2 hover:text-sb-text">
              <input
                type="checkbox"
                name="allowCommunity"
                value="1"
                className="size-4 rounded-[4px] accent-[var(--sb-accent)]"
              />
              Include Community Specs
            </label>
          </div>
        </form>
        {children}
      </Card>
    </search>
  );
}
