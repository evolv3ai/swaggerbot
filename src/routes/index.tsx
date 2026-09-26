import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { MCP_ADD } from "~/components/docs/reference";
import { SearchForm } from "~/components/search/search-form";
import { BENCHMARK } from "~/components/shell/benchmark";
import { WithOnThisPage } from "~/components/shell/on-this-page";
import { ANSWERS, AnswerBadge } from "~/components/ui/answer-badge";
import { Badge } from "~/components/ui/badge";
import { buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { CodeBlock, SpecDownloadCurl } from "~/components/ui/code-block";
import { Tabs } from "~/components/ui/tabs";
import { sizeOf } from "~/components/viewer/size";
import type { OutcomeKind } from "~/domain/outcome";
import { dayOf } from "~/lib/dates";
import type { IndexStats, RecentApi } from "~/server/index-stats";
import { lookupHref } from "~/server/lookup-search";

export const Route = createFileRoute("/")({
  component: Search,
});

const H2 =
  "mt-10 mb-3.5 scroll-mt-20 font-display text-xl font-bold tracking-[-0.01em] text-sb-text";

/** What each answer means (CONTEXT.md's Outcomes, in the page's words). */
const MEANING: Record<OutcomeKind, string> = {
  Resolved:
    "The name is one API, and its Spec is confirmed to describe it. With Provenance and Sources.",
  Unconfirmed:
    "The API and a Spec were found, but not confirmed as this API's. The Spec comes with the reasons for doubt.",
  Ambiguous:
    "The name could mean more than one API. You get the candidates to pick from.",
  NoSpec: "The API is known, but no Spec exists at a Provenance you allowed.",
  Unknown: "The name can't be matched to any API.",
};

/**
 * Search, the front door: a docs page that answers. The Lookup box, then a
 * real answer from the Index, the five answers, and the way in for agents
 * and programs. Every figure is live from the Index or the dated Benchmark.
 */
function Search() {
  const facts = useLoaderData({ from: "__root__" });
  const example = facts?.recent[0];
  return (
    <WithOnThisPage first={{ id: "look-up", label: "Look up an API" }}>
      <div className="max-w-[860px] px-4 pt-7 pb-16 sm:px-8 lg:px-14 lg:pt-11">
        <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-sb-accent-text">
          Better than Specs
        </p>
        <h1
          id="look-up"
          className="mt-2 mb-2.5 scroll-mt-20 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.01em] text-sb-text sm:text-[40px]"
        >
          No fake Specs.
        </h1>
        <p className="max-w-[40em] text-[17px] text-sb-text-muted">
          Name an API. SwaggerBot hands you its OpenAPI Spec, where it came from
          and how sure it is, or tells you straight why there isn't one.
        </p>
        <SearchForm className="mt-[26px]">
          <TryRow facts={facts} />
        </SearchForm>

        {example ? (
          <section aria-labelledby="what-you-get-back">
            <h2 id="what-you-get-back" className={H2}>
              What you get back
            </h2>
            <ResolvedExample api={example} />
          </section>
        ) : null}

        <section aria-labelledby="answers">
          <h2 id="answers" className={H2}>
            Every answer is one of five
          </h2>
          <p className="mb-4 max-w-[40em] text-sb-text-muted">
            Precision over coverage: when SwaggerBot isn't sure, it says so as
            plainly as when it is.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ANSWERS.map((a) => (
              <li key={a.outcome}>
                <Card className="h-full rounded-[12px] p-4">
                  <AnswerBadge outcome={a.outcome} />
                  <p className="mt-2.5 text-[13.5px] leading-normal text-sb-text-muted">
                    {MEANING[a.outcome]}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="use-it-from-code">
          <h2 id="use-it-from-code" className={H2}>
            Use it from code
          </h2>
          <Card className="grid gap-4 rounded-[12px] p-5">
            <p className="max-w-[40em]">
              For agents and programs: the same answers over MCP and the HTTP
              API. From the Index, anyone. Past it, Discovery, with an API key.
            </p>
            <CodeBlock code={MCP_ADD} className="overflow-hidden rounded-md" />
            <p className="flex flex-wrap gap-3">
              <Link
                to="/docs"
                className={buttonClass({ variant: "secondary", size: "md" })}
              >
                Read the docs
              </Link>
              <Link
                to="/docs"
                hash="keys"
                className={buttonClass({ variant: "ghost", size: "md" })}
              >
                Request a key
              </Link>
            </p>
          </Card>
        </section>

        <section aria-labelledby="benchmark">
          <h2 id="benchmark" className={H2}>
            Benchmark
          </h2>
          <p className="max-w-[40em] text-sb-text-muted">
            On {dayOf(`${BENCHMARK.date}T12:00:00Z`)}:{" "}
            <strong className="font-semibold text-sb-text">
              {BENCHMARK.wrong} wrong of {BENCHMARK.resolved} Resolved answers
            </strong>
            , on {BENCHMARK.runs} runs over the {BENCHMARK.names}-name set,
            after two label corrections.
            {facts
              ? ` The Index now holds ${count(facts.vendors, "Vendor")}, ${count(facts.apis, "API")} and ${count(facts.specs, "Spec")}.`
              : null}{" "}
            <a href={BENCHMARK.href} className="text-sb-accent-text">
              How it was measured
            </a>
          </p>
        </section>
      </div>
    </WithOnThisPage>
  );
}

/** The Try chips (the Index's most recently verified APIs) and the count. */
function TryRow({ facts }: { facts: IndexStats | null }) {
  if (!facts) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-sb-text-muted">
      {facts.recent.length > 0 ? (
        <>
          <span id="try-label">Try</span>
          <ul aria-labelledby="try-label" className="contents">
            {facts.recent.map((p) => (
              <li key={p.apiId}>
                <a
                  href={lookupHref(p.lookupName)}
                  className="inline-block rounded-full border border-sb-border px-2.5 py-[3px] text-sb-text no-underline transition-colors hover:border-sb-accent hover:text-sb-accent-text"
                >
                  {chipName(p.apiName)}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Link
        to="/vendors"
        search={{ query: undefined, cursor: undefined }}
        className="inline-flex items-center gap-1 text-sb-text"
      >
        {facts.apis} APIs answer without a key
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

/** `21 Vendors`, `1 API`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** An API's name, short, for a chip: `The Plaid API` → `Plaid`. */
function chipName(apiName: string): string {
  return apiName.replace(/^the\s+/i, "").replace(/\s+API$/i, "") || apiName;
}

/** `3.0.0` → `OpenAPI 3.0.0`; `2.0` → `Swagger 2.0`. */
function specName(version: string): string {
  return version.startsWith("2") ? `Swagger ${version}` : `OpenAPI ${version}`;
}

/**
 * A real Resolved answer from the Index (the API it verified most
 * recently), as a Lookup gives it, with the three ways to take it: curl,
 * MCP, and the JSON (trimmed).
 */
function ResolvedExample({ api }: { api: RecentApi }) {
  const spec = api.spec;
  const size = spec ? sizeOf(spec.byteLength) : null;
  const tabs = spec
    ? [
        {
          id: "curl",
          label: "curl",
          content: (
            <SpecDownloadCurl
              url={spec.downloads.published}
              format={spec.format}
            />
          ),
        },
        {
          id: "mcp",
          label: "MCP",
          content: (
            <CodeBlock code={MCP_ADD}>
              <span className="text-[#8fbaff]">claude</span>
              {MCP_ADD.slice("claude".length)}
            </CodeBlock>
          ),
        },
        {
          id: "json",
          label: "JSON",
          content: (
            <>
              <CodeBlock code={answerJson(api)} />
              <p className="border-t border-sb-border px-4 py-2.5 text-[13px] text-sb-text-muted">
                Trimmed: the whole answer also carries the Sources, any
                Alternate Specs and the Validity Issues.
              </p>
            </>
          ),
        },
      ]
    : [];
  return (
    <Card className="overflow-hidden rounded-[12px]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-sb-border px-4 py-3.5">
        <h3 className="font-semibold">
          <a href={lookupHref(api.lookupName)} className="text-sb-text">
            {api.apiName}
          </a>
        </h3>
        <AnswerBadge outcome="Resolved" />
        {api.provenance ? (
          <Badge tone="neutral">
            <span className="sr-only">Provenance: </span>
            {api.provenance}
          </Badge>
        ) : null}
        <span className="text-[13px] text-sb-text-muted sm:ml-auto">
          answered in {api.ms.toFixed(1)} ms
        </span>
      </div>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3.5 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
        <dt className="text-sb-text-muted">Vendor</dt>
        <dd>{api.vendorDomain ?? api.vendorName}</dd>
        <dt className="text-sb-text-muted">Verified</dt>
        <dd>
          {api.verifiedAt ? (
            <time dateTime={api.verifiedAt}>{dayOf(api.verifiedAt)}</time>
          ) : (
            "Not verified"
          )}
          {api.stale ? (
            <span className="text-sb-text-muted">
              {" "}
              · Stale: a Lookup queues a new Verification
            </span>
          ) : null}
        </dd>
        {spec && size ? (
          <>
            <dt className="text-sb-text-muted">Spec</dt>
            <dd>
              {specName(spec.specVersion)} · {spec.format.toUpperCase()} ·{" "}
              {size.value} {size.unit}
            </dd>
          </>
        ) : null}
      </dl>
      {tabs.length ? (
        <Tabs
          label={`Take the ${api.apiName} Spec`}
          tabs={tabs}
          listClassName="border-t border-sb-border"
        />
      ) : null}
    </Card>
  );
}

/** The answer's JSON, trimmed to what the card shows. */
function answerJson(api: RecentApi): string {
  const answer = {
    outcome: "Resolved",
    api: { id: api.apiId, name: api.apiName },
    vendor: { name: api.vendorName, domain: api.vendorDomain },
    currentSpec: api.spec
      ? {
          id: api.specId,
          specVersion: api.spec.specVersion,
          format: api.spec.format,
          byteLength: api.spec.byteLength,
          downloads: api.spec.downloads,
        }
      : { id: api.specId },
    provenance: api.provenance,
    verifiedAt: api.verifiedAt,
  };
  return JSON.stringify(answer, null, 2);
}
