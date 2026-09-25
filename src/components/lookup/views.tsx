import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CertaintyStrip } from "~/components/darkroom/certainty-strip";
import { CodeLine } from "~/components/darkroom/code-line";
import { Print } from "~/components/darkroom/print";
import { ProvenanceMark } from "~/components/darkroom/provenance-mark";
import { VerifiedStamp } from "~/components/darkroom/stamp";
import { type ChainState, Stations } from "~/components/darkroom/stations";
import type { Outcome, OutcomeKind, SpecAnswer } from "~/domain/outcome";
import { cn } from "~/lib/utils";
import type { LookupRequest } from "~/lookup/lookup";
import type { LookupPage } from "~/server/lookup-page";
import { lookupSearchOf } from "~/server/lookup-search";

type Of<K extends OutcomeKind> = Extract<Outcome, { outcome: K }>;
type OutcomePage = Extract<LookupPage, { view: "outcome" }>;

/** Each Outcome's name, as the certainty strip and the glossary say it. */
const OUTCOME_NAME: Record<OutcomeKind, string> = {
  Resolved: "Resolved",
  Unconfirmed: "Unconfirmed",
  Ambiguous: "Ambiguous",
  NoSpec: "No Spec",
  Unknown: "Unknown",
};

/**
 * The test patch beside an Outcome's name: its density on the certainty
 * strip, and its size, are the answer's weight (Resolved the densest and
 * largest, Unknown an empty cell).
 */
const PATCH: Record<OutcomeKind, string> = {
  Resolved: "size-14 bg-strip-5 sm:size-16",
  Unconfirmed: "size-12 bg-strip-4 sm:size-14",
  Ambiguous: "size-10 bg-strip-3 sm:size-12",
  NoSpec: "size-9 bg-strip-2 sm:size-10",
  Unknown: "size-8 border-dashed bg-transparent sm:size-9",
};

const LINK =
  "underline decoration-1 underline-offset-[0.2em] hover:decoration-2";
const LABEL = "font-caps text-sm font-semibold uppercase tracking-[0.14em]";
const H2 = "font-caps text-2xl font-semibold uppercase tracking-wide";

/** The page's title: the view's name and the name looked up. */
export function titleOf(page: LookupPage): string {
  switch (page.view) {
    case "name-required":
      return "Name an API";
    case "rate-limited":
      return `Too many requests: ${page.request.name}`;
    case "not-in-index":
      return `Not in the Index: ${page.request.name}`;
    case "outcome":
      return `${OUTCOME_NAME[page.outcome.outcome]}: ${page.request.name}`;
  }
}

/** The Lookup result: one view for each Outcome, and for each refusal. */
export function LookupView({ page }: { page: LookupPage }) {
  switch (page.view) {
    case "name-required":
      return <NameRequired />;
    case "rate-limited":
      return <RateLimited page={page} />;
    case "not-in-index":
      return <NotInIndex page={page} />;
    case "outcome":
      return <OutcomeView page={page} />;
  }
}

function OutcomeView({ page }: { page: OutcomePage }) {
  const { outcome } = page;
  switch (outcome.outcome) {
    case "Resolved":
      return <ResolvedView page={page} outcome={outcome} />;
    case "Unconfirmed":
      return <UnconfirmedView page={page} outcome={outcome} />;
    case "Ambiguous":
      return <AmbiguousView page={page} outcome={outcome} />;
    case "NoSpec":
      return <NoSpecView page={page} outcome={outcome} />;
    case "Unknown":
      return <UnknownView page={page} outcome={outcome} />;
  }
}

/**
 * Every view's frame: what was asked, the heading (the Outcome's name in
 * grease pencil, beside its test patch), one lead sentence and, for an
 * Outcome, where it sits on the certainty strip. `aside` is the print, when
 * there is one; the rest follows below.
 */
