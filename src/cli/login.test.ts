import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { storeKey } from "./config";
import { runCli } from "./main";
import type { Io } from "./render";

/** What the fake `GET /api/key` answers, by the bearer it is sent. */
const ANSWERS: Record<
  string,
  { status: number; body: string; headers?: Record<string, string> }
> = {
  sb_live: {
    status: 200,
    body: JSON.stringify({
      id: "key_abcd2345",
      remaining: 87,
      limit: 100,
      resetsAt: "2026-10-17T00:00:00.000Z",
    }),
  },
  sb_unkey: {
    status: 200,
    body: JSON.stringify({ id: "key_unkey", remaining: 1 }),
  },
  sb_spent: {
    status: 200,
    body: JSON.stringify({
      id: "key_spent",
      remaining: 0,
      limit: 100,
      resetsAt: "2026-10-17T00:00:00.000Z",
    }),
  },
  sb_bare: { status: 200, body: JSON.stringify({ id: "key_bare" }) },
  sb_dead: {
    status: 401,
    body: JSON.stringify({ error: "Unknown or revoked API key." }),
    headers: { "www-authenticate": "Bearer" },
  },
  sb_down: {
    status: 503,
    body: JSON.stringify({
      error: "API keys can't be checked right now.",
      hint: "retry shortly",
    }),
    headers: { "retry-after": "30" },
  },
};

type Seen = { method?: string; url?: string; authorization?: string };

