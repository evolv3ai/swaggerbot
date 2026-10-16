import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXAMPLES } from "../components/docs/reference";
import type { Outcome } from "../domain/outcome";
import { CLI_VERSION, runCli } from "./main";
import type { Io } from "./render";

const ESC = "\u001b";

const SPEC_ID =
  "4b446f57c9327311b6b68ad0a0e53b19341971a436cd9f0fda2630e3445483df";

/** The recorded answer of `POST /api/lookup` for Val Town: Resolved. */
const RESOLVED_TEXT = EXAMPLES.find((e) => e.id === "lookup")?.answer ?? "";

/** The recorded 401 for a name the Index doesn't know, as `/docs` shows it. */
const NEEDS_KEY_TEXT =
  EXAMPLES.find((e) => e.id === "lookup-no-key")?.answer.replace(
    /^HTTP 401\n/,
    "",
  ) ?? "";

const spec = (apiId: string) => ({
  id: SPEC_ID,
  apiId,
  specVersion: "3.1.0",
  apiVersion: "1",
  isPreview: false,
  supersededAt: null,
  format: "json" as const,
  byteLength: 72545,
  // Without PUBLIC_BASE_URL the server gives paths: the CLI makes them absolute.
  downloads: {
    published: `/api/specs/${SPEC_ID}/published`,
    normalized: `/api/specs/${SPEC_ID}/normalized`,
  },
  normalized: "ready" as const,
});

const AMBIGUOUS: Outcome = {
  outcome: "Ambiguous",
  candidates: [
    {
      apiId: "atlassian.com/jira-cloud-platform",
      name: "Jira Cloud Platform REST API",
      vendor: "Atlassian",
      probability: 0.55,
    },
    {
      apiId: "atlassian.com/jira-software-cloud",
      name: "Jira Software Cloud REST API",
      vendor: "Atlassian",
      probability: 0.4,
    },
  ],
};

const UNCONFIRMED: Outcome = {
  outcome: "Unconfirmed",
  api: {
    id: "payco.example/payments",
    vendorId: "payco.example",
    name: "Payments API",
  },
  vendor: { id: "payco.example", name: "PayCo", domain: "payco.example" },
  spec: spec("payco.example/payments"),
  sources: [
    {
      id: 7,
      specId: SPEC_ID,
      url: "https://github.com/payco/sdk/blob/main/fixtures/openapi.json",
      provenance: "Mirror",
      firstSeenAt: "2026-09-23T07:42:46.292Z",
      lastVerifiedAt: "2026-09-24T00:07:16.403Z",
    },
  ],
  reasons: ["The Spec's title names a test fixture, not the API."],
  validityIssues: [],
  validityIssueCount: 3,
  verifiedAt: "2026-09-24T00:07:16.403Z",
};

const NO_SPEC: Outcome = {
  outcome: "NoSpec",
  api: {
    id: "example.com/widgets",
    vendorId: "example.com",
    name: "Widgets API",
  },
  vendor: { id: "example.com", name: "Example", domain: "example.com" },
  communityAvailable: true,
};

const UNKNOWN: Outcome = {
  outcome: "Unknown",
  name: "Not An API",
  diagnostics: ["web search: no result named it"],
};

/** What the fake answers, by the name looked up. */
const ANSWERS: Record<
  string,
  { status: number; body: string; headers?: Record<string, string> }
> = {
  "Val Town": { status: 200, body: RESOLVED_TEXT },
  Jira: { status: 200, body: JSON.stringify(AMBIGUOUS) },
  PayCo: { status: 200, body: JSON.stringify(UNCONFIRMED) },
  Widgets: { status: 200, body: JSON.stringify(NO_SPEC) },
  "Not An API": { status: 200, body: JSON.stringify(UNKNOWN) },
  "Not Yet Indexed": {
    status: 401,
    body: NEEDS_KEY_TEXT,
    headers: { "www-authenticate": "Bearer" },
  },
  "Bad Key": {
    status: 401,
    body: JSON.stringify({ error: "Unknown or revoked API key." }),
  },
  Quota: {
    status: 429,
    body: JSON.stringify({ error: "Daily quota used.", limit: 100, used: 100 }),
    headers: { "retry-after": "3600" },
  },
  Down: {
    status: 503,
    body: JSON.stringify({
      error: "API keys can't be checked right now.",
      hint: "retry shortly",
    }),
    headers: { "retry-after": "30" },
  },
  "Not JSON": { status: 200, body: "<html>oops</html>" },
};

type Seen = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

let server: Server;
let url: string;
let refusedUrl: string;
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = JSON.parse(raw) as { name: string };
      seen.push({ headers: req.headers, body });
      if (req.method !== "POST" || req.url !== "/api/lookup") {
        res.writeHead(404).end();
        return;
      }
      const answer = ANSWERS[body.name] ?? {
        status: 500,
        body: JSON.stringify({ error: `the fake knows no ${body.name}` }),
      };
      res.writeHead(answer.status, {
        "content-type": "application/json",
        ...answer.headers,
      });
      res.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // A port nothing listens on: bound then released.
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  refusedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen.length = 0;
});