function Frame({
  request,
  heading,
  kind,
  lead,
  aside,
  chain,
  diagnostics,
  children,
}: {
  request?: LookupRequest;
  heading: string;
  kind?: OutcomeKind;
  lead: ReactNode;
  aside?: ReactNode;
  chain?: ChainState;
  diagnostics?: string[];
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-10 px-4 pt-8 pb-12 sm:px-8 lg:gap-14 lg:pt-12">
      <section aria-labelledby="outcome" className="grid gap-6">
        {request ? <Asked request={request} /> : null}
        <div className="flex items-center gap-4 sm:gap-6">
          {kind ? (
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0 rounded-[2px] border border-ink",
                PATCH[kind],
              )}
            />
          ) : null}
          {/* A little under Search's minimum, so "Unconfirmed" fits at 390. */}
          <h1
            id="outcome"
            className="min-w-0 font-pencil text-[clamp(2.5rem,8.5vw,6rem)] uppercase leading-[0.95] [overflow-wrap:anywhere]"
          >
            {heading}
          </h1>
        </div>
        <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
          <div className="grid gap-6">
            <p className="max-w-[34rem] text-lg leading-relaxed text-ink-2 sm:text-xl">
              {lead}
            </p>
            {kind ? (
              <CertaintyStrip outcome={kind} className="max-w-[40rem]" />
            ) : null}
          </div>
          {aside}
        </div>
      </section>
      {children}
      {diagnostics?.length ? <Diagnostics diagnostics={diagnostics} /> : null}
      {chain ? (
        <section aria-labelledby="chain" className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="chain" className={H2}>
              How it was answered
            </h2>
            <p className="text-sm text-ink-2">
              {chain === "missed"
                ? "The Index didn't know the name. Past it, Discovery needs an API key."
                : "From the Index, with no key: no later station was needed."}
            </p>
          </div>
          <Stations state={chain} />
        </section>
      ) : null}
      <p className="text-sm">
        <Link to="/" className={LINK}>
          Look up another API
        </Link>
      </p>
    </div>
  );
}

/** What was looked up: the name, and the options that were sent. */
function Asked({ request }: { request: LookupRequest }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ink-2">
      <span className={LABEL}>Lookup</span>
      <span className="font-mono text-sm text-ink [overflow-wrap:anywhere]">
        {request.name}
      </span>
      {request.apiVersion ? (
        <span className="text-sm">
          API Version{" "}
          <span className="font-mono text-ink">{request.apiVersion}</span>
        </span>
      ) : null}
      {request.allowCommunity ? (
        <span className="text-sm">Community Specs included</span>
      ) : null}
    </p>
  );
}

// ---------------------------------------------------------------- Outcomes

function ResolvedView({
  page,
  outcome,
}: {
  page: OutcomePage;
  outcome: Of<"Resolved">;
}) {
  const { api, vendor, currentSpec } = outcome;
  return (
    <Frame
      request={page.request}
      heading="Resolved"
      kind="Resolved"
      lead={
        <>
          {api.name}, by {vendor.name}: its Current Spec, verified from its
          Sources, with where it came from.
        </>
      }
      aside={
        <Print
          headingLevel="h2"
          print={{
            apiId: api.id,
            apiName: api.name,
            vendorName: vendor.name,
            specId: currentSpec.id,
            provenance: outcome.provenance,
            verifiedAt: outcome.verifiedAt,
            stale: page.stale,
            ms: page.ms,
          }}
        />
      }
      chain="answered"
      diagnostics={outcome.diagnostics}
    >
      <section aria-labelledby="current-spec" className="grid gap-4">
        <h2 id="current-spec" className={H2}>
          The Current Spec
        </h2>
        <SpecFacts
          api={outcome.api}
          vendor={outcome.vendor}
          spec={currentSpec}
          provenance={<ProvenanceMark provenance={outcome.provenance} />}
          verifiedAt={outcome.verifiedAt}
          stale={page.stale}
          validityIssueCount={outcome.validityIssueCount}
        />
        <SpecActions spec={currentSpec} />
      </section>
      <AlternateSpecs specs={outcome.alternateSpecs} />
      <Sources sources={outcome.sources} />
    </Frame>
  );
}

