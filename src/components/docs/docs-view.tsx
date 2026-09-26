import { CodeLine } from "~/components/darkroom/code-line";
import { dayOf } from "~/components/darkroom/stamp";
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

const LINK =
  "underline decoration-1 underline-offset-[0.2em] hover:decoration-2";
const LABEL = "font-caps text-sm font-semibold uppercase tracking-[0.14em]";
const H2 = "font-caps text-2xl font-semibold uppercase tracking-wide";
const H3 = "font-mono text-base font-semibold [overflow-wrap:anywhere]";
const PROSE = "max-w-[34rem] leading-relaxed";
const TH =
  "border-b border-rule py-2 pr-4 text-left align-bottom font-caps text-xs font-semibold uppercase tracking-[0.14em] text-ink-2";
const TD =
  "border-b border-rule py-2.5 pr-4 align-top max-sm:block max-sm:border-0 max-sm:p-0";
/** Below `sm` a row stacks: its cells one under another, the header hidden. */
const TR =
  "max-sm:grid max-sm:gap-1 max-sm:border-b max-sm:border-rule max-sm:py-3";
const CELL_LABEL =
  "font-caps text-xs font-semibold uppercase tracking-[0.14em] text-ink-2 sm:hidden";

/** The page's sections, in order, for the contents list. */
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
          <code key={i} className="font-mono text-[0.92em]">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * `/docs`: the HTTP API (the route table, then each route with a `curl` and
 * the answer it gave), MCP, the key rules, and how to ask for a key.
 */
export function DocsView() {
  return (
    <div className="grid gap-10 px-4 pt-8 pb-12 sm:px-8 lg:gap-14 lg:pt-12">
      <header className="grid gap-6">
        <h1 className="font-pencil text-[clamp(3.25rem,8.5vw,6rem)] uppercase leading-[0.95]">
          Docs
        </h1>
        <p className="max-w-[34rem] text-lg leading-relaxed text-ink-2 sm:text-xl">
          Everything this site shows, programs get over HTTP and agents over
          MCP, in the same words. Answers from the Index are open to anyone;
          Discovery needs a key.
        </p>
        <nav aria-labelledby="contents" className="grid gap-2">
          <h2 id="contents" className={cn(LABEL, "text-ink-2")}>
            On this page
          </h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={LINK}>
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
  );
}

function HttpApi() {
  return (
    <section
      aria-labelledby="http-api-title"
      id="http-api"
      className="grid gap-8"
    >
      <div className="grid gap-3">
        <h2 id="http-api-title" className={H2}>
          HTTP API
        </h2>
        <p className={PROSE}>
          <Inline
            text={`JSON over HTTPS at \`${BASE_URL}\`. Every route but \`GET /api/health\` counts against the per-IP limit; a method a route doesn't take is a 405 with an \`Allow\` header, and a path no route serves is a JSON 404.`}
          />
        </p>
      </div>
      <RouteTable />
      <div className="grid gap-10">
        <p className={cn(PROSE, "text-sm text-ink-2")}>
          Each example is a real call to {BASE_URL} and the answer it gave on{" "}
          {dayOf(RECORDED_AT)}, for Val Town's API. Ids and dates change as the
          Index verifies Specs again; the shape of each answer doesn't.
        </p>
        {EXAMPLES.map((example) => (
          <RouteExample key={example.id} example={example} />
        ))}
      </div>
    </section>
  );
}

