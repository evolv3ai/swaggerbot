import { Download, FileCode } from "lucide-react";
import type { ReactNode } from "react";
import { SearchForm } from "~/components/search/search-form";
import { WithOnThisPage } from "~/components/shell/on-this-page";
import { ANSWERS, AnswerBadge } from "~/components/ui/answer-badge";
import { Badge } from "~/components/ui/badge";
import { buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { CodeBlock } from "~/components/ui/code-block";
import { Tabs } from "~/components/ui/tabs";
import { sizeOf } from "~/components/viewer/size";
import type { Source } from "~/domain/catalog";
import type { Outcome, OutcomeKind, SpecAnswer } from "~/domain/outcome";
import type { Provenance } from "~/domain/provenance";
import { dayOf } from "~/lib/dates";
import { cn } from "~/lib/utils";
import { vendorHref } from "~/lib/vendor-hrefs";
import { distinctDomain } from "~/lib/vendor-name";
import type { LookupRequest } from "~/lookup/lookup";
import type { LookupPage } from "~/server/lookup-page";
import { lookupHref } from "~/server/lookup-search";
import { CopyUrl } from "./copy-url";
import { type Answered, HowAnswered } from "./how-answered";

type Of<K extends OutcomeKind> = Extract<Outcome, { outcome: K }>;
type OutcomePage = Extract<LookupPage, { view: "outcome" }>;
type SpecOutcome = Of<"Resolved"> | Of<"Unconfirmed">;

/** Each Outcome's name, as the glossary says it. */
const OUTCOME_NAME: Record<OutcomeKind, string> = {
  Resolved: "Resolved",
  Unconfirmed: "Unconfirmed",
  Ambiguous: "Ambiguous",
  NoSpec: "No Spec",
  Unknown: "Unknown",
};

const H2 =
  "mb-3.5 scroll-mt-20 font-display text-xl font-bold tracking-[-0.01em] text-sb-text";
const SECTION = "mt-10";
const MUTED = "text-sb-text-muted";

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
 * Every view's page, a docs page in the shell: the eyebrow (what was looked
 * up), the heading (the Outcome's name, with its AnswerBadge and where it
 * sits among the five), one lead line, then the view's sections, with the
 * "On this page" rail when there are several. With `search`, the Search
 * form follows the lead, holding the name asked; without it, the page ends
 * with a link back to Search.
 */
