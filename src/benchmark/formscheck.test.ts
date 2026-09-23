import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FormscheckOptions,
  type FormscheckRequest,
  formscheckLines,
  formscheckReport,
  type NameReport,
  parseFormscheckArgs,
  pickOperations,
  runFormscheck,
} from "./formscheck";

describe("parseFormscheckArgs", () => {
  it("reads the defaults, the key from LOADCHECK_KEY", () => {
    expect(
      parseFormscheckArgs(["https://swaggerbot.dev/"], { LOADCHECK_KEY: "s" }),
    ).toEqual({
      ok: true,
      help: false,
      options: {
        baseUrl: "https://swaggerbot.dev",
        names: ["GitHub", "Stripe", "Cloudflare"],
        key: "s",
        rps: 0.8,
        json: false,
      },
    });
  });

  it("reads --names and --json; no key without LOADCHECK_KEY", () => {
    expect(
      parseFormscheckArgs([
        "http://localhost:3000",
        "--names",
        " Stripe , Neon ,",
        "--json",
      ]),
    ).toMatchObject({
      ok: true,
      options: { names: ["Stripe", "Neon"], key: undefined, json: true },
    });
  });

  it("answers --help without a URL", () => {
    expect(parseFormscheckArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it.each([
    [[], "missing URL"],
    [["https://x.dev", "--nope"], "unknown flag"],
    [["https://x.dev", "--names", " , "], "no names"],
    [["ftp://x.dev"], "not http(s)"],
    [["not a url"], "not a URL"],
    [["https://x.dev", "https://y.dev"], "two URLs"],
  ])("exits 2 on %j (%s)", (args) => {
    expect(parseFormscheckArgs(args)).toMatchObject({ ok: false, exitCode: 2 });
  });
});

describe("pickOperations", () => {
  it("takes the first, the last and 3 evenly spaced between them", () => {
    const ops = Array.from({ length: 12 }, (_, i) => i);
    expect(pickOperations(ops)).toEqual([0, 3, 6, 8, 11]);
    const many = Array.from({ length: 101 }, (_, i) => i);
    expect(pickOperations(many)).toEqual([0, 25, 50, 75, 100]);
  });

  it("takes all of 5 or fewer", () => {
    expect(pickOperations([1, 2, 3])).toEqual([1, 2, 3]);
    expect(pickOperations([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(pickOperations([])).toEqual([]);
  });
});

function nameReport(more: Partial<NameReport> = {}): NameReport {
  return {
    name: "Acme",
    outline: { ms: 100, bytes: 10, operationCount: 5 },
    published: { ms: 1000, bytes: 10, sha256Matches: true },
    normalized: { ms: 1000, bytes: 10, openapi: "3.1.0" },
    operations: [
      { ms: 300, bytes: 10, method: "get", path: "/a", truncated: false },
    ],
    failures: [],
    ...more,
  };
}

describe("formscheckReport", () => {
  it("passes under every target", () => {
    const report = formscheckReport("https://x.dev", [nameReport()], []);
    expect(report).toMatchObject({
      outlineP90: 100,
      operationP90: 300,
      failures: [],
      pass: true,
    });
    expect(formscheckLines(report).at(-1)).toBe("PASS");
  });

  it("fails an outline p90 of 500 ms, an operation p90 of 2 s, a 60.1 s download", () => {
    const report = formscheckReport(
      "https://x.dev",
      [
        nameReport({
          outline: { ms: 500, bytes: 10, operationCount: 5 },
          normalized: { ms: 60_100, bytes: 10, openapi: "3.1.0" },
          operations: [
            {
              ms: 2_000,
              bytes: 10,
              method: "get",
              path: "/a",
              truncated: true,
            },
          ],
        }),
      ],
      [],
    );
    expect(report.pass).toBe(false);
    expect(report.failures).toEqual([
      "outline p90 500 ms is not under 500 ms",
      "operation p90 2.0 s is not under 2.0 s",
      "Acme: the Normalized Form took 60.1 s to download, over 60.0 s",
    ]);
    expect(formscheckLines(report).join("\n")).toMatch(
      /truncated[\s\S]*\nFAIL\n {2}outline p90/,
    );
  });

  it("fails a name with a failed step, and lists the non-2xx answers", () => {
    const requests: FormscheckRequest[] = [
      {
        name: "Acme",
        step: "pending",
        method: "GET",
        path: "/api/apis/a/b/outline",
        ms: 5,
        status: 409,
        bytes: 20,
      },
      {
        name: "Acme",
        step: "outline",
        method: "GET",
        path: "/api/apis/a/b/outline",
        ms: 5,
        status: 200,
        bytes: 20,
      },
    ];
    const report = formscheckReport(
      "https://x.dev",
      [nameReport({ failures: ["lookup: the Outcome is Unknown"] })],
      requests,
    );
    expect(report.failures).toEqual(["Acme: lookup: the Outcome is Unknown"]);
    expect(report.non2xx).toEqual([requests[0]]);
    expect(report.pass).toBe(false);
  });

  it("fails with no names checked", () => {
    expect(formscheckReport("https://x.dev", [], []).pass).toBe(false);
  });
});

type FakeSpec = {
  /** The Published Form's bytes. */
  published?: string;
  /** The Spec id the Outcome gives; the sha256 of `published` by default. */
  specId?: string;
  normalizedDoc?: object;
  /** The Current Spec's `normalized` in the Outcome. */
  normalized?: "ready" | "pending";
  /** 409s the outline answers before its first 200. */
  pendingOutlines?: number;
  operationCount?: number;
  outcome?: string;
  /** The Vendor's APIs list this API. */
  listed?: boolean;
  /** The 1-based requests (over all) that answer 429 with this retry-after. */
  limitAt?: number[];
  retryAfter?: string;
};

type Seen = { method: string; url: string; auth?: string };

/** A fake swagger.bot on port 0 serving one API, `acme.com/widgets`. */
async function fakeService(fake: FakeSpec = {}) {
  const published = fake.published ?? '{"openapi":"3.0.3","paths":{}}';
  const specId =
    fake.specId ?? createHash("sha256").update(published).digest("hex");
  const operations = Array.from(
    { length: fake.operationCount ?? 12 },
    (_, i) => ({ method: i % 2 ? "post" : "get", path: `/w/${i}`, tags: [] }),
  );
  const seen: Seen[] = [];
  let outlines = 0;
  const server: Server = createServer(async (req, res) => {
    for await (const _ of req);
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      auth: req.headers.authorization,
    });
    const json = (status: number, data: object, headers = {}) =>
      res
        .writeHead(status, { "content-type": "application/json", ...headers })
        .end(JSON.stringify(data));
    if (fake.limitAt?.includes(seen.length))
      return json(
        429,
        { error: "Rate limit exceeded." },
        { "retry-after": fake.retryAfter ?? "1" },
      );
    const url = new URL(req.url ?? "/", "http://x");
    switch (url.pathname) {
      case "/api/lookup":
        return json(200, {
          outcome: fake.outcome ?? "Resolved",
          api: {
            id: "acme.com/widgets",
            vendorId: "acme.com",
            name: "Widgets",
          },
          currentSpec: {
            id: specId,
            normalized: fake.normalized ?? "ready",
            downloads: {
              published: `/api/specs/${specId}/published`,
              normalized: `/api/specs/${specId}/normalized`,
            },
          },
        });
      case `/api/specs/${specId}/published`:
        return res.writeHead(200).end(published);
      case `/api/specs/${specId}/normalized`:
        return json(200, fake.normalizedDoc ?? { openapi: "3.1.0", paths: {} });
      case "/api/apis/acme.com/widgets/outline":
        if (outlines++ < (fake.pendingOutlines ?? 0))
          return json(409, { status: "pending" }, { "retry-after": "10" });
        return json(200, { specId, outline: { operations } });
      case "/api/apis/acme.com/widgets/operation":
        return json(200, {
          method: url.searchParams.get("method"),
          path: url.searchParams.get("path"),
          operation: {},
          truncated: url.searchParams.get("path") === "/w/11",
        });
      case "/api/vendors/acme.com/apis":
        return json(200, {
          apis:
            fake.listed === false ? [] : [{ api: { id: "acme.com/widgets" } }],
        });
      default:
        return json(404, { error: "No such route." });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${port}`, seen, specId };
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
  more: Partial<FormscheckOptions> = {},
): FormscheckOptions {
  return { baseUrl, names: ["Acme"], rps: 1000, json: false, ...more };
}

/** A `sleep` that records each wait and returns at once. */
function recordingSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe("runFormscheck against a local service", () => {
  it("runs every step and passes", async () => {
    const service = await fakeService();
    const report = await runFormscheck(options(service.baseUrl, { key: "k" }));

    expect(report.failures).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.non2xx).toEqual([]);
    const [acme] = report.names;
    expect(acme).toMatchObject({
      apiId: "acme.com/widgets",
      vendorId: "acme.com",
      specId: service.specId,
      lookup: { outcome: "Resolved" },
      published: { sha256Matches: true, bytes: 30 },
      normalized: { openapi: "3.1.0" },
      outline: { operationCount: 12 },
      vendorApis: { listed: true },
    });
    expect(acme?.pendingWaitMs).toBeUndefined();

    // The first, the last and 3 evenly spaced of the 12 operations.
    expect(
      acme?.operations.map((o) => [o.method, o.path, o.truncated]),
    ).toEqual([
      ["get", "/w/0", false],
      ["post", "/w/3", false],
      ["get", "/w/6", false],
      ["get", "/w/8", false],
      ["post", "/w/11", true],
    ]);
    expect(service.seen.map((s) => s.url.split("?")[0])).toEqual([
      "/api/lookup",
      `/api/specs/${service.specId}/published`,
      `/api/specs/${service.specId}/normalized`,
      "/api/apis/acme.com/widgets/outline",
      ...Array(5).fill("/api/apis/acme.com/widgets/operation"),
      "/api/vendors/acme.com/apis",
    ]);
    // Only the Lookup carries the key.
    expect(service.seen.map((s) => s.auth)).toEqual([
      "Bearer k",
      ...Array(9).fill(undefined),
    ]);
    expect(
      new URL(service.seen[4]?.url ?? "", "http://x").searchParams.get(
        "specId",
      ),
    ).toBe(service.specId);
  });

  it("fails on a sha256 mismatch", async () => {
    const service = await fakeService({ specId: "0".repeat(64) });
    const report = await runFormscheck(options(service.baseUrl));
    expect(report.names[0]?.published?.sha256Matches).toBe(false);
    expect(report.pass).toBe(false);
    expect(report.failures).toEqual([
      expect.stringMatching(
        /^Acme: published: the sha256 of the bytes is [0-9a-f]{64}, not the Spec id 0{64}$/,
      ),
    ]);
  });

  it("fails a Normalized Form that isn't OpenAPI 3.1", async () => {
    const service = await fakeService({ normalizedDoc: { openapi: "3.0.3" } });
    const report = await runFormscheck(options(service.baseUrl));
    expect(report.failures).toEqual([
      "Acme: normalized: openapi is 3.0.3, not 3.1.x",
    ]);
  });

  it("fails when the Outcome isn't Resolved, and stops that name there", async () => {
    const service = await fakeService({ outcome: "Unknown" });
    const report = await runFormscheck(options(service.baseUrl));
    expect(report.failures).toEqual([
      "Acme: lookup: the Outcome is Unknown, not Resolved",
    ]);
    expect(service.seen).toHaveLength(1);
  });

  it("fails when the Vendor's APIs don't list the API", async () => {
    const service = await fakeService({ listed: false });
    const report = await runFormscheck(options(service.baseUrl));
    expect(report.failures).toEqual([
      "Acme: vendor APIs: acme.com's APIs don't list acme.com/widgets",
    ]);
  });

  it("waits out pending forms: a 409 then a 200 on the outline", async () => {
    const service = await fakeService({
      normalized: "pending",
      pendingOutlines: 1,
    });
    const { waits, sleep } = recordingSleep();
    const report = await runFormscheck(options(service.baseUrl), { sleep });
    expect(report.failures).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.names[0]?.pendingWaitMs).toBeGreaterThanOrEqual(0);
    // One 5 s wait between the 409 and the 200.
    expect(waits.filter((w) => w >= 100)).toEqual([5_000]);
    expect(report.non2xx.map((r) => [r.step, r.status])).toEqual([
      ["pending", 409],
    ]);
    expect(service.seen.slice(0, 4).map((s) => s.url.split("?")[0])).toEqual([
      "/api/lookup",
      "/api/apis/acme.com/widgets/outline",
      "/api/apis/acme.com/widgets/outline",
      `/api/specs/${service.specId}/published`,
    ]);
  });

  it("gives up on forms still pending after 2 minutes", async () => {
    const service = await fakeService({
      normalized: "pending",
      pendingOutlines: 1_000,
    });
    const { waits, sleep } = recordingSleep();
    const report = await runFormscheck(options(service.baseUrl), { sleep });
    expect(waits.filter((w) => w === 5_000)).toHaveLength(24);
    expect(report.failures).toEqual([
      "Acme: the forms were still pending after 120.0 s",
    ]);
  });

  it("retries a 429 after its retry-after", async () => {
    // Request 2 is the Published download.
    const service = await fakeService({ limitAt: [2], retryAfter: "3" });
    const { waits, sleep } = recordingSleep();
    const report = await runFormscheck(options(service.baseUrl), { sleep });
    expect(report.pass).toBe(true);
    expect(report.non2xx.map((r) => [r.step, r.status])).toEqual([
      ["published", 429],
    ]);
    expect(service.seen.slice(1, 3).map((s) => s.url)).toEqual([
      `/api/specs/${service.specId}/published`,
      `/api/specs/${service.specId}/published`,
    ]);
    const long = waits.filter((w) => w >= 100);
    expect(long).toHaveLength(1);
    expect(long[0]).toBeGreaterThan(2_900);
    expect(long[0]).toBeLessThanOrEqual(3_000);
  });

  it("paces its requests at rps", async () => {
    const service = await fakeService();
    const { waits, sleep } = recordingSleep();
    await runFormscheck(options(service.baseUrl, { rps: 10 }), { sleep });
    // A recording sleep returns at once, so every request after the first waits.
    expect(waits).toHaveLength(service.seen.length - 1);
    for (const w of waits) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(100);
    }
  });

  it("counts an unreachable service as a failure", async () => {
    const service = await fakeService();
    const closed = servers.pop() as Server;
    closed.closeAllConnections();
    await new Promise((r) => closed.close(r));
    const report = await runFormscheck(options(service.baseUrl));
    expect(report.pass).toBe(false);
    expect(report.non2xx[0]?.status).toBeNull();
    expect(report.failures[0]).toMatch(/^Acme: lookup: no response on POST/);
  });
});