/** Runs the CLI against the fake, capturing what it writes. */
async function cli(
  args: string[],
  {
    env = {},
    isTTY = false,
    at = url,
  }: { env?: NodeJS.ProcessEnv; isTTY?: boolean; at?: string } = {},
) {
  let stdout = "";
  let stderr = "";
  const io: Io = {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    isTTY,
    env: { SWAGGERBOT_URL: at, ...env },
  };
  const code = await runCli(args, io);
  return { code, stdout, stderr };
}

describe("swaggerbot lookup", () => {
  it("prints Resolved on one line with the Spec URL and Provenance, exit 0", async () => {
    const { code, stdout, stderr } = await cli(["lookup", "Val Town"]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toMatchInlineSnapshot(`
      "Resolved  Val API (val.town/api)  Official  https://swaggerbot.dev/api/specs/4b446f57c9327311b6b68ad0a0e53b19341971a436cd9f0fda2630e3445483df/published  verified 2026-09-24
      "
    `);
  });

  it("prints Ambiguous with its candidates, exit 1", async () => {
    const { code, stdout } = await cli(["lookup", "Jira"]);

    expect(code).toBe(1);
    expect(stdout).toMatchInlineSnapshot(`
      "Ambiguous  2 APIs could be meant; say which
        Jira Cloud Platform REST API (Atlassian)  atlassian.com/jira-cloud-platform  55%
        Jira Software Cloud REST API (Atlassian)  atlassian.com/jira-software-cloud  40%
      "
    `);
  });

  it("prints Unconfirmed with the Spec URL made absolute, its best Provenance and the reasons, exit 1", async () => {
    const { code, stdout } = await cli(["lookup", "PayCo"]);

    expect(code).toBe(1);
    expect(stdout).toMatchInlineSnapshot(`
      "Unconfirmed  Payments API (payco.example/payments)  Mirror  ${url}/api/specs/4b446f57c9327311b6b68ad0a0e53b19341971a436cd9f0fda2630e3445483df/published  verified 2026-09-24
        not confirmed to describe it: The Spec's title names a test fixture, not the API.
      "
    `);
  });

  it("prints No Spec, saying when --community would help, exit 1", async () => {
    const { code, stdout } = await cli(["lookup", "Widgets"]);

    expect(code).toBe(1);
    expect(stdout).toMatchInlineSnapshot(`
      "No Spec  Widgets API (example.com/widgets)  a Community Spec exists: add --community to allow it
      "
    `);
  });

  it("prints Unknown with the diagnostics, exit 1", async () => {
    const { code, stdout } = await cli(["lookup", "Not An API"]);

    expect(code).toBe(1);
    expect(stdout).toMatchInlineSnapshot(`
      "Unknown  no API matches "Not An API"
        diagnostics: web search: no result named it
      "
    `);
  });

  it("prints the body byte for byte with --json, then a newline, errors included", async () => {
    for (const [name, answer] of Object.entries(ANSWERS)) {
      const { code, stdout, stderr } = await cli([
        "lookup",
        name,
        "--json",
        "--key",
        "sb_x",
      ]);
      expect(stdout).toBe(`${answer.body}\n`);
      expect(stderr).toBe("");
      const outcome = answer.status === 200 && name !== "Not JSON";
      expect(code).toBe(!outcome ? 3 : name === "Val Town" ? 0 : 1);
    }
  });

  it("sends the request the HTTP API takes, the User-Agent and accept, and no bearer without a key", async () => {
    await cli(["lookup", "Val Town", "--api-version", "1", "--community"]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toEqual({
      name: "Val Town",
      apiVersion: "1",
      allowCommunity: true,
    });
    expect(seen[0]?.headers["user-agent"]).toBe(
      `swaggerbot-cli/${CLI_VERSION} node/${process.versions.node}`,
    );
    expect(seen[0]?.headers.accept).toBe("application/json");
    expect(seen[0]?.headers["content-type"]).toBe("application/json");
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  it("sends only name for a plain lookup", async () => {
    await cli(["lookup", "Val Town"]);
    expect(seen[0]?.body).toEqual({ name: "Val Town" });
  });

  it.each([
    ["--key", ["--key", "sb_flag"], {}, "sb_flag"],
    ["SWAGGERBOT_API_KEY", [], { SWAGGERBOT_API_KEY: "sb_env" }, "sb_env"],
    [
      "--key over SWAGGERBOT_API_KEY",
      ["--key", "sb_flag"],
      { SWAGGERBOT_API_KEY: "sb_env" },
      "sb_flag",
    ],
  ])("sends the bearer from %s", async (_, flags, env, secret) => {
    await cli(["lookup", "Val Town", "--fresh", ...flags], { env });

    expect(seen[0]?.headers.authorization).toBe(`Bearer ${secret}`);
    expect(seen[0]?.body).toEqual({ name: "Val Town", fresh: true });
  });

  it("refuses --fresh without a key before sending anything, exit 3", async () => {
    const { code, stdout, stderr } = await cli([
      "lookup",
      "Val Town",
      "--fresh",
    ]);

    expect(seen).toHaveLength(0);
    expect(code).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`
      "error  --fresh needs an API key.
        Discovery needs an API key. Get one at https://swaggerbot.dev/keys, then run \`swaggerbot login\`.
      "
    `);
  });

  it("sends --fresh without a key under --json and prints the server's 401 body byte for byte, exit 3", async () => {
    const { code, stdout, stderr } = await cli([
      "lookup",
      "Not Yet Indexed",
      "--fresh",
      "--json",
    ]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toEqual({ name: "Not Yet Indexed", fresh: true });
    expect(seen[0]?.headers.authorization).toBeUndefined();
    expect(code).toBe(3);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${NEEDS_KEY_TEXT}\n`);
  });

  it("explains a 401 for Discovery with where to get a key, exit 3", async () => {
    const { code, stdout, stderr } = await cli(["lookup", "Not Yet Indexed"]);

    expect(code).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`
      "error  Discovery needs an API key.
        Discovery needs an API key. Get one at https://swaggerbot.dev/keys, then run \`swaggerbot login\`.
      "
    `);
  });

  it("explains a 401 for a key that isn't live, exit 3", async () => {
    const { code, stderr } = await cli(["lookup", "Bad Key", "--key", "sb_x"]);

    expect(code).toBe(3);
    expect(stderr).toMatchInlineSnapshot(`
      "error  Unknown or revoked API key.
        Check the key, or get a new one at https://swaggerbot.dev/keys, then run \`swaggerbot login\`.
      "
    `);
  });

  it("says when to retry after a 429, exit 3", async () => {
    const { code, stderr } = await cli(["lookup", "Quota", "--key", "sb_x"]);

    expect(code).toBe(3);
    expect(stderr).toMatchInlineSnapshot(`
      "error  Daily quota used.
        Retry in 60 min.
      "
    `);
  });

  it("says when to retry after a 503, exit 3", async () => {
    const { code, stderr } = await cli(["lookup", "Down", "--key", "sb_x"]);

    expect(code).toBe(3);
    expect(stderr).toMatchInlineSnapshot(`
      "error  API keys can't be checked right now.
        Retry in 30 s.
      "
    `);
  });

  it("says when the service refuses the connection, exit 3", async () => {
    const { code, stderr } = await cli(["lookup", "Val Town"], {
      at: refusedUrl,
    });

    expect(code).toBe(3);
    expect(stderr).toMatch(
      /^error {2}Could not reach http:\/\/127\.0\.0\.1:\d+: .*ECONNREFUSED/,
    );
    expect(stderr).toContain("Check the network");
  });

  it("refuses an answer that isn't JSON, exit 3", async () => {
    const { code, stderr } = await cli(["lookup", "Not JSON"]);

    expect(code).toBe(3);
    expect(stderr).toContain("answered 200 but not with JSON");
  });

  it("prints {status: 0, error} as JSON on stdout with --json when no answer came, exit 3", async () => {
    const { code, stdout, stderr } = await cli(
      ["lookup", "Val Town", "--json"],
      {
        at: refusedUrl,
      },
    );

    expect(code).toBe(3);
    expect(stderr).toBe("");
    const printed = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(printed)).toEqual(["status", "error"]);
    expect(printed.status).toBe(0);
    expect(printed.error).toMatch(
      /^Could not reach http:\/\/127\.0\.0\.1:\d+: .*ECONNREFUSED/,
    );
  });

  it("takes --url over SWAGGERBOT_URL", async () => {
    const { code } = await cli(["lookup", "Val Town", "--url", url], {
      at: refusedUrl,
    });
    expect(code).toBe(0);
  });

  it("colours only on a TTY, and never with --no-color or NO_COLOR", async () => {
    const plain = (await cli(["lookup", "Val Town"])).stdout;
    expect(plain).not.toContain("\u001b[");

    const tty = (await cli(["lookup", "Val Town"], { isTTY: true })).stdout;
    expect(tty).toContain("\u001b[32m");
    expect(tty.replaceAll(new RegExp(`${ESC}\\[\\d+m`, "g"), "")).toBe(plain);

    const flagged = (
      await cli(["lookup", "Val Town", "--no-color"], { isTTY: true })
    ).stdout;
    expect(flagged).toBe(plain);

    const env = (
      await cli(["lookup", "Val Town"], { isTTY: true, env: { NO_COLOR: "1" } })
    ).stdout;
    expect(env).toBe(plain);
  });
});

describe("swaggerbot", () => {
  it("prints the version of cli/package.json", async () => {
    const { code, stdout } = await cli(["--version"]);
    expect(code).toBe(0);
    expect(stdout).toBe(`${CLI_VERSION}\n`);
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints the usage for --help", async () => {
    const { code, stdout } = await cli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("usage: swaggerbot <command>");
  });

  it("answers a usage error on stderr with exit 2, even with --json", async () => {
    const { code, stdout, stderr } = await cli([
      "--json",
      "lookup",
      "x",
      "--bogus",
    ]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("usage error  Unknown option '--bogus'");
    expect(seen).toHaveLength(0);
  });
});