let server: Server;
let url: string;
let dir: string;
let configPath: string;
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });
    if (req.method !== "GET" || req.url !== "/api/key") {
      res.writeHead(404).end();
      return;
    }
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
    const answer = bearer
      ? (ANSWERS[bearer] ?? {
          status: 401,
          body: JSON.stringify({ error: "Unknown or revoked API key." }),
        })
      : {
          status: 400,
          body: JSON.stringify({
            error: "Send the key as Authorization: Bearer <key>.",
          }),
        };
    res.writeHead(answer.status, {
      "content-type": "application/json",
      ...answer.headers,
    });
    res.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen.length = 0;
  dir = mkdtempSync(join(tmpdir(), "swaggerbot-cli-login-"));
  configPath = join(dir, "config.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the CLI against the fake with the config in the temp dir, capturing what it writes. */
async function cli(
  args: string[],
  {
    env = {},
    stdin,
    at = url,
    now = new Date("2026-10-16T19:00:00Z"),
  }: {
    env?: NodeJS.ProcessEnv;
    stdin?: Io["stdin"];
    at?: string;
    now?: Date;
  } = {},
) {
  let stdout = "";
  let stderr = "";
  const io: Io = {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    stdin,
    isTTY: false,
    stderrIsTTY: false,
    env: { SWAGGERBOT_URL: at, SWAGGERBOT_CONFIG: configPath, ...env },
    now: () => now,
  };
  const code = await runCli(args, io);
  return { code, stdout, stderr };
}

/** The config file's keys, or none when there is no file. */
function stored(): Record<string, string> | undefined {
  try {
    return JSON.parse(readFileSync(configPath, "utf8")).keys;
  } catch {
    return undefined;
  }
}

/** A key piped to stdin. */
const piped = (text: string): Io["stdin"] =>
  Object.assign(Readable.from([text]), { isTTY: false });

describe("swaggerbot login", () => {
  it("checks the --key with GET /api/key at cost 0, stores it for the origin and says who it is, exit 0", async () => {
    const { code, stdout, stderr } = await cli(["login", "--key", "sb_live"]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toBe(
      `Signed in to ${url} as key_abcd2345: 87 credits left today\n`,
    );
    expect(seen).toEqual([
      { method: "GET", url: "/api/key", authorization: "Bearer sb_live" },
    ]);
    expect(stored()).toEqual({ [url]: "sb_live" });
    if (process.platform !== "win32")
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("reads the key from a pipe when --key isn't given, and never echoes it", async () => {
    const { code, stdout, stderr } = await cli(["login"], {
      stdin: piped("\n  sb_live  \n"),
    });

    expect(code).toBe(0);
    expect(`${stdout}${stderr}`).not.toContain("sb_live");
    expect(stored()).toEqual({ [url]: "sb_live" });
  });

  it("ignores SWAGGERBOT_API_KEY and the stored key: login checks the key it is given", async () => {
    storeKey(configPath, url, "sb_old");
    const { code } = await cli(["login", "--key", "sb_unkey"], {
      env: { SWAGGERBOT_API_KEY: "sb_env" },
    });

    expect(code).toBe(0);
    expect(seen[0]?.authorization).toBe("Bearer sb_unkey");
    expect(stored()).toEqual({ [url]: "sb_unkey" });
  });

  it("says the key isn't live on a 401 and stores nothing, exit 3", async () => {
    const { code, stdout, stderr } = await cli(["login", "--key", "sb_dead"]);

    expect(code).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`
      "error  That key isn't live.
        Check the key, or get a new one at https://swaggerbot.dev/keys, then run \`swaggerbot login\`.
      "
    `);
    expect(stored()).toBeUndefined();
  });

  it("says when to retry on a 503 and stores nothing, exit 3", async () => {
    const { code, stderr } = await cli(["login", "--key", "sb_down"]);

    expect(code).toBe(3);
    expect(stderr).toMatchInlineSnapshot(`
      "error  API keys can't be checked right now.
        Retry in 30 s.
      "
    `);
    expect(stored()).toBeUndefined();
  });

  it("asks for a key when there is none to check, sending nothing, exit 2", async () => {
    const { code, stderr } = await cli(["login"], { stdin: piped("\n") });

    expect(code).toBe(2);
    expect(seen).toHaveLength(0);
    expect(stderr).toContain("No key given.");
    expect(stored()).toBeUndefined();
  });

  it("prints the server's body byte for byte with --json, and still stores on 200 only", async () => {
    const live = await cli(["login", "--key", "sb_live", "--json"]);
    expect(live.code).toBe(0);
    expect(live.stdout).toBe(`${ANSWERS.sb_live?.body}\n`);
    expect(stored()).toEqual({ [url]: "sb_live" });

    const dead = await cli(["login", "--key", "sb_dead", "--json"]);
    expect(dead.code).toBe(3);
    expect(dead.stdout).toBe(`${ANSWERS.sb_dead?.body}\n`);
    expect(dead.stderr).toBe("");
    expect(stored()).toEqual({ [url]: "sb_live" });
  });

  it("leaves a key stored for the origin alone when signing in elsewhere, keyed by origin", async () => {
    storeKey(configPath, "https://other.example", "sb_other");
    await cli(["login", "--key", "sb_live"]);

    expect(stored()).toEqual({
      "https://other.example": "sb_other",
      [url]: "sb_live",
    });
  });
});

describe("swaggerbot key", () => {
  it("sends the stored key for the origin and renders the id, credits and reset, exit 0", async () => {
    storeKey(configPath, url, "sb_live");
    const { code, stdout, stderr } = await cli(["key"]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(seen[0]?.authorization).toBe("Bearer sb_live");
    expect(stdout).toBe(
      "key_abcd2345  87 credits left today of 100  resets at 00:00 UTC, in 5 h\n",
    );
  });

  it("renders a spent key, a key without a limit, and one without figures", async () => {
    storeKey(configPath, url, "sb_spent");
    expect((await cli(["key"])).stdout).toBe(
      "key_spent  no credits left today of 100  resets at 00:00 UTC, in 5 h\n",
    );
    storeKey(configPath, url, "sb_unkey");
    expect((await cli(["key"])).stdout).toBe(
      "key_unkey  1 credit left today\n",
    );
    storeKey(configPath, url, "sb_bare");
    expect((await cli(["key"])).stdout).toBe("key_bare  credits unknown\n");
  });

  it("takes --key, then SWAGGERBOT_API_KEY, over the stored key", async () => {
    storeKey(configPath, url, "sb_live");
    await cli(["key"], { env: { SWAGGERBOT_API_KEY: "sb_unkey" } });
    expect(seen[0]?.authorization).toBe("Bearer sb_unkey");
    await cli(["key", "--key", "sb_bare"], {
      env: { SWAGGERBOT_API_KEY: "sb_unkey" },
    });
    expect(seen[1]?.authorization).toBe("Bearer sb_bare");
  });

  it("never sends the stored key to another origin: --url elsewhere has no key, exit 3", async () => {
    storeKey(configPath, url, "sb_live");
    const { code, stderr } = await cli([
      "key",
      "--url",
      "https://other.example",
    ]);

    expect(seen).toHaveLength(0);
    expect(code).toBe(3);
    expect(stderr).toMatchInlineSnapshot(`
      "error  No API key is configured for https://other.example.
        Get one at https://swaggerbot.dev/keys, then run \`swaggerbot login\`.
      "
    `);
  });

  it("says when no key is configured, sending nothing, exit 3", async () => {
    const { code, stdout, stderr } = await cli(["key"]);

    expect(seen).toHaveLength(0);
    expect(code).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      `error  No API key is configured for ${url}.\n  Get one at https://swaggerbot.dev/keys, then run \`swaggerbot login\`.\n`,
    );
  });

  it("explains a 401 for a stored key that is no longer live, exit 3", async () => {
    storeKey(configPath, url, "sb_dead");
    const { code, stderr } = await cli(["key"]);

    expect(code).toBe(3);
    expect(stderr).toContain("Unknown or revoked API key.");
    expect(stored()).toEqual({ [url]: "sb_dead" });
  });

  it("prints the body byte for byte with --json", async () => {
    storeKey(configPath, url, "sb_live");
    const { code, stdout } = await cli(["key", "--json"]);

    expect(code).toBe(0);
    expect(stdout).toBe(`${ANSWERS.sb_live?.body}\n`);
  });
});

describe("swaggerbot logout", () => {
  it("removes the origin's key and keeps the others', exit 0", async () => {
    storeKey(configPath, url, "sb_live");
    storeKey(configPath, "https://other.example", "sb_other");
    const { code, stdout } = await cli(["logout"]);

    expect(code).toBe(0);
    expect(stdout).toBe(`Signed out of ${url}: the stored key is forgotten\n`);
    expect(stored()).toEqual({ "https://other.example": "sb_other" });
    expect(seen).toHaveLength(0);
  });

  it("says when there was no key for the origin, exit 0", async () => {
    const { code, stdout } = await cli(["logout"]);

    expect(code).toBe(0);
    expect(stdout).toBe(`No key was stored for ${url}; nothing to forget\n`);
  });

  it("answers { url, removed } with --json", async () => {
    storeKey(configPath, url, "sb_live");
    expect((await cli(["logout", "--json"])).stdout).toBe(
      `${JSON.stringify({ url, removed: true })}\n`,
    );
    expect((await cli(["logout", "--json"])).stdout).toBe(
      `${JSON.stringify({ url, removed: false })}\n`,
    );
  });
});

describe("the stored key and lookup", () => {
  it("lets --fresh through with the stored key for the origin", async () => {
    storeKey(configPath, url, "sb_live");
    // The fake answers only /api/key: a 404 shows the request went out with the bearer.
    const { code } = await cli(["lookup", "Val Town", "--fresh"]);

    expect(code).toBe(3);
    expect(seen[0]).toEqual({
      method: "POST",
      url: "/api/lookup",
      authorization: "Bearer sb_live",
    });
  });
});
