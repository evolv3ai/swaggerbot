import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ProvenanceMark } from "~/components/darkroom/provenance-mark";
import { VerifiedStamp } from "~/components/darkroom/stamp";
import type { IndexStats } from "~/server/index-stats";
import { lookupHref } from "~/server/lookup-search";
import { BotMark } from "./bot-mark";
import { HealthLamp } from "./health-lamp";
import { NAV } from "./nav";

const REPO = "https://github.com/evolv3ai/swaggerbot";

/**
 * The frame around every page but `/embed/…`: the rail (the mark, the nav,
 * the last print) beside the page on wide screens, a bar above it on narrow
 * ones.
 */
export function Shell({
  facts,
  children,
}: {
  facts: IndexStats | null;
  children: ReactNode;
}) {
  const last = facts?.recent[0];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a
        href="#content"
        className="sr-only z-50 rounded-[3px] bg-ink no-underline px-4 py-2 font-caps uppercase tracking-wider text-bay focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-rule bg-bay-deep px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-8 lg:border-r lg:border-b-0 lg:px-5 lg:py-7">
        <Link
          to="/"
          className="flex items-center gap-3 no-underline"
          aria-label="SwaggerBot home"
        >
          <BotMark className="size-9 shrink-0" />
          <span className="font-caps text-2xl font-bold uppercase leading-none tracking-wide">
            SwaggerBot
          </span>
        </Link>
        <nav aria-label="Main" className="lg:-mx-1">
          <ul className="flex gap-2 lg:flex-col">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  className="block rounded-[3px] border border-transparent px-3 py-1.5 font-caps text-base font-semibold uppercase tracking-[0.14em] no-underline hover:border-rule data-[status=active]:border-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {last ? (
          <section
            aria-labelledby="last-print"
            className="hidden border-t border-rule pt-5 text-sm lg:grid lg:gap-2"
          >
            <h2
              id="last-print"
              className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-ink-2"
            >
              Last verified
            </h2>
            <p className="font-caps text-lg font-semibold uppercase leading-tight">
              <a href={lookupHref(last.lookupName)}>{last.apiName}</a>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              {last.provenance ? (
                <ProvenanceMark provenance={last.provenance} />
              ) : null}
              <VerifiedStamp
                verifiedAt={last.verifiedAt}
                stale={last.stale}
                on="bay"
              />
            </p>
          </section>
        ) : null}
        {facts ? (
          <section
            aria-labelledby="index-counts"
            className="hidden border-t border-rule pt-5 lg:grid lg:gap-3"
          >
            <h2
              id="index-counts"
              className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-ink-2"
            >
              In the Index
            </h2>
            <dl className="grid gap-3">
              {(
                [
                  ["Vendors", facts.vendors],
                  ["APIs", facts.apis],
                  ["Specs", facts.specs],
                ] as const
              ).map(([label, n]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="font-caps text-sm font-semibold uppercase tracking-[0.14em]">
                    {label}
                  </dt>
                  <dd className="font-segment text-2xl leading-none">{n}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        <HealthLamp className="lg:mt-auto" />
      </header>
      <div className="flex min-w-0 flex-col">
        <main id="content" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule px-4 py-4 text-sm text-ink-2 sm:px-8">
          <span>SwaggerBot · swaggerbot.dev</span>
          <a href={REPO} className="text-ink">
            Source on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