function RouteTable() {
  return (
    <div className="grid gap-2">
      <h3 id="routes" className={cn(LABEL, "text-ink-2")}>
        The routes
      </h3>
      <table aria-labelledby="routes" className="w-full max-w-[64rem] text-sm">
        <thead className="max-sm:sr-only">
          <tr>
            <th scope="col" className={TH}>
              Route
            </th>
            <th scope="col" className={TH}>
              Gives
            </th>
            <th scope="col" className={cn(TH, "pr-0")}>
              Key
            </th>
          </tr>
        </thead>
        <tbody>
          {ROUTES.map((row) => (
            <tr key={row.route} className={TR}>
              <th
                scope="row"
                className={cn(
                  TD,
                  "text-left sm:w-[38%] font-mono font-normal [overflow-wrap:anywhere]",
                )}
              >
                {row.route}
              </th>
              <td className={TD}>
                <Inline text={row.gives} />
              </td>
              <td className={cn(TD, "pr-0")}>
                <span className={CELL_LABEL}>Key: </span>
                {row.key}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RouteExample({ example }: { example: Example }) {
  const title = `${example.id}-title`;
  return (
    <section aria-labelledby={title} className="grid max-w-[56rem] gap-3">
      <h3 id={title} className={H3}>
        {example.route}
      </h3>
      <p className={PROSE}>
        <Inline text={example.about} />
      </p>
      <CodeLine code={example.curl} />
      <p className={cn(LABEL, "text-ink-2")}>Answer</p>
      <CodeLine code={example.answer} />
      {example.note ? (
        <p className="text-sm text-ink-2">
          <Inline text={example.note} />
        </p>
      ) : null}
    </section>
  );
}

function Mcp() {
  return (
    <section aria-labelledby="mcp-title" id="mcp" className="grid gap-8">
      <div className="grid gap-3">
        <h2 id="mcp-title" className={H2}>
          MCP
        </h2>
        <p className={PROSE}>
          For agents: an MCP server over Streamable HTTP, stateless, with five
          tools that answer as the HTTP API does. Each result carries its JSON
          as <code className="font-mono text-[0.92em]">structuredContent</code>{" "}
          and a text that starts with a sentence for the agent and the next call
          to make.
        </p>
      </div>
      <div className="grid max-w-[56rem] gap-3">
        <h3 className={cn(LABEL, "text-ink-2")}>The endpoint</h3>
        <CodeLine code={MCP_URL} />
      </div>
      <div className="grid max-w-[56rem] gap-3">
        <h3 className={cn(LABEL, "text-ink-2")}>Add it to Claude Code</h3>
        <CodeLine code={MCP_ADD} />
        <p className="text-sm text-ink-2">
          With a key, for Discovery and <code className="font-mono">fresh</code>
          :
        </p>
        <CodeLine code={MCP_ADD_WITH_KEY} />
      </div>
      <div className="grid gap-2">
        <h3 id="tools" className={cn(LABEL, "text-ink-2")}>
          The five tools
        </h3>
        <table aria-labelledby="tools" className="w-full max-w-[64rem] text-sm">
          <thead className="max-sm:sr-only">
            <tr>
              <th scope="col" className={TH}>
                Tool
              </th>
              <th scope="col" className={TH}>
                Gives
              </th>
              <th scope="col" className={cn(TH, "pr-0")}>
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
                    "text-left sm:w-[34%] font-mono font-normal [overflow-wrap:anywhere]",
                  )}
                >
                  <span className="font-semibold">{tool.name}</span>
                  <span className="block text-xs text-ink-2">{tool.args}</span>
                </th>
                <td className={TD}>
                  <Inline text={tool.gives} />
                </td>
                <td
                  className={cn(
                    TD,
                    "pr-0 font-mono [overflow-wrap:break-word]",
                  )}
                >
                  <span className={CELL_LABEL}>Over: </span>
                  {tool.over}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3">
        <h3 className={cn(LABEL, "text-ink-2")}>Result sizes</h3>
        <ul className={cn(PROSE, "grid list-disc gap-2 pl-5")}>
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
    <section aria-labelledby="access-title" id="access" className="grid gap-3">
      <h2 id="access-title" className={H2}>
        Keys and limits
      </h2>
      <p className={PROSE}>
        The same rules hold over HTTP and MCP. A key is sent as{" "}
        <code className="font-mono [overflow-wrap:anywhere]">
          Authorization: Bearer &lt;key&gt;
        </code>
        .
      </p>
      <ul className={cn(PROSE, "grid list-disc gap-2 pl-5")}>
        {KEY_RULES.map((item) => (
          <li key={item}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Keys() {
  return (
    <section aria-labelledby="keys-title" id="keys" className="grid gap-4">
      <h2 id="keys-title" className={H2}>
        Request a key
      </h2>
      <p className={PROSE}>
        Keys are issued by hand, each with its daily quota; there are no
        accounts. Ask by email, and the key's secret is sent to you once, when
        it is made.
      </p>
      <p>
        <a
          href={KEY_REQUEST_HREF}
          className="mb-[3px] inline-flex min-h-[45px] items-center rounded-none border-2 border-[#0e0e0e] bg-lamp px-7 font-caps text-lg font-bold uppercase tracking-[0.14em] text-[#0e0e0e] no-underline shadow-[0_3px_0_#0e0e0e] transition-[box-shadow,transform] duration-100 hover:brightness-105 active:translate-y-[3px] active:shadow-none dark:border-[#9a6400] dark:shadow-[0_3px_0_#9a6400] dark:active:shadow-none"
        >
          Request a key
        </a>
      </p>
      <p className="text-sm text-ink-2">
        Or write to{" "}
        <span className="font-mono text-ink">{KEY_REQUEST_EMAIL}</span> with the
        subject “swagger.bot API key request”.
      </p>
    </section>
  );
}
