import { WithOnThisPage } from "~/components/shell/on-this-page";
import { buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { CodeBlock } from "~/components/ui/code-block";
import { MethodBadge, splitRoute } from "~/components/ui/method-badge";
import { Path } from "~/components/ui/path";
import { Tabs } from "~/components/ui/tabs";
import { dayOf } from "~/lib/dates";
import { cn } from "~/lib/utils";
import {
  BASE_URL,
  EXAMPLES,
  type Example,
  KEY_REQUEST_EMAIL,
  KEY_REQUEST_HREF,
  MCP_ADD,
  MCP_ADD_WITH_KEY,
  MCP_TOOL_ROWS,
  MCP_URL,
  RECORDED_AT,
  ROUTES,
} from "./reference";

/** A section heading: Montserrat, sentence case, with a rule above. */
const H2 =
  "scroll-mt-20 font-display text-[22px] leading-tight font-bold tracking-[-0.01em] text-sb-text sm:text-2xl";
/** A heading inside a section. */
const H3 =
  "scroll-mt-20 font-display text-base font-bold tracking-[-0.005em] text-sb-text";
/** Body prose at a comfortable measure (WTR-143: 34rem). */
const PROSE = "max-w-[34rem] leading-relaxed text-sb-text";
const SECTION = "grid gap-6 border-t border-sb-border pt-10";
const NOTE = "max-w-[34rem] text-sm leading-relaxed text-sb-text-muted";

const TABLE = "w-full border-collapse text-left text-sm";
const TH =
  "border-b border-sb-border bg-sb-surface-sunken px-4 py-2.5 text-left align-bottom text-xs font-semibold text-sb-text-muted";
const TD =
  "border-t border-sb-border px-4 py-3 align-top max-sm:block max-sm:border-0 max-sm:p-0";
/** Below `sm` a row stacks: its cells one under another, the header hidden. */
const TR =
  "max-sm:grid max-sm:gap-1.5 max-sm:border-t max-sm:border-sb-border max-sm:px-4 max-sm:py-3.5 max-sm:first:border-t-0";
const CELL_LABEL = "text-xs font-semibold text-sb-text-muted sm:hidden";

/** The page's sections, in order, for the contents list (below xl). */
const SECTIONS = [
  { id: "http-api", label: "HTTP API" },
  { id: "mcp", label: "MCP" },
  { id: "access", label: "Keys and limits" },
  { id: "keys", label: "Request a key" },
] as const;

/** What `get_spec_outline`, `get_operation` and `get_schema` keep results to. */
const RESULT_SIZES = [
  "Every result stays under 30 kB, its `structuredContent` as JSON and its text together: below Claude Code's 10,000-token warning.",
  "`get_spec_outline` gives at most 100 operations a page. On a Spec of more than 100 without a filter, it gives the tag list and the first page, and says to filter by `tag` or `query`.",
  '`get_operation` and `get_schema` inline references breadth-first up to 24 kB. Past that a reference stays `{ "$ref", "x-truncated": true }`, which `get_schema` follows; a schema that recurs within itself is `{ "$ref", "x-circular": true }`.',
  "The Spec itself never comes back inline: `lookup_api` gives its download URLs.",
];

/** The key rules, the same over HTTP and MCP. */
const KEY_RULES = [
  "A key is optional for anything the Index answers: a Lookup of a name it knows, the outline, operations, schemas, Vendor lists and downloads. They use no quota.",
  "Discovery (a name the Index can't answer yet) and `fresh: true` need a key. Without one the answer is a 401 saying so.",
  "Each such Lookup uses one unit of the key's daily quota, 100 unless the key was issued with its own, counted per UTC day. The answer carries `X-Quota-Limit` and `X-Quota-Remaining`; past the quota it is a 429, `Daily quota used.`, with `Retry-After` until midnight UTC.",
  "A key sent with an Index answer is still checked, so a wrong one is never ignored: an unknown or revoked key is a 401.",
  "Every request but `GET /api/health`, with a key or without, counts against a per-IP limit of 60 a minute, shared by `/api/`, `/mcp` and the site's own Lookup page. Past it the answer is a 429, `Rate limit exceeded.`, with `Retry-After` in seconds.",
];

/** Inline code in running text: mono on a sunken chip. */
function Code({ children }: { children: string }) {
  return (
    <code
      className={cn(
        "rounded-[4px] border border-sb-border bg-sb-surface-sunken px-[0.3em] py-px font-mono text-[0.86em] text-sb-text [box-decoration-break:clone]",
        // A short one is never split over two lines.
        children.length <= 32 && "whitespace-nowrap",
      )}
    >
      {children}
    </code>
  );
}

/**
 * Text with `code` spans: the words between backticks are set in mono, as
 * every identifier on the page is.
 */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the split is fixed text
          <Code key={i}>{part}</Code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** A route as the tables show it: its method tag, then the path in mono. */
function Route({ route }: { route: string }) {
  const { method, rest } = splitRoute(route);
  return (
    <span className="inline-flex max-w-full items-baseline gap-2">
      {method ? <MethodBadge method={method} /> : null}
      <span className="min-w-0 font-mono text-[13px] text-sb-text [overflow-wrap:break-word]">
        <Path path={rest} />
      </span>
    </span>
  );
}

/**
 * `/docs`: the HTTP API (the route table, then each route with a `curl` and
 * the answer it gave), MCP, the key rules, and how to ask for a key.
 */
export function DocsView() {
  return (
    <WithOnThisPage>
      <div className="grid max-w-[860px] gap-10 px-4 pt-7 pb-16 sm:px-8 lg:px-14 lg:pt-11">
        <header className="grid gap-4">
          <h1 className="font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.01em] text-sb-text sm:text-[40px]">
            HTTP API and MCP
          </h1>
          <p className="max-w-[34rem] text-[17px] leading-relaxed text-sb-text-muted">
            Everything this site shows, programs get over HTTP and agents over
            MCP, in the same words. Answers from the Index are open to anyone;
            Discovery needs a key.
          </p>
          <nav
            aria-labelledby="contents"
            className="grid gap-2 xl:hidden"
            data-toc-skip
          >
            <h2
              id="contents"
              className="text-[13px] font-semibold text-sb-text"
            >
              On this page
            </h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-sb-accent-text">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <HttpApi />
        <Mcp />
        <Access />
        <Keys />
      </div>
    </WithOnThisPage>
  );
}

function HttpApi() {
  return (
    <section aria-labelledby="http-api" className={SECTION}>
      <div className="grid gap-3">
        <h2 id="http-api" className={H2}>
          HTTP API
        </h2>
        <p className={PROSE}>
          <Inline
            text={`JSON over HTTPS at \`${BASE_URL}\`. Every route but \`GET /api/health\` counts against the per-IP limit; a method a route doesn't take is a 405 with an \`Allow\` header, and a path no route serves is a JSON 404.`}
          />
        </p>
      </div>
      <RouteTable />
      <p className={NOTE}>
        Each example is a real call to {BASE_URL} and the answer it gave on{" "}
        {dayOf(RECORDED_AT)}, for Val Town's API. Ids and dates change as the
        Index verifies Specs again; the shape of each answer doesn't.
      </p>
      <div className="grid gap-12">
        {EXAMPLES.map((example) => (
          <RouteExample key={example.id} example={example} />
        ))}
      </div>
    </section>
  );
}

function RouteTable() {
  return (
    <div className="grid gap-3">
      <h3 id="routes" className={H3}>
        The routes
      </h3>
      <Card className="overflow-hidden rounded-[12px]">
        <table aria-labelledby="routes" className={TABLE}>
          <thead className="max-sm:sr-only">
            <tr>
              <th scope="col" className={TH}>
                Route
              </th>
              <th scope="col" className={TH}>
                Gives
              </th>
              <th scope="col" className={TH}>
                Key
              </th>
            </tr>
          </thead>
          <tbody>
            {ROUTES.map((row) => (
              <tr key={row.route} className={TR}>
                <th scope="row" className={cn(TD, "font-normal sm:w-[40%]")}>
                  <Route route={row.route} />
                </th>
                <td className={cn(TD, "text-sb-text")}>
                  <Inline text={row.gives} />
                </td>
                <td className={cn(TD, "text-sb-text-muted sm:w-[7.5rem]")}>
                  <span className={CELL_LABEL}>Key: </span>
                  {row.key}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** A route's heading: its method tag, the path in mono, and what case it is. */
function RouteHeading({ id, route }: { id: string; route: string }) {
  const { method, rest } = splitRoute(route);
  const [path, ...cases] = rest.split(", ");
  return (
    <h3
      id={id}
      className="flex scroll-mt-20 flex-wrap items-center gap-x-2.5 gap-y-1 text-sb-text"
    >
      {method ? <MethodBadge method={method} size="md" /> : null}
      <span className="min-w-0 font-mono text-[15px] font-semibold [overflow-wrap:break-word]">
        <Path path={path ?? ""} />
      </span>
      {cases.length ? (
        <span className="font-display text-[15px] font-bold text-sb-text-muted">
          {cases.join(", ")}
        </span>
      ) : null}
    </h3>
  );
}

function RouteExample({ example }: { example: Example }) {
  return (
    <section aria-labelledby={example.id} className="grid gap-3.5">
      <RouteHeading id={example.id} route={example.route} />
      <p className={PROSE}>
        <Inline text={example.about} />
      </p>
      <Card className="overflow-hidden rounded-[12px]">
        <Tabs
          label={`${example.route}: the call and its answer`}
          listClassName="border-b border-sb-border"
          tabs={[
            {
              id: "curl",
              label: "curl",
              content: <CodeBlock code={example.curl} />,
            },
            {
              id: "answer",
              label: "Answer",
              content: <CodeBlock code={example.answer} />,
            },
          ]}
        />
      </Card>
      {example.note ? (
        <p className={NOTE}>
          <Inline text={example.note} />
        </p>
      ) : null}
    </section>
  );
}

function Mcp() {
  return (
    <section aria-labelledby="mcp" className={SECTION}>
      <div className="grid gap-3">
        <h2 id="mcp" className={H2}>
          MCP
        </h2>
        <p className={PROSE}>
          For agents: an MCP server over Streamable HTTP, stateless, with five
          tools that answer as the HTTP API does. Each result carries its JSON
          as <Code>structuredContent</Code> and a text that starts with a
          sentence for the agent and the next call to make.
        </p>
      </div>
      <div className="grid gap-3">
        <h3 className={H3}>The endpoint</h3>
        <CodeBlock
          code={MCP_URL}
          className="overflow-hidden rounded-[12px] border border-sb-border"
        />
      </div>
      <div className="grid gap-3">
        <h3 id="mcp-add" className={H3}>
          Add it to Claude Code
        </h3>
        <CodeBlock
          code={MCP_ADD}
          className="overflow-hidden rounded-[12px] border border-sb-border"
        >
          <span className="text-[#8fbaff]">claude</span>
          {MCP_ADD.slice("claude".length)}
        </CodeBlock>
        <p className={NOTE}>
          With a key, for Discovery and <Code>fresh</Code>:
        </p>
        <CodeBlock
          code={MCP_ADD_WITH_KEY}
          className="overflow-hidden rounded-[12px] border border-sb-border"
        >
          <span className="text-[#8fbaff]">claude</span>
          {MCP_ADD_WITH_KEY.slice("claude".length)}
        </CodeBlock>
      </div>
      <div className="grid gap-3">
        <h3 id="tools" className={H3}>
          The five tools
        </h3>
        <Card className="overflow-hidden rounded-[12px]">
          <table aria-labelledby="tools" className={TABLE}>
            <thead className="max-sm:sr-only">
              <tr>
                <th scope="col" className={TH}>
                  Tool
                </th>
                <th scope="col" className={TH}>
                  Gives
                </th>
                <th scope="col" className={TH}>
                  Over
                </th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOL_ROWS.map((tool) => (
                <tr key={tool.name} className={TR}>
                  <th
                    scope="row"
                    className={cn(
                      TD,
                      "font-normal sm:w-[32%] [overflow-wrap:break-word]",
                    )}
                  >
                    <span className="font-mono text-[13px] font-semibold text-sb-text">
                      {tool.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-sb-text-muted">
                      {tool.args}
                    </span>
                  </th>
                  <td className={cn(TD, "text-sb-text")}>
                    <Inline text={tool.gives} />
                  </td>
                  <td className={cn(TD, "sm:w-[28%]")}>
                    <span className={CELL_LABEL}>Over: </span>
                    <Route route={tool.over} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="grid gap-3">
        <h3 className={H3}>Result sizes</h3>
        <ul
          className={cn(
            PROSE,
            "grid list-disc gap-2 pl-5 marker:text-sb-text-faint",
          )}
        >
          {RESULT_SIZES.map((item) => (
            <li key={item}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Access() {
  return (
    <section aria-labelledby="access" className={SECTION}>
      <div className="grid gap-3">
        <h2 id="access" className={H2}>
          Keys and limits
        </h2>
        <p className={PROSE}>
          The same rules hold over HTTP and MCP. A key is sent as{" "}
          <Code>Authorization: Bearer &lt;key&gt;</Code>.
        </p>
      </div>
      <Card className="max-w-[38rem] rounded-[12px]">
        <ul className="divide-y divide-sb-border">
          {KEY_RULES.map((item) => (
            <li
              key={item}
              className="flex gap-3 px-4 py-3.5 leading-relaxed text-sb-text sm:px-5"
            >
              <span
                aria-hidden="true"
                className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-sb-accent"
              />
              <span>
                <Inline text={item} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Keys() {
  return (
    <section aria-labelledby="keys" className={SECTION}>
      <Card variant="outline" className="grid max-w-[38rem] gap-4 p-5 sm:p-6">
        <h2 id="keys" className={H2}>
          Request a key
        </h2>
        <p className="leading-relaxed text-sb-text">
          Keys are issued by hand, each with its daily quota; there are no
          accounts. Ask by email, and the key's secret is sent to you once, when
          it is made.
        </p>
        <p>
          <a href={KEY_REQUEST_HREF} className={buttonClass({ size: "lg" })}>
            Request a key
          </a>
        </p>
        <p className="text-sm text-sb-text-muted">
          Or write to{" "}
          <span className="font-mono text-sb-text">{KEY_REQUEST_EMAIL}</span>{" "}
          with the subject “swagger.bot API key request”.
        </p>
      </Card>
    </section>
  );
}
