import { createFileRoute } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

const REPO = "https://github.com/evolv3ai/swaggerbot";

const REQUEST = `curl https://swaggerbot.dev/api/lookup \\
  -H 'content-type: application/json' \\
  -d '{"name": "Stripe API"}'`;

const MCP_ADD = `claude mcp add --transport http swaggerbot https://swaggerbot.dev/mcp`;

// Production's answer on 2026-09-24, trimmed: ids shortened, fields omitted.
const RESPONSE = `{
  "outcome": "Resolved",
  "api": { "id": "stripe.com/stripe-api", "name": "Stripe API" },
  "provenance": "Official",
  "verifiedAt": "2026-09-24T00:03:12.221Z",
  "currentSpec": {
    "id": "1fdc1047…78a9",
    "specVersion": "3.0.0",
    "apiVersion": "2026-09-30.endive",
    "downloads": {
      "published": "https://swaggerbot.dev/api/specs/1fdc1047…/published",
      "normalized": "https://swaggerbot.dev/api/specs/1fdc1047…/normalized"
    },
    "normalized": "ready"
  },
  "alternateSpecs": [],
  "validityIssueCount": 0
}`;

/** Keys, strings and the two fields a Caller reads first, as spans. */
function highlightJson(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  const token = /("(?:[^"\\]|\\.)*")(\s*:)?/g;
  let last = 0;
  let key: string | undefined;
  for (const match of json.matchAll(token)) {
    const [text, str, colon] = match;
    const at = match.index ?? 0;
    if (at > last) out.push(json.slice(last, at));
    if (colon) {
      key = str;
      out.push(
        <span className="k" key={at}>
          {str}
        </span>,
        colon,
      );
    } else {
      const strong = key === '"outcome"' || key === '"provenance"';
      out.push(
        <span className={strong ? "s hl" : "s"} key={at}>
          {str}
        </span>,
      );
    }
    last = at + text.length;
  }
  out.push(json.slice(last));
  return out;
}

const OUTCOMES: [string, string][] = [
  [
    "Resolved",
    "The name identifies one API, and its Current Spec is confirmed to describe it.",
  ],
  [
    "Ambiguous",
    "The name could mean several APIs. You get the candidates to choose from, not a guess.",
  ],
  [
    "Unconfirmed",
    "A Spec was found but couldn't be confirmed to describe the API. It comes with the reasons for doubt.",
  ],
  [
    "No Spec",
    "The API exists, but no Spec for it was found that can be trusted. Community Specs count only if you ask for them.",
  ],
  ["Unknown", "The name doesn't match any API."],
];

const ROUTES: { method: "GET" | "POST"; path: string; gives: string }[] = [
  {
    method: "POST",
    path: "/api/lookup",
    gives:
      "An Outcome for { name }. Optional: apiVersion, allowCommunity, fresh.",
  },
  {
    method: "GET",
    path: "/api/specs/{specId}/published",
    gives: "The Spec exactly as its Source serves it.",
  },
  {
    method: "GET",
    path: "/api/specs/{specId}/normalized",
    gives: "The same Spec bundled into one OpenAPI 3.1 document.",
  },
  {
    method: "GET",
    path: "/api/apis/{apiId}/outline",
    gives:
      "The Current Spec's tags, operations and auth schemes, without the schemas.",
  },
  {
    method: "GET",
    path: "/api/apis/{apiId}/operation?method=&path=",
    gives: "One operation with every $ref it reaches inlined.",
  },
  {
    method: "GET",
    path: "/api/vendors/{vendor}/apis",
    gives: "A Vendor's APIs in the Index, by domain or name.",
  },
  {
    method: "POST",
    path: "/mcp",
    gives:
      "The MCP server for agents: the same answers as five tools, under the same key rules.",
  },
  {
    method: "GET",
    path: "/api/health",
    gives: "{ ok: true } while the service is up.",
  },
];

