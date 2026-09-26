import { type ReactNode, useId } from "react";

/**
 * Search: the name of an API (with an optional API Version and "Include
 * Community Specs"), sent as a GET to `/lookup`, so it works without
 * script. On `/`, and on the Lookup views that ask for another name, with
 * the name already in the field. `children` follow the form inside the
 * landmark (the certainty strip, on `/`).
 */
export function SearchForm({
  name,
  onType,
  onSubmit,
  children,
}: {
  name?: string;
  onType?: () => void;
  onSubmit?: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <search className="grid max-w-[40rem] gap-5">
      <form
        action="/lookup"
        method="get"
        className="grid gap-3"
        onInput={onType}
        onSubmit={onSubmit}
      >
        <label
          htmlFor={`${id}-name`}
          className="font-caps text-sm font-semibold uppercase tracking-[0.14em]"
        >
          The name of an API
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id={`${id}-name`}
            name="name"
            defaultValue={name}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="Stripe, Jira Cloud, Val Town…"
            className="min-h-12 flex-1 rounded-[3px] border-2 border-ink bg-print px-4 text-lg text-print-ink placeholder:text-print-ink-2"
          />
          <button
            type="submit"
            className="mb-[3px] min-h-[45px] rounded-none border-2 border-[#0e0e0e] bg-lamp px-7 font-caps text-lg font-bold uppercase tracking-[0.14em] text-[#0e0e0e] shadow-[0_3px_0_#0e0e0e] transition-[box-shadow,translate] duration-100 hover:brightness-105 active:translate-y-[3px] active:shadow-none dark:border-[#9a6400] dark:shadow-[0_3px_0_#9a6400] dark:active:shadow-none"
          >
            Develop
          </button>
        </div>
        <details className="group text-sm">
          <summary className="w-fit cursor-pointer font-caps font-semibold uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            Options
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <label
                htmlFor={`${id}-version`}
                className="font-caps font-semibold uppercase tracking-[0.12em]"
              >
                API Version{" "}
                <span className="normal-case text-ink-2">(optional)</span>
              </label>
              <input
                id={`${id}-version`}
                name="apiVersion"
                autoComplete="off"
                placeholder="v3, 2024-06-20…"
                className="min-h-10 rounded-[3px] border border-ink bg-print px-3 text-print-ink placeholder:text-print-ink-2"
              />
            </div>
            <label className="flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                name="allowCommunity"
                value="1"
                className="size-4 accent-[var(--ink)]"
              />
              Include Community Specs
            </label>
          </div>
        </details>
      </form>
      {children}
    </search>
  );
}
