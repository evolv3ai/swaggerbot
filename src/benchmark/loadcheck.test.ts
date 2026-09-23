import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  type LoadcheckOptions,
  type LoadcheckRequest,
  loadcheckReport,
  parseLoadcheckArgs,
  phaseReport,
  reportLines,
  runLoadcheck,
} from "./loadcheck";

describe("parseLoadcheckArgs", () => {
  it("reads the defaults, the key from LOADCHECK_KEY", () => {
    expect(
      parseLoadcheckArgs(["https://swaggerbot.dev/"], { LOADCHECK_KEY: "s" }),
    ).toEqual({
      ok: true,
      help: false,
      options: {
        baseUrl: "https://swaggerbot.dev",
        key: "s",
        only: undefined,
        rounds: 5,
        rps: 0.8,
        json: false,
      },
    });
  });

  it("reads every flag; --key wins over LOADCHECK_KEY", () => {
    const parsed = parseLoadcheckArgs(
      [
        "http://localhost:3000",
        "--key",
        "k",
        "--only",
        "discovery",
        "--rounds=2",
        "--rps",
        "0.5",
        "--json",
      ],
      { LOADCHECK_KEY: "env" },
    );
    expect(parsed).toMatchObject({
      ok: true,
      options: {
        baseUrl: "http://localhost:3000",
        key: "k",
        only: "discovery",
        rounds: 2,
        rps: 0.5,
        json: true,
      },
    });
  });

  it("needs no key for --only index", () => {
    expect(
      parseLoadcheckArgs(["https://x.dev", "--only", "index"]),
    ).toMatchObject({ ok: true, options: { key: undefined, only: "index" } });
  });

  it("answers --help without a URL", () => {
    expect(parseLoadcheckArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it.each([
    [[], "missing URL"],
    [["https://x.dev", "--key", "k", "--nope"], "unknown flag"],
    [["https://x.dev", "--key", "k", "--rps", "0"], "zero --rps"],
    [["https://x.dev", "--key", "k", "--rps", "fast"], "bad --rps"],
    [["https://x.dev", "--key", "k", "--rps", "-1"], "negative --rps"],
    [["https://x.dev", "--key", "k", "--rounds", "0"], "zero --rounds"],
    [["https://x.dev", "--key", "k", "--rounds", "1.5"], "bad --rounds"],
    [["https://x.dev", "--key", "k", "--only", "both"], "bad --only"],
    [["ftp://x.dev", "--key", "k"], "not http(s)"],
    [["not a url", "--key", "k"], "not a URL"],
    [["https://x.dev", "https://y.dev", "--key", "k"], "two URLs"],
    [["https://x.dev"], "Discovery without a key"],
    [["https://x.dev", "--key", " "], "an empty key"],
  ])("exits 2 on %j (%s)", (args) => {
    expect(parseLoadcheckArgs(args)).toMatchObject({ ok: false, exitCode: 2 });
  });
});

function req(
  phase: LoadcheckRequest["phase"],
  ms: number,
  status: number | null = 200,
): LoadcheckRequest {
  return { name: "x", phase, ms, status };
}

describe("phaseReport", () => {
  it("passes Index answers with p90 under 200 ms", () => {
    // Nearest rank: the 9th of 10 sorted values is the p90.
    const ms = [10, 20, 30, 40, 50, 60, 70, 80, 199, 900];
    const report = phaseReport(
      "index",
      ms.map((m) => req("index", m)),
    );
    expect(report).toMatchObject({
      count: 10,
      p50: 50,
      p90: 199,
      max: 900,
      targetMs: 200,
      pass: true,
    });
  });

  it("fails at exactly the target", () => {
    const ms = [10, 20, 30, 40, 50, 60, 70, 80, 200, 210];
    expect(
      phaseReport(
        "index",
        ms.map((m) => req("index", m)),
      ).pass,
    ).toBe(false);
  });

  it("checks Discovery against 15 s", () => {
    const pass = phaseReport("discovery", [
      req("discovery", 6_700),
      req("discovery", 14_999),
    ]);
    expect(pass).toMatchObject({ p90: 14_999, targetMs: 15_000, pass: true });
    const fail = phaseReport("discovery", [
      req("discovery", 6_700),
      req("discovery", 23_200),
    ]);
    expect(fail).toMatchObject({ p90: 23_200, pass: false });
  });

  it("measures only 200s and counts errors, 429s and skipped 401s apart", () => {
    const requests = [
      req("index", 5),
      req("index", 5000, 429),
      req("index", 7, 401),
      req("index", 9000, null),
      req("index", 8, 500),
      req("discovery", 10_000),
    ];
    expect(phaseReport("index", requests, { skip401: true })).toMatchObject({
      requests: 5,
      count: 1,
      max: 5,
      errors: 2,
      rateLimited: 1,
      skipped: 1,
      pass: true,
    });
    expect(phaseReport("index", requests)).toMatchObject({
      errors: 3,
      skipped: 0,
    });
  });

  it("fails a phase with nothing measured", () => {
    expect(phaseReport("index", [req("index", 5, 429)]).pass).toBe(false);
  });
});

describe("loadcheckReport", () => {
  it("fails when either phase fails, and judges only the phases run", () => {
    const requests = [req("discovery", 20_000), req("index", 10)];
    const both = loadcheckReport("https://x.dev", requests);
    expect(both.discovery?.pass).toBe(false);
    expect(both.index?.pass).toBe(true);
    expect(both.pass).toBe(false);
    const onlyIndex = loadcheckReport("https://x.dev", requests, {
      only: "index",
    });
    expect(onlyIndex.discovery).toBeUndefined();
    expect(onlyIndex.pass).toBe(true);
    expect(reportLines(both).join("\n")).toMatch(
      /Discovery .*p90 20\.0 s.*FAIL\nIndex .*p90 10 ms.*PASS$/,
    );
  });
});

type Seen = { name: string; fresh: boolean; auth?: string };

/**
 * A fake `POST /api/lookup` on port 0. Discovery (`fresh`) needs a key and
 * answers each name's Outcome after 30 ms, storing the Resolved ones; an
 * Index answer takes 5 ms, and a name the Index doesn't hold is a 401.
 * The requests listed in `limitAt` (1-based, counted over all) are 429s.
 */
async function fakeService(
  outcomes: Record<string, string>,
  { limitAt = [] as number[], quota = Number.POSITIVE_INFINITY } = {},
) {
  const index = new Set<string>();
  const seen: Seen[] = [];
  let used = 0;
  const server: Server = createServer(async (httpReq: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of httpReq) raw += chunk;
    const body = JSON.parse(raw) as { name: string; fresh?: boolean };
    const auth = httpReq.headers.authorization;
    seen.push({ name: body.name, fresh: body.fresh === true, auth });
    const json = (status: number, data: object, headers = {}) =>
      res
        .writeHead(status, { "content-type": "application/json", ...headers })
        .end(JSON.stringify(data));
    if (httpReq.url !== "/api/lookup") return json(404, { error: "no" });
    if (limitAt.includes(seen.length))
      return json(
        429,
        { error: "Rate limit exceeded." },
        { "retry-after": "0" },
      );
    if (!body.fresh && index.has(body.name)) {
      await new Promise((r) => setTimeout(r, 5));
      return json(200, { outcome: "Resolved" });
    }
    if (auth !== "Bearer secret")
      return json(401, { error: "Discovery needs an API key." });
    used++;
    const quotaHeaders = {
      "x-quota-limit": String(quota),
      "x-quota-remaining": String(Math.max(0, quota - used)),
    };
    if (used > quota)
      return json(429, { error: "Daily quota used." }, quotaHeaders);
    await new Promise((r) => setTimeout(r, 30));
    const outcome = outcomes[body.name] ?? "Unknown";
    if (outcome === "Resolved") index.add(body.name);
    return json(200, { outcome }, quotaHeaders);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${port}`, seen, index };
}

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

function options(
  baseUrl: string,
  more: Partial<LoadcheckOptions> = {},
): LoadcheckOptions {
  return { baseUrl, key: "secret", rounds: 2, rps: 1000, json: false, ...more };
}

describe("runLoadcheck against a local service", () => {
  const outcomes = { Stripe: "Resolved", Nowhere: "Unknown", Neon: "Resolved" };
  const names = ["Stripe", "Nowhere", "Neon"];

  it("runs Discovery, then Index rounds over the Resolved names", async () => {
    // Request 5 is the second Index request.
    const service = await fakeService(outcomes, { limitAt: [5] });
    const warnings: string[] = [];
    const report = await runLoadcheck(options(service.baseUrl), names, {
      warn: (m) => warnings.push(m),
    });

    expect(report.discovery).toMatchObject({
      requests: 3,
      count: 3,
      errors: 0,
      rateLimited: 0,
      pass: true,
    });
    expect(report.discovery?.p50).toBeGreaterThanOrEqual(25);
    // 2 rounds over Stripe and Neon; one of the 4 is a 429.
    expect(report.index).toMatchObject({
      requests: 4,
      count: 3,
      errors: 0,
      rateLimited: 1,
      pass: true,
    });
    expect(report.pass).toBe(true);
    expect(warnings).toEqual([]);

    // Discovery is fresh with the key; Index requests go without one.
    expect(service.seen.slice(0, 3)).toEqual(
      names.map((name) => ({ name, fresh: true, auth: "Bearer secret" })),
    );
    expect(service.seen.slice(3)).toEqual(
      ["Stripe", "Neon", "Stripe", "Neon"].map((name) => ({
        name,
        fresh: false,
        auth: undefined,
      })),
    );
    expect(
      report.requests.map((r) => [r.phase, r.name, r.status, r.outcome]),
    ).toEqual([
      ["discovery", "Stripe", 200, "Resolved"],
      ["discovery", "Nowhere", 200, "Unknown"],
      ["discovery", "Neon", 200, "Resolved"],
      ["index", "Stripe", 200, "Resolved"],
      ["index", "Neon", 429, undefined],
      ["index", "Stripe", 200, "Resolved"],
      ["index", "Neon", 200, "Resolved"],
    ]);
  });

  it("with --only index, asks every name and skips the ones that 401", async () => {
    const service = await fakeService(outcomes);
    service.index.add("Stripe");
    const report = await runLoadcheck(
      options(service.baseUrl, { key: undefined, only: "index", rounds: 3 }),
      names,
    );
    expect(report.discovery).toBeUndefined();
    // Round 1 asks all 3 names; Nowhere and Neon 401 and are dropped.
    expect(report.index).toMatchObject({
      requests: 5,
      count: 3,
      skipped: 2,
      errors: 0,
      pass: true,
    });
    expect(service.seen.every((s) => !s.fresh && !s.auth)).toBe(true);
  });

  it("stops Discovery once the key's quota is used", async () => {
    const service = await fakeService(outcomes, { quota: 1 });
    const warnings: string[] = [];
    const report = await runLoadcheck(
      options(service.baseUrl, { only: "discovery" }),
      names,
      { warn: (m) => warnings.push(m) },
    );
    expect(report.discovery).toMatchObject({
      requests: 2,
      count: 1,
      rateLimited: 1,
    });
    expect(report.index).toBeUndefined();
    expect(warnings).toEqual([
      "The key has 0 Lookups left today; Discovery needs 2 more.",
      "The key's daily quota is used; Discovery stopped after 2 of 3.",
    ]);
  });

  it("paces requests at --rps", async () => {
    const service = await fakeService(outcomes);
    service.index.add("Stripe");
    const waits: number[] = [];
    await runLoadcheck(
      options(service.baseUrl, { only: "index", rounds: 3, rps: 10 }),
      ["Stripe"],
      {
        sleep: async (ms) => {
          waits.push(ms);
          await new Promise((r) => setTimeout(r, ms));
        },
      },
    );
    expect(waits).toHaveLength(2);
    for (const w of waits) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(100);
    }
  });

  it("counts an unreachable service as errors and fails", async () => {
    const service = await fakeService(outcomes);
    const closed = servers.pop() as Server;
    closed.closeAllConnections();
    await new Promise((r) => closed.close(r));
    const report = await runLoadcheck(
      options(service.baseUrl, { only: "index", rounds: 1 }),
      ["Stripe"],
    );
    expect(report.index).toMatchObject({ requests: 1, count: 0, errors: 1 });
    expect(report.requests[0]?.status).toBeNull();
    expect(report.pass).toBe(false);
  });
});