function UnconfirmedView({
  page,
  outcome,
}: {
  page: OutcomePage;
  outcome: Of<"Unconfirmed">;
}) {
  const { api, vendor, spec } = outcome;
  return (
    <Frame
      request={page.request}
      heading="Unconfirmed"
      kind="Unconfirmed"
      lead={
        <>
          A Spec was found for {api.name}, by {vendor.name}, but it isn't
          confirmed to describe that API.
        </>
      }
      aside={
        // Smaller and quieter than a Resolved print: less certain.
        <Print
          headingLevel="h2"
          className="max-w-sm opacity-90 xl:justify-self-start"
          print={{
            apiId: api.id,
            apiName: api.name,
            vendorName: vendor.name,
            specId: spec.id,
            provenance: null,
            verifiedAt: outcome.verifiedAt,
            stale: page.stale,
            ms: page.ms,
          }}
        />
      }
      chain="answered"
      diagnostics={outcome.diagnostics}
    >
      <section aria-labelledby="reasons" className="grid gap-3">
        <h2 id="reasons" className={H2}>
          Why it isn't confirmed
        </h2>
        <ul className="grid max-w-[40rem] list-disc gap-1.5 pl-5">
          {outcome.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="found-spec" className="grid gap-4">
        <h2 id="found-spec" className={H2}>
          The Spec found
        </h2>
        <SpecFacts
          api={api}
          vendor={vendor}
          spec={spec}
          provenance="None confirmed"
          verifiedAt={outcome.verifiedAt}
          stale={page.stale}
          validityIssueCount={outcome.validityIssueCount}
        />
        <SpecActions spec={spec} />
      </section>
      <Sources sources={outcome.sources} />
    </Frame>
  );
}

function AmbiguousView({
  page,
  outcome,
}: {
  page: OutcomePage;
  outcome: Of<"Ambiguous">;
}) {
  return (
    <Frame
      request={page.request}
      heading="Ambiguous"
      kind="Ambiguous"
      lead={
        <>
          “{page.request.name}” could mean more than one API. Pick the one you
          meant: each looks it up again by its own name.
        </>
      }
      chain="answered"
      diagnostics={outcome.diagnostics}
    >
      <section aria-labelledby="candidates" className="grid gap-4">
        <h2 id="candidates" className={H2}>
          The candidates
        </h2>
        <ol className="grid max-w-[48rem] gap-px overflow-hidden rounded-[3px] border border-rule bg-rule">
          {outcome.candidates.map((candidate) => (
            <li
              key={`${candidate.apiId ?? ""}:${candidate.name}`}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-bay p-4"
            >
              <span className="grid gap-1">
                <Link
                  to="/lookup"
                  search={lookupSearchOf({
                    ...page.request,
                    name: candidate.name,
                  })}
                  className={cn(
                    "font-caps text-lg font-semibold uppercase leading-tight tracking-wide",
                    LINK,
                  )}
                >
                  {candidate.name}
                </Link>
                <span className="flex flex-wrap gap-x-3 text-sm text-ink-2">
                  {candidate.vendor ? <span>{candidate.vendor}</span> : null}
                  {candidate.apiId ? (
                    <span className="font-mono text-xs leading-5 [overflow-wrap:anywhere]">
                      {candidate.apiId}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="sr-only">Likelihood</span>
                <span className="font-segment text-xl leading-none">
                  {Math.round(candidate.probability * 100)}
                </span>
                <span className="font-caps text-sm font-semibold">%</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </Frame>
  );
}

function NoSpecView({
  page,
  outcome,
}: {
  page: OutcomePage;
  outcome: Of<"NoSpec">;
}) {
  const { api, vendor } = outcome;
  const withCommunity =
    outcome.communityAvailable && !page.request.allowCommunity;
  return (
    <Frame
      request={page.request}
      heading="No Spec"
      kind="NoSpec"
      lead={
        <>
          {api.name}, by {vendor.name}, is known, but no Spec of it{" "}
          {page.request.apiVersion ? "at that API Version " : ""}can be given:
          none backed by its Vendor was found.
        </>
      }
      chain="answered"
      diagnostics={outcome.diagnostics}
    >
      <section aria-labelledby="api" className="grid gap-4">
        <h2 id="api" className={H2}>
          The API
        </h2>
        <Facts
          rows={[
            ["API", <ApiName key="api" name={api.name} id={api.id} />],
            ["Vendor", <VendorName key="vendor" vendor={vendor} />],
            [
              "Community Spec",
              outcome.communityAvailable ? "Available" : "None found",
            ],
          ]}
        />
        {withCommunity ? (
          <p className="max-w-[40rem]">
            A Community Spec of it exists: someone other than the Vendor
            publishes it.{" "}
            <Link
              to="/lookup"
              search={lookupSearchOf({ ...page.request, allowCommunity: true })}
              className={LINK}
            >
              Look it up with Community Specs included
            </Link>
          </p>
        ) : null}
      </section>
    </Frame>
  );
}

function UnknownView({
  page,
  outcome,
}: {
  page: OutcomePage;
  outcome: Of<"Unknown">;
}) {
  return (
    <Frame
      request={page.request}
      heading="Unknown"
      kind="Unknown"
      lead={<>No API called “{outcome.name}” was found.</>}
      chain="answered"
      diagnostics={outcome.diagnostics}
    />
  );
}

// ------------------------------------------------------ Not an Outcome

function NotInIndex({
  page,
}: {
  page: Extract<LookupPage, { view: "not-in-index" }>;
}) {
  const { request, baseUrl } = page;
  const body = JSON.stringify({
    name: request.name,
    ...(request.apiVersion ? { apiVersion: request.apiVersion } : {}),
    ...(request.allowCommunity ? { allowCommunity: true } : {}),
  });
  const curl = `curl -X POST ${baseUrl}/api/lookup -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d ${shellQuote(body)}`;
  const mcpAdd = `claude mcp add --transport http swaggerbot ${baseUrl}/mcp --header "Authorization: Bearer <key>"`;
  const mcpCall = `lookup_api ${body}`;
  return (
    <Frame
      request={request}
      heading="Not indexed yet"
      lead={
        <>
          The Index doesn't hold “{request.name}” yet. Finding it on the live
          web is Discovery, which needs an API key, and this page never holds
          one.
        </>
      }
      chain="missed"
    >
      <section aria-labelledby="discovery" className="grid max-w-[48rem] gap-5">
        <div className="grid gap-2">
          <h2 id="discovery" className={H2}>
            Run Discovery with a key
          </h2>
          <p className="max-w-[40rem]">
            Send the same Lookup with your key. Once Discovery has found it, the
            name is in the Index, and this page answers it for anyone.
          </p>
        </div>
        <div className="grid gap-2">
          <h3 className={cn(LABEL, "text-ink-2")}>Over HTTP</h3>
          <CodeLine code={curl} />
        </div>
        <div className="grid gap-2">
          <h3 className={cn(LABEL, "text-ink-2")}>Over MCP</h3>
          <CodeLine code={mcpAdd} />
          <p className="text-sm text-ink-2">Then call the tool:</p>
          <CodeLine code={mcpCall} />
        </div>
        <p>
          No key yet?{" "}
          <a href="/docs#keys" className={LINK}>
            How to get an API key
          </a>
        </p>
      </section>
    </Frame>
  );
}

function RateLimited({
  page,
}: {
  page: Extract<LookupPage, { view: "rate-limited" }>;
}) {
  return (
    <Frame
      request={page.request}
      heading="Slow down"
      lead={
        <>
          This address has sent more requests this minute than the per-IP limit
          allows. Nothing was looked up.
        </>
      }
    >
      <section aria-labelledby="retry" className="grid gap-3">
        <h2 id="retry" className={H2}>
          Try again in
        </h2>
        <p className="flex items-baseline gap-2">
          <span className="font-segment text-4xl leading-none">
            {page.retryAfterSeconds}
          </span>
          <span className={LABEL}>
            {page.retryAfterSeconds === 1 ? "second" : "seconds"}
          </span>
        </p>
        <p>
          <Link
            to="/lookup"
            search={lookupSearchOf(page.request)}
            reloadDocument
            className={LINK}
          >
            Look up “{page.request.name}” again
          </Link>
        </p>
      </section>
    </Frame>
  );
}

function NameRequired() {
  return (
    <Frame
      heading="Name an API"
      lead="A Lookup needs the name of an API, such as Stripe or Jira Cloud."
    />
  );
}

// ------------------------------------------------------------- Pieces

/** The facts of a Spec an Outcome gives, on the bay. */
function SpecFacts({
  api,
  vendor,
  spec,
  provenance,
  verifiedAt,
  stale,
  validityIssueCount,
}: {
  api: Of<"Resolved">["api"];
  vendor: Of<"Resolved">["vendor"];
  spec: SpecAnswer;
  provenance: ReactNode;
  verifiedAt: string;
  stale: boolean;
  validityIssueCount: number;
}) {
  return (
    <Facts
      rows={[
        ["API", <ApiName key="api" name={api.name} id={api.id} />],
        ["Vendor", <VendorName key="vendor" vendor={vendor} />],
        ["Provenance", provenance],
        [
          "Verified",
          <VerifiedStamp
            key="verified"
            verifiedAt={verifiedAt}
            stale={stale}
            on="bay"
          />,
        ],
        ["API Version", spec.apiVersion ?? "Not stated"],
        [
          "Spec",
          <span key="spec" className="grid gap-0.5">
            <span>
              OpenAPI {spec.specVersion}, {spec.format.toUpperCase()}
            </span>
            <span className="font-mono text-xs leading-5 [overflow-wrap:anywhere]">
              {spec.id}
            </span>
          </span>,
        ],
        [
          "Validity Issues",
          validityIssueCount === 0 && spec.normalized === "pending"
            ? "Not checked yet"
            : String(validityIssueCount),
        ],
      ]}
    />
  );
}

/** The Spec viewer and the two downloads, with their sizes. */
function SpecActions({ spec }: { spec: SpecAnswer }) {
  return (
    <div className="grid gap-3">
      <p>
        <a
          href={`/specs/${spec.id}`}
          className={cn(LINK, "font-caps text-lg font-semibold uppercase")}
        >
          Open in the Spec viewer
        </a>
      </p>
      <ul className="grid max-w-[40rem] gap-px overflow-hidden rounded-[3px] border border-rule bg-rule sm:grid-cols-2">
        <li className="grid gap-1 bg-bay p-4">
          <span className={LABEL}>Published Form</span>
          <span className="text-sm text-ink-2">As the Vendor serves it.</span>
          <span className="flex flex-wrap items-baseline gap-x-3">
            <a href={spec.downloads.published} className={LINK}>
              Download<span className="sr-only"> the Published Form</span>
            </a>
            <span className="text-sm text-ink-2">
              {spec.format.toUpperCase()}, <Size bytes={spec.byteLength} />
            </span>
          </span>
        </li>
        <li className="grid gap-1 bg-bay p-4">
          <span className={LABEL}>Normalized Form</span>
          <span className="text-sm text-ink-2">
            One bundled document in the current OpenAPI version.
          </span>
          {spec.normalized === "ready" ? (
            <a href={spec.downloads.normalized} className={LINK}>
              Download<span className="sr-only"> the Normalized Form</span>
            </a>
          ) : spec.normalized === "pending" ? (
            <span>Being built. Reload in a minute.</span>
          ) : (
            <span>Couldn't be built; the Published Form is still usable.</span>
          )}
        </li>
      </ul>
    </div>
  );
}

function AlternateSpecs({ specs }: { specs: SpecAnswer[] }) {
  return (
    <section aria-labelledby="alternates" className="grid gap-4">
      <h2 id="alternates" className={H2}>
        Alternate Specs
      </h2>
      {specs.length === 0 ? (
        <p className="text-ink-2">None: the Current Spec is the only one.</p>
      ) : (
        <ul className="grid max-w-[48rem] gap-px overflow-hidden rounded-[3px] border border-rule bg-rule">
          {specs.map((spec) => (
            <li
              key={spec.id}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 bg-bay p-4"
            >
              <span className="grid gap-0.5">
                <span className="font-caps text-lg font-semibold uppercase leading-tight tracking-wide">
                  API Version {spec.apiVersion ?? "not stated"}
                  {spec.isPreview ? " · Preview" : ""}
                </span>
                <span className="text-sm text-ink-2">
                  OpenAPI {spec.specVersion}, {spec.format.toUpperCase()},{" "}
                  <Size bytes={spec.byteLength} />
                </span>
              </span>
              <span className="flex flex-wrap gap-x-4">
                <a href={`/specs/${spec.id}`} className={LINK}>
                  View
                  <span className="sr-only">
                    {" "}
                    API Version {spec.apiVersion}
                  </span>
                </a>
                <a href={spec.downloads.published} className={LINK}>
                  Download
                  <span className="sr-only">
                    {" "}
                    API Version {spec.apiVersion}
                  </span>
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where a Spec was found: each Source's URL (as text) and Provenance. */
function Sources({ sources }: { sources: Of<"Resolved">["sources"] }) {
  return (
    <section aria-labelledby="sources" className="grid gap-4">
      <h2 id="sources" className={H2}>
        Sources
      </h2>
      <ul className="grid max-w-[48rem] gap-px overflow-hidden rounded-[3px] border border-rule bg-rule">
        {sources.map((source) => (
          <li
            key={source.id}
            className="grid gap-1.5 bg-bay p-4 sm:grid-cols-[auto_1fr] sm:items-baseline sm:gap-x-4"
          >
            <span>
              <ProvenanceMark provenance={source.provenance} />
            </span>
            <span className="grid gap-0.5">
              <span className="font-mono text-sm [overflow-wrap:anywhere]">
                {source.url}
              </span>
              <span className="text-sm text-ink-2">
                Last verified{" "}
                <VerifiedStamp
                  verifiedAt={source.lastVerifiedAt}
                  stale={false}
                  on="bay"
                />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: string[] }) {
  return (
    <section aria-labelledby="diagnostics" className="grid gap-3">
      <h2 id="diagnostics" className={H2}>
        What went wrong along the way
      </h2>
      <ul className="grid max-w-[48rem] list-disc gap-1.5 pl-5 text-sm">
        {diagnostics.map((d) => (
          <li key={d} className="[overflow-wrap:anywhere]">
            {d}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Terms and values, two columns from `sm`. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid max-w-[48rem] gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-caps text-sm font-semibold uppercase tracking-[0.12em] text-ink-2 sm:pt-0.5">
            {term}
          </dt>
          <dd className="mb-2 min-w-0 sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ApiName({ name, id }: { name: string; id: string }) {
  return (
    <span className="grid gap-0.5">
      <span>{name}</span>
      <span className="font-mono text-xs leading-5 [overflow-wrap:anywhere]">
        {id}
      </span>
    </span>
  );
}

function VendorName({ vendor }: { vendor: Of<"Resolved">["vendor"] }) {
  return (
    <span>
      {vendor.name} <span className="text-ink-2">({vendor.domain})</span>
    </span>
  );
}

/** A size in bytes as B, kB or MB (powers of 1000), in seven-segment. */
function Size({ bytes }: { bytes: number }) {
  const [n, unit] =
    bytes < 1000
      ? [String(bytes), "B"]
      : bytes < 1_000_000
        ? [(bytes / 1000).toFixed(1), "kB"]
        : [(bytes / 1_000_000).toFixed(1), "MB"];
  return (
    <span className="whitespace-nowrap">
      <span className="font-segment">{n}</span>{" "}
      <span className="font-caps font-semibold uppercase">{unit}</span>
    </span>
  );
}

/** `text` as one single-quoted shell word. */
function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