function Home() {
  const [healthy, setHealthy] = useState<boolean>();
  useEffect(() => {
    fetch("/api/health")
      .then((response) => setHealthy(response.ok))
      .catch(() => setHealthy(false));
  }, []);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="page">
        <header className="masthead">
          <a className="brand" href="/" aria-label="swagger.bot home">
            <BotMark />
            swagger.bot
          </a>
          <nav aria-label="Site">
            <a href="#routes" data-optional>
              API
            </a>
            <a href={`${REPO}#readme`}>Docs</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </header>

        <main id="main">
          <section className="hero" aria-labelledby="hero-title">
            <div>
              <h1 id="hero-title">
                Name an API. Get its verified OpenAPI Spec.
              </h1>
              <p className="lede">
                swagger.bot finds the Spec a Vendor actually publishes, checks
                it describes the API you meant, and tells you{" "}
                <strong>where it came from</strong>. When it can't be sure, it
                says so instead of guessing.
              </p>
              <p className="status" data-ok={healthy} aria-live="polite">
                {healthy === undefined
                  ? "Checking the service…"
                  : healthy
                    ? "The service is up"
                    : "The service isn't answering right now"}
              </p>
            </div>

            <figure className="exchange">
              <pre>
                <code>
                  <span className="prompt">$ </span>
                  {REQUEST}
                </code>
              </pre>
              <pre>
                <code>{highlightJson(RESPONSE)}</code>
              </pre>
              <figcaption>
                A real answer from this service, trimmed for length.
              </figcaption>
            </figure>
          </section>

          <section className="section" aria-labelledby="outcomes-title">
            <div>
              <h2 id="outcomes-title">Five honest answers</h2>
              <p>
                Every Lookup ends in exactly one Outcome. A wrong Spec presented
                as right is the one answer swagger.bot is built never to give.
              </p>
              <p>
                Each Spec carries its Provenance: <code>Official</code>,{" "}
                <code>Endorsed</code>, <code>Mirror</code> or{" "}
                <code>Community</code> (only when you ask for it with{" "}
                <code>allowCommunity</code>).
              </p>
            </div>
            <dl className="outcomes">
              {OUTCOMES.map(([name, meaning]) => (
                <Fragment key={name}>
                  <dt>{name}</dt>
                  <dd>{meaning}</dd>
                </Fragment>
              ))}
            </dl>
          </section>

          <section className="section" aria-labelledby="mcp-title">
            <div>
              <h2 id="mcp-title">Use it from Claude Code</h2>
              <p>
                swagger.bot is an MCP server too. Add it, and your agent can
                look up an API, search its operations and read the one it needs,
                every result small enough for its context.
              </p>
              <p>
                Discovery needs a key: add{" "}
                <code>--header "Authorization: Bearer …"</code>.
              </p>
            </div>
            <figure className="exchange">
              <pre>
                <code>
                  <span className="prompt">$ </span>
                  {MCP_ADD}
                </code>
              </pre>
            </figure>
          </section>

          <section
            className="section section-wide"
            id="routes"
            aria-labelledby="routes-title"
          >
            <div>
              <h2 id="routes-title">The HTTP API</h2>
              <p>
                Names already in the Index are answered for anyone, without a
                key. A name the Index can't answer starts a Discovery on the
                live web, which needs an API key sent as{" "}
                <code>Authorization: Bearer …</code>.
              </p>
              <p>
                Keys are issued by hand for now:{" "}
                <a href={`${REPO}/issues/new`}>open an issue</a> to ask for one.
                Every request counts against a limit of 60 a minute per IP.
              </p>
            </div>
            <table className="routes">
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">Gives</th>
                </tr>
              </thead>
              <tbody>
                {ROUTES.map(({ method, path, gives }) => (
                  <tr key={`${method} ${path}`}>
                    <td>
                      <span className="route">
                        <span className="method" data-method={method}>
                          {method}
                        </span>
                        <code>{breakable(path)}</code>
                      </span>
                    </td>
                    <td>{gives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>

        <footer className="footer">
          <p>
            swagger.bot is open source.{" "}
            <a href={`${REPO}#readme`}>Read the docs</a> for the full API.
          </p>
          <p>
            <a href="/api/health">Service health</a>
          </p>
        </footer>
      </div>
    </>
  );
}

/** A path that may wrap only after a slash or a question mark. */
function breakable(path: string): ReactNode[] {
  return path.split(/(?<=[/?])/).flatMap((part, i) => [
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
    i > 0 ? <wbr key={i} /> : null,
    part,
  ]);
}

function BotMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mark-from)" />
          <stop offset="1" stopColor="var(--mark-to)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#mark)" />
      <g
        transform="translate(4 4)"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="9" width="20" height="14" rx="4" />
        <circle cx="12" cy="3" r="2" />
        <path d="M12 5v4m-3 8v-2m6 0v2" />
      </g>
    </svg>
  );
}