function Page({
  request,
  heading,
  kind,
  lead,
  search = false,
  answered,
  diagnostics,
  children,
}: {
  request?: LookupRequest;
  heading: string;
  kind?: OutcomeKind;
  lead: ReactNode;
  search?: boolean;
  answered?: Answered;
  diagnostics?: string[];
  children?: ReactNode;
}) {
  const place = kind ? ANSWERS.findIndex((a) => a.outcome === kind) + 1 : 0;
  return (
    <WithOnThisPage first={{ id: "outcome", label: heading }}>
      <div className="max-w-[860px] px-4 pt-7 pb-16 sm:px-8 lg:px-14 lg:pt-11">
        <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-sb-accent-text [overflow-wrap:anywhere]">
          Lookup
          {request ? (
            <>
              {" · "}
              {request.name}
            </>
          ) : null}
        </p>
        <div className="mt-2 mb-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <h1
            id="outcome"
            className="scroll-mt-20 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.01em] text-sb-text sm:text-[40px]"
          >
            {heading}
          </h1>
          {kind ? (
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <AnswerBadge outcome={kind} />
              <span className="text-[13px] text-sb-text-muted">
                {place} of 5, from sure to not found
              </span>
            </span>
          ) : null}
        </div>
        <p className="max-w-[40em] text-[17px] text-sb-text-muted">{lead}</p>
        {request?.apiVersion || request?.allowCommunity ? (
          <p className="mt-2 text-[13px] text-sb-text-muted">
            Asked with{" "}
            {[
              request.apiVersion ? `API Version ${request.apiVersion}` : null,
              request.allowCommunity ? "Community Specs included" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {search ? (
          <SearchForm name={request?.name} className="mt-[26px]" />
        ) : null}
        {children}
        {diagnostics?.length ? <Diagnostics diagnostics={diagnostics} /> : null}
        {answered ? <HowAnswered answered={answered} /> : null}
        {/* A view with the Search form doesn't also need a link back to it. */}
        {search ? null : (
          <p className="mt-10 text-sm">
            <a href="/" className="text-sb-accent-text">
              Look up another API
            </a>
          </p>
        )}
      </div>
    </WithOnThisPage>
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
  return (
    <Page
      request={page.request}
      heading="Resolved"
      kind="Resolved"
      lead="The name is one API, and its Spec is confirmed to describe it: here it is, with where it came from."
      answered={{ by: "index", ms: page.ms }}
      diagnostics={outcome.diagnostics}
    >
      <AnswerCard page={page} outcome={outcome} spec={outcome.currentSpec} />
      <SpecDetails
        api={outcome.api}
        spec={outcome.currentSpec}
        validityIssueCount={outcome.validityIssueCount}
        validityIssues={outcome.validityIssues}
      />
      <AlternateSpecs specs={outcome.alternateSpecs} />
      <Sources sources={outcome.sources} />
    </Page>
  );
}

function UnconfirmedView({
  page,
  outcome,
}: {
  page: OutcomePage;
  outcome: Of<"Unconfirmed">;
}) {
  return (
    <Page
      request={page.request}
      heading="Unconfirmed"
      kind="Unconfirmed"
      lead="A Spec was found, but it isn't confirmed to describe this API. Here it is, with the reasons for doubt."
      answered={{ by: "index", ms: page.ms }}
      diagnostics={outcome.diagnostics}
    >
      <section aria-labelledby="reasons" className="mt-8">
        <h2 id="reasons" className={H2}>
          Why it isn't confirmed
        </h2>
        <ul className="grid max-w-[40em] list-disc gap-1.5 pl-5">
          {outcome.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>
      <AnswerCard page={page} outcome={outcome} spec={outcome.spec} />
      <SpecDetails
        api={outcome.api}
        spec={outcome.spec}
        validityIssueCount={outcome.validityIssueCount}
        validityIssues={outcome.validityIssues}
      />
      <Sources sources={outcome.sources} />
    </Page>
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
    <Page
      request={page.request}
      heading="Ambiguous"
      kind="Ambiguous"
      lead={
        <>
          “{page.request.name}” could mean more than one API. Pick the one you
          meant: each looks it up again by its own name.
        </>
      }
      answered={{ by: "index", ms: page.ms }}
      diagnostics={outcome.diagnostics}
    >
      <section aria-labelledby="candidates" className={SECTION}>
        <h2 id="candidates" className={H2}>
          The candidates
        </h2>
        <Card className="overflow-hidden rounded-[12px]">
          <ol className="divide-y divide-sb-border">
            {outcome.candidates.map((candidate) => (
              <li
                key={`${candidate.apiId ?? ""}:${candidate.name}`}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-3.5"
              >
                <span className="grid min-w-0 gap-0.5">
                  <a
                    href={requestHref({
                      ...page.request,
                      name: candidate.name,
                    })}
                    className="font-semibold text-sb-text"
                  >
                    {candidate.name}
                  </a>
                  <span className="flex flex-wrap gap-x-3 text-[13px] text-sb-text-muted">
                    {candidate.vendor ? <span>{candidate.vendor}</span> : null}
                    {candidate.apiId ? (
                      <span className="font-mono text-xs leading-5 [overflow-wrap:anywhere]">
                        {candidate.apiId}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="text-sm text-sb-text-muted tabular-nums">
                  <span className="sr-only">Likelihood </span>
                  {Math.round(candidate.probability * 100)}%
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </Page>
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
    <Page
      request={page.request}
      heading="No Spec"
      kind="NoSpec"
      lead={
        <>
          The API is known, but no Spec of it{" "}
          {page.request.apiVersion ? "at that API Version " : ""}can be given:
          none backed by its Vendor was found.
        </>
      }
      answered={{ by: "index", ms: page.ms }}
      diagnostics={outcome.diagnostics}
    >
      <section aria-labelledby="api" className={SECTION}>
        <h2 id="api" className={H2}>
          The API
        </h2>
        <Card className="rounded-[12px]">
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
        </Card>
        {withCommunity ? (
          <p className="mt-4 max-w-[40em]">
            A Community Spec of it exists: someone other than the Vendor
            publishes it.{" "}
            <a
              href={requestHref({ ...page.request, allowCommunity: true })}
              className="text-sb-accent-text"
            >
              Look it up with Community Specs included
            </a>
          </p>
        ) : null}
      </section>
    </Page>
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
    <Page
      request={page.request}
      heading="Unknown"
      kind="Unknown"
      lead={
        <>
          No API called “{outcome.name}” was found. Check the name, or try
          another.
        </>
      }
      search
      answered={{ by: "index", ms: page.ms }}
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
  const body = requestBody(request);
  const curl = `curl -X POST ${baseUrl}/api/lookup -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d ${shellQuote(body)}`;
  const mcpAdd = `claude mcp add --transport http swaggerbot ${baseUrl}/mcp --header "Authorization: Bearer <key>"`;
  const mcpCall = `lookup_api ${body}`;
  return (
    <Page
      request={request}
      heading="Not in the Index yet"
      lead={
        <>
          The Index doesn't hold “{request.name}” yet. Finding it on the live
          web is Discovery, which needs an API key, and this page never holds
          one.
        </>
      }
      search
      answered={{ by: "missed" }}
    >
      <section aria-labelledby="discovery" className={SECTION}>
        <h2 id="discovery" className={H2}>
          Run Discovery with a key
        </h2>
        <Card className="grid gap-4 rounded-[12px] p-5">
          <p className="max-w-[40em]">
            Send the same Lookup with your key. Once Discovery has found it, the
            name is in the Index, and this page answers it for anyone.
          </p>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Over HTTP</h3>
            <CodeBlock code={curl} className="overflow-hidden rounded-md" />
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Over MCP</h3>
            <CodeBlock code={mcpAdd} className="overflow-hidden rounded-md" />
            <p className={cn("text-[13px]", MUTED)}>Then call the tool:</p>
            <CodeBlock code={mcpCall} className="overflow-hidden rounded-md" />
          </div>
          <p>
            No key yet?{" "}
            <a href="/docs#keys" className="text-sb-accent-text">
              How to get an API key
            </a>
          </p>
        </Card>
      </section>
    </Page>
  );
}

function RateLimited({
  page,
}: {
  page: Extract<LookupPage, { view: "rate-limited" }>;
}) {
  const s = page.retryAfterSeconds;
  return (
    <Page
      request={page.request}
      heading="Slow down"
      lead="This address has sent more requests this minute than the per-IP limit allows. Nothing was looked up."
    >
      <section aria-labelledby="retry" className={SECTION}>
        <h2 id="retry" className={H2}>
          Try again in
        </h2>
        <p className="font-display text-[28px] font-extrabold tabular-nums">
          {s} {s === 1 ? "second" : "seconds"}
        </p>
        <p className="mt-3">
          <a href={requestHref(page.request)} className="text-sb-accent-text">
            Look up “{page.request.name}” again
          </a>
        </p>
      </section>
    </Page>
  );
}

function NameRequired() {
  return (
    <Page
      heading="Name an API"
      lead="A Lookup needs the name of an API, such as Stripe or Jira Cloud."
      search
    />
  );
}

// ------------------------------------------------------------- Pieces

/**
 * The answer, leading with the Spec (like Search's "What you get back"):
 * the API, its answer and Provenance, the Vendor and when it was verified,
 * then the three actions (the Spec viewer, the download, the URL to copy)
 * and the ways to take it from code: curl, MCP, the JSON.
 */
function AnswerCard({
  page,
  outcome,
  spec,
}: {
  page: OutcomePage;
  outcome: SpecOutcome;
  spec: SpecAnswer;
}) {
  const { api, vendor } = outcome;
  const provenance = outcome.outcome === "Resolved" ? outcome.provenance : null;
  const published = absoluteUrl(spec.downloads.published, page.baseUrl);
  const size = sizeOf(spec.byteLength);
  const domain = distinctDomain(vendor.name, vendor.domain);
  const body = requestBody(page.request);
  const tabs = [
    {
      id: "curl",
      label: "curl",
      content: (
        <>
          <CodeBlock code={`curl -o openapi.${spec.format} ${published}`}>
            <span className="text-[#8fbaff]">curl</span> -o openapi.
            {spec.format} {published}
          </CodeBlock>
          <p className="border-t border-sb-border px-4 py-2.5 text-[13px] text-sb-text-muted">
            The whole answer, as JSON:
          </p>
          <CodeBlock
            code={`curl -X POST ${page.baseUrl}/api/lookup -H "Content-Type: application/json" -d ${shellQuote(body)}`}
          />
        </>
      ),
    },
    {
      id: "mcp",
      label: "MCP",
      content: (
        <>
          <CodeBlock
            code={`claude mcp add --transport http swaggerbot ${page.baseUrl}/mcp`}
          >
            <span className="text-[#8fbaff]">claude</span> mcp add --transport
            http swaggerbot {page.baseUrl}/mcp
          </CodeBlock>
          <p className="border-t border-sb-border px-4 py-2.5 text-[13px] text-sb-text-muted">
            Then call the tool; an Index answer needs no key:
          </p>
          <CodeBlock code={`lookup_api ${body}`} />
        </>
      ),
    },
    {
      id: "json",
      label: "JSON",
      content: (
        <>
          <CodeBlock code={answerJson(outcome)} />
          <p className="border-t border-sb-border px-4 py-2.5 text-[13px] text-sb-text-muted">
            Trimmed: the whole answer also lists the Validity Issues, below.
          </p>
        </>
      ),
    },
  ];
  return (
    <section aria-labelledby="spec" className={SECTION}>
      <Card className="overflow-hidden rounded-[12px]">
        <div className="grid gap-1 border-b border-sb-border px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h2 id="spec" className="scroll-mt-20 font-semibold">
              {api.name}
            </h2>
            <AnswerBadge outcome={outcome.outcome} />
            {provenance ? <ProvenanceBadge provenance={provenance} /> : null}
            <span className="text-[13px] text-sb-text-muted sm:ml-auto">
              answered in {page.ms.toFixed(1)} ms
            </span>
          </div>
          <p className="text-[13px] text-sb-text-muted">
            By{" "}
            <a href={vendorHref(vendor.id)} className="text-sb-text">
              {vendor.name}
            </a>
            {domain ? ` (${domain})` : null} · Verified{" "}
            <time dateTime={outcome.verifiedAt}>
              {dayOf(outcome.verifiedAt)}
            </time>
            {page.stale ? " · Stale: a Lookup queues a new Verification" : null}
            {provenance ? null : " · No Provenance confirmed"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-4">
          <a href={`/specs/${spec.id}`} className={buttonClass()}>
            <FileCode aria-hidden="true" />
            Open in the Spec viewer
          </a>
          <a
            href={spec.downloads.published}
            className={buttonClass({ variant: "secondary" })}
          >
            <Download aria-hidden="true" />
            Download
            <span className="font-sans font-medium text-sb-text-muted">
              {spec.format.toUpperCase()} · {size.value} {size.unit}
            </span>
            <span className="sr-only"> the Published Form</span>
          </a>
          <CopyUrl url={published} what="the Published Form" />
        </div>
        <Tabs
          label={`Take the ${api.name} Spec`}
          tabs={tabs}
          listClassName="border-t border-sb-border"
        />
      </Card>
    </section>
  );
}

/**
 * What the answer card doesn't show: the API id, the API Version, the
 * Spec's format and id, its Validity Issues and the Normalized Form.
 */
function SpecDetails({
  api,
  spec,
  validityIssueCount,
  validityIssues,
}: {
  api: SpecOutcome["api"];
  spec: SpecAnswer;
  validityIssueCount: number;
  validityIssues: SpecOutcome["validityIssues"];
}) {
  const unchecked = validityIssueCount === 0 && spec.normalized === "pending";
  return (
    <section aria-labelledby="spec-details" className={SECTION}>
      <h2 id="spec-details" className={H2}>
        Spec details
      </h2>
      <Card className="rounded-[12px]">
        <Facts
          rows={[
            [
              "API id",
              <span key="api" className="font-mono text-[13px]">
                {api.id}
              </span>,
            ],
            ["API Version", spec.apiVersion ?? "Not stated"],
            [
              "Spec",
              <span key="spec" className="grid gap-0.5">
                <span>
                  {specName(spec.specVersion)} · {spec.format.toUpperCase()}
                  {spec.isPreview ? " · Preview" : ""}
                </span>
                <span className="font-mono text-xs leading-5 text-sb-text-muted [overflow-wrap:anywhere]">
                  {spec.id}
                </span>
              </span>,
            ],
            [
              "Validity Issues",
              <ValidityIssues
                key="validity"
                count={validityIssueCount}
                issues={validityIssues}
                unchecked={unchecked}
              />,
            ],
            ["Normalized Form", <NormalizedForm key="normal" spec={spec} />],
          ]}
        />
      </Card>
    </section>
  );
}

function ValidityIssues({
  count,
  issues,
  unchecked,
}: {
  count: number;
  issues: SpecOutcome["validityIssues"];
  unchecked: boolean;
}) {
  if (unchecked) return <span>Not checked yet</span>;
  if (count === 0) return <span>None</span>;
  return (
    <details className="group">
      <summary className="w-fit cursor-pointer rounded-sm">
        {count} {count === 1 ? "finding" : "findings"}; none stops the Spec
        being used
      </summary>
      <ul className="mt-2 grid gap-1.5 text-[13px]">
        {issues.map((issue) => (
          <li
            key={`${issue.path}:${issue.message}`}
            className="[overflow-wrap:anywhere]"
          >
            {issue.message}{" "}
            <span className="font-mono text-xs text-sb-text-muted">
              {issue.path}
            </span>
            {issue.count > 1 ? (
              <span className="text-sb-text-muted"> ×{issue.count}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function NormalizedForm({ spec }: { spec: SpecAnswer }) {
  if (spec.normalized === "pending")
    return <span>Being built. Reload in a minute.</span>;
  if (spec.normalized === "failed")
    return <span>Couldn't be built; the Published Form is still usable.</span>;
  return (
    <span>
      <a href={spec.downloads.normalized} className="text-sb-accent-text">
        Download<span className="sr-only"> the Normalized Form</span>
      </a>{" "}
      <span className="text-sb-text-muted">
        · one bundled document in the current OpenAPI version
      </span>
    </span>
  );
}

function AlternateSpecs({ specs }: { specs: SpecAnswer[] }) {
  return (
    <section aria-labelledby="alternates" className={SECTION}>
      <h2 id="alternates" className={H2}>
        Alternate Specs
      </h2>
      {specs.length === 0 ? (
        <p className={MUTED}>None: the Current Spec is the only one.</p>
      ) : (
        <Card className="overflow-hidden rounded-[12px]">
          <ul className="divide-y divide-sb-border">
            {specs.map((spec) => {
              const size = sizeOf(spec.byteLength);
              const version = `API Version ${spec.apiVersion ?? "not stated"}`;
              return (
                <li
                  key={spec.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-3.5"
                >
                  <span className="grid gap-0.5">
                    <span className="font-semibold">
                      {version}
                      {spec.isPreview ? " · Preview" : ""}
                    </span>
                    <span className="text-[13px] text-sb-text-muted">
                      {specName(spec.specVersion)} · {spec.format.toUpperCase()}{" "}
                      · {size.value} {size.unit}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-4 text-sm">
                    <a
                      href={`/specs/${spec.id}`}
                      className="text-sb-accent-text"
                    >
                      View<span className="sr-only"> {version}</span>
                    </a>
                    <a
                      href={spec.downloads.published}
                      className="text-sb-accent-text"
                    >
                      Download<span className="sr-only"> {version}</span>
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}

/**
 * Where a Spec was found: each Source's URL (as text, never a link to it),
 * its Provenance and when it was last verified.
 */
export function Sources({
  sources,
}: {
  sources: Pick<Source, "id" | "url" | "provenance" | "lastVerifiedAt">[];
}) {
  return (
    <section aria-labelledby="sources" className={SECTION}>
      <h2 id="sources" className={H2}>
        Sources
      </h2>
      <Card className="overflow-hidden rounded-[12px]">
        <ul className="divide-y divide-sb-border">
          {sources.map((source) => (
            <li
              key={source.id}
              className="grid gap-1.5 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-baseline sm:gap-x-4"
            >
              <span>
                <ProvenanceBadge provenance={source.provenance} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="font-mono text-[13px] [overflow-wrap:anywhere]">
                  {source.url}
                </span>
                <span className="text-[13px] text-sb-text-muted">
                  Last verified{" "}
                  <time dateTime={source.lastVerifiedAt}>
                    {dayOf(source.lastVerifiedAt)}
                  </time>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** A Provenance tier as a badge: Official the plainest, Community outlined. */
function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <Badge tone={provenance === "Community" ? "outline" : "neutral"}>
      <span className="sr-only">Provenance: </span>
      {provenance}
    </Badge>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: string[] }) {
  return (
    <section aria-labelledby="diagnostics" className={SECTION}>
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

/** Terms and values, in a card: two columns from `sm`. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 px-4 py-3.5 text-sm sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-y-2.5">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-sb-text-muted">{term}</dt>
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
      <span className="font-mono text-xs leading-5 text-sb-text-muted [overflow-wrap:anywhere]">
        {id}
      </span>
    </span>
  );
}

/** The Vendor's name, linked to its APIs, and its domain only when that says more. */
function VendorName({ vendor }: { vendor: Of<"NoSpec">["vendor"] }) {
  const domain = distinctDomain(vendor.name, vendor.domain);
  return (
    <span>
      <a href={vendorHref(vendor.id)} className="text-sb-text">
        {vendor.name}
      </a>
      {domain ? <span className="text-sb-text-muted"> ({domain})</span> : null}
    </span>
  );
}

// ------------------------------------------------------------- Helpers

/** `3.0.0` → `OpenAPI 3.0.0`; `2.0` → `Swagger 2.0`. */
export function specName(version: string): string {
  return version.startsWith("2") ? `Swagger ${version}` : `OpenAPI ${version}`;
}

/** A download URL made absolute: a path is put under `baseUrl`. */
export function absoluteUrl(url: string, baseUrl: string): string {
  return url.startsWith("/") ? `${baseUrl}${url}` : url;
}

/** `/lookup?…`: the Lookup `request` asks for, as a plain link. */
export function requestHref(request: LookupRequest): string {
  if (!request.apiVersion && !request.allowCommunity)
    return lookupHref(request.name);
  const params = new URLSearchParams({ name: request.name });
  if (request.apiVersion) params.set("apiVersion", request.apiVersion);
  if (request.allowCommunity) params.set("allowCommunity", "1");
  return `/lookup?${params}`;
}

/** The body of a `POST /api/lookup` (and `lookup_api`'s arguments). */
function requestBody(request: LookupRequest): string {
  return JSON.stringify({
    name: request.name,
    ...(request.apiVersion ? { apiVersion: request.apiVersion } : {}),
    ...(request.allowCommunity ? { allowCommunity: true } : {}),
  });
}

/** The answer's JSON, as the HTTP API gives it, less the Validity Issues. */
function answerJson(outcome: SpecOutcome): string {
  const { validityIssues: _issues, timings: _timings, ...rest } = outcome;
  return JSON.stringify(rest, null, 2);
}

/** `text` as one single-quoted shell word. */
function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
