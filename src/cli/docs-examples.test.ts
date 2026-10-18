import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLI_COMMANDS } from "../components/docs/cli-reference";
import { BASE_URL, EXAMPLES } from "../components/docs/reference";
import { runCli } from "./main";
import type { Io } from "./render";

/** A request the fake saw: method, path and query, the bearer, the body. */
type Seen = {
  method: string;
  url: URL;
  authorization?: string;
  body: string;
};

let server: Server;
let url = "";
let seen: Seen[] = [];
/** What the fake answers the first request with: the docs' recorded answer. */
let answer = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: new URL(req.url ?? "/", url),
        authorization: req.headers.authorization,
        body,
      });
      if (seen.length > 1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found."}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(answer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  seen = [];
});

/** A command line split into its words, as a shell would split these examples. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? "");
}

/** A docs `curl` read back: its method, URL and `-d` body. */
function curlOf(curl: string) {
  const parts = words(curl.replaceAll("'", '"'));
  const target = parts.find((p) => p.startsWith(BASE_URL)) ?? "";
  const data = curl.match(/-d '([^']*)'/)?.[1];
  return {
    method: parts.includes("-X") ? parts[parts.indexOf("-X") + 1] : "GET",
    url: new URL(target.replace(BASE_URL, "http://docs.example")),
    body: data,
  };
}

/** Runs the CLI against the fake with a key given, capturing what it writes. */
async function cli(args: string[]) {
  let stdout = "";
  const io: Io = {
    stdout: { write: (chunk) => (stdout += String(chunk)) },
    stderr: { write: () => true },
    isTTY: false,
    stderrIsTTY: false,
    env: {
      SWAGGERBOT_URL: url,
      SWAGGERBOT_API_KEY: "sb_docs_example",
      SWAGGERBOT_CONFIG: join(
        mkdtempSync(join(tmpdir(), "swaggerbot-docs-")),
        "config.json",
      ),
    },
  };
  const code = await runCli(args, io);
  return { code, stdout };
}

describe("the CLI section of /docs", () => {
  for (const row of CLI_COMMANDS) {
    it(`runs ${row.example} against the route its example calls`, async () => {
      const example = EXAMPLES.find((e) => e.id === row.calls);
      expect(row.calls === undefined || example !== undefined).toBe(true);
      answer = example?.answer ?? "";
      // `login` is asked for a key it would otherwise prompt for.
      const args = [
        ...words(row.example).slice(1),
        ...(row.command === "login" ? ["--key", "sb_docs_example"] : []),
        "--json",
      ];
      if (row.command === "spec")
        args.splice(
          args.indexOf("-o") + 1,
          1,
          join(mkdtempSync(join(tmpdir(), "swaggerbot-docs-")), "openapi.json"),
        );

      const { code, stdout } = await cli(args);

      if (!example) {
        expect(seen).toEqual([]);
        expect(code).toBe(0);
        return;
      }
      const want = curlOf(example.curl);
      const got = seen[0];
      expect(got?.method).toBe(want.method);
      expect(got?.url.pathname).toBe(want.url.pathname);
      for (const [name, value] of want.url.searchParams)
        expect(got?.url.searchParams.get(name), name).toBe(value);
      if (want.body)
        expect(JSON.parse(got?.body ?? "")).toEqual(JSON.parse(want.body));
      if (example.curl.includes("Authorization: Bearer"))
        expect(got?.authorization).toBe("Bearer sb_docs_example");

      // `--json` prints the same JSON as the HTTP API: the recorded answer,
      // where the docs give it whole (not abridged, not a download).
      let recorded: unknown;
      try {
        recorded = JSON.parse(answer);
      } catch {
        return;
      }
      if (row.command === "spec") return;
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual(recorded);
    });
  }
});
