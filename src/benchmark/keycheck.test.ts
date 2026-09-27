import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  type KeycheckOptions,
  keycheckLines,
  madeUpKey,
  parseKeycheckArgs,
  runKeycheck,
} from "./keycheck";

describe("parseKeycheckArgs", () => {
  it("reads the defaults, the key from KEYCHECK_KEY, the root key from UNKEY_ROOT_KEY", () => {
    expect(
      parseKeycheckArgs(["https://swaggerbot.dev/"], {
        KEYCHECK_KEY: " sb_k ",
        UNKEY_ROOT_KEY: "root",
      }),
    ).toEqual({
      ok: true,
      help: false,
      options: {
        baseUrl: "https://swaggerbot.dev",
        name: "Val Town",
        key: "sb_k",
        rootKey: "root",
        json: false,
      },
    });
  });

  it("reads --name and --json; no root key without UNKEY_ROOT_KEY", () => {
    expect(
      parseKeycheckArgs(
        ["http://localhost:3000", "--name", "Stripe", "--json"],
        {
          KEYCHECK_KEY: "sb_k",
        },
      ),
    ).toMatchObject({
      ok: true,
      options: { name: "Stripe", rootKey: undefined, json: true },
    });
  });

  it("answers --help without a URL or a key", () => {
    expect(parseKeycheckArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it.each<[string[], Record<string, string>, string]>([
    [[], { KEYCHECK_KEY: "sb_k" }, "missing URL"],
    [["https://x.dev"], {}, "no KEYCHECK_KEY"],
    [["https://x.dev"], { KEYCHECK_KEY: " " }, "blank KEYCHECK_KEY"],
    [["https://x.dev", "--nope"], { KEYCHECK_KEY: "sb_k" }, "unknown flag"],
    [["https://x.dev", "--name", " "], { KEYCHECK_KEY: "sb_k" }, "no name"],
    [["ftp://x.dev"], { KEYCHECK_KEY: "sb_k" }, "not http(s)"],
    [["https://x.dev", "https://y.dev"], { KEYCHECK_KEY: "sb_k" }, "two URLs"],
  ])("exits 2 on %j with %j (%s)", (args, env) => {
    expect(parseKeycheckArgs(args, env)).toMatchObject({
      ok: false,
      exitCode: 2,
    });
  });
});

describe("madeUpKey", () => {
  it("reads like a key and differs each time", () => {
    expect(madeUpKey()).toMatch(/^sb_keycheck[0-9a-f]{24}$/);
    expect(madeUpKey()).not.toBe(madeUpKey());
  });
});

/** How the fake `POST /api/lookup` misbehaves, for the failing reports. */
type Fault = "index-spends" | "discovery-free" | "accepts-any-key" | "no-index";

const KEY = "sb_live";

/**
 * A fake `POST /api/lookup` on port 0 with one live key and its credits:
 * the Index knows "Val Town"; any other name, or `fresh`, is Discovery,
 * 401 without a key and one credit with it; a key other than `KEY` is 401.
 */
async function fakeServer(fault?: Fault) {
  const state = {
    credits: 10,
    requests: [] as { auth?: string; body: unknown }[],
  };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = JSON.parse(raw) as { name: string; fresh?: boolean };
      const auth = req.headers.authorization;
      state.requests.push({ auth, body });
      const send = (
        status: number,
        json: unknown,
        headers: Record<string, string> = {},
      ) => {
        res.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        });
        res.end(JSON.stringify(json));
      };
      const secret = auth?.replace(/^Bearer /, "");
      if (secret !== undefined && secret !== KEY && fault !== "accepts-any-key")
        return send(401, { error: "Unknown or revoked API key." });
      const indexed =
        body.name === "Val Town" && !body.fresh && fault !== "no-index";
      if (indexed) {
        if (secret && fault === "index-spends") state.credits -= 1;
        return send(200, { outcome: "Resolved" });
      }
      if (!secret) return send(401, { error: "Discovery needs an API key." });
      if (fault !== "discovery-free") state.credits -= 1;
      return send(
        200,
        { outcome: "Resolved" },
        { "x-quota-remaining": String(state.credits) },
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { state, baseUrl: `http://127.0.0.1:${port}` };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(r))),
  );
});

function optionsFor(baseUrl: string): KeycheckOptions {
  return { baseUrl, name: "Val Town", key: KEY, json: false };
}

describe("runKeycheck", () => {
  it("passes against a server that keeps the key rules, spending one credit", async () => {
    const { state, baseUrl } = await fakeServer();
    const report = await runKeycheck(optionsFor(baseUrl), {
      readCredits: async () => state.credits,
      madeUpKey: "sb_madeup",
    });
    expect(report.failures).toEqual([]);
    expect(report.pass).toBe(true);
    expect(state.credits).toBe(9);
    expect(state.requests).toEqual([
      { auth: undefined, body: { name: "Val Town" } },
      { auth: "Bearer sb_live", body: { name: "Val Town" } },
      { auth: "Bearer sb_live", body: { name: "Val Town", fresh: true } },
      { auth: "Bearer sb_madeup", body: { name: "Val Town" } },
    ]);
    expect(report.steps.map((s) => [s.check, s.status])).toEqual([
      ["keyless Index Lookup", 200],
      ["keyed Index Lookup", 200],
      ["keyed Discovery Lookup", 200],
      ["made-up sb_ key", 401],
    ]);

    const lines = keycheckLines(report);
    expect(lines[0]).toBe(`Key check: ${baseUrl}/api/lookup ("Val Town")`);
    expect(lines[1]).toMatch(/^Credits read through Unkey/);
    expect(lines).toContainEqual(
      expect.stringMatching(/keyed Index Lookup .*credits 10 → 10/),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /keyed Discovery Lookup .*x-quota-remaining 9 · credits 10 → 9/,
      ),
    );
    expect(lines.at(-1)).toBe("PASS");
  });

  it("passes without reading credits, and says the credit checks are skipped", async () => {
    const { baseUrl } = await fakeServer();
    const report = await runKeycheck(optionsFor(baseUrl));
    expect(report.pass).toBe(true);
    expect(report.creditsRead).toBe(false);
    expect(keycheckLines(report)[1]).toMatch(/credit checks are skipped/);
  });

  it.each<[Fault, RegExp]>([
    ["index-spends", /keyed Index Lookup: the key's credits went from 10 to 9/],
    [
      "discovery-free",
      /keyed Discovery Lookup: the key's credits went from 10 to 10; a Discovery spends one/,
    ],
    ["accepts-any-key", /made-up sb_ key: answered 200, not 401/],
    ["no-index", /keyless Index Lookup: answered 401, not 200/],
  ])("fails when the server %s", async (fault, failure) => {
    const { state, baseUrl } = await fakeServer(fault);
    const report = await runKeycheck(optionsFor(baseUrl), {
      readCredits: async () => state.credits,
    });
    expect(report.pass).toBe(false);
    expect(report.failures).toContainEqual(expect.stringMatching(failure));
    const lines = keycheckLines(report);
    expect(lines).toContain("FAIL");
    expect(lines).toContainEqual(expect.stringMatching(failure));
  });

  it("fails when the key's credits can't be read, or it has none", async () => {
    const { baseUrl } = await fakeServer();
    const unreadable = await runKeycheck(optionsFor(baseUrl), {
      readCredits: async () => {
        throw new Error("Unkey 404");
      },
    });
    expect(unreadable.pass).toBe(false);
    expect(unreadable.failures[0]).toMatch(
      /reading the key's credits before the keyed Index Lookup: Unkey 404/,
    );

    const unlimited = await runKeycheck(optionsFor(baseUrl), {
      readCredits: async () => null,
    });
    expect(unlimited.failures).toEqual([
      "the key has no credits (unlimited): its Discovery Lookups aren't counted",
    ]);
  });

  it("skips the keyed Lookups, spending nothing, when the Index doesn't answer the name", async () => {
    const { state, baseUrl } = await fakeServer("no-index");
    const report = await runKeycheck(optionsFor(baseUrl), {
      readCredits: async () => state.credits,
    });
    expect(state.credits).toBe(10);
    expect(state.requests.map((r) => r.auth)).toEqual([
      undefined,
      expect.stringMatching(/^Bearer sb_keycheck/),
    ]);
    expect(report.failures).toEqual([
      "keyless Index Lookup: answered 401, not 200",
      '"Val Town" isn\'t answered from the Index: the keyed Lookups were skipped (pick a name the Index knows with --name)',
    ]);
  });

  it("fails every step it runs when the server can't be reached", async () => {
    const report = await runKeycheck(optionsFor("http://127.0.0.1:9"));
    expect(report.pass).toBe(false);
    expect(report.steps.map((s) => s.check)).toEqual([
      "keyless Index Lookup",
      "made-up sb_ key",
    ]);
    expect(report.steps.every((s) => s.status === undefined && s.error)).toBe(
      true,
    );
    expect(keycheckLines(report)).toContainEqual(
      expect.stringMatching(/keyless Index Lookup +--- \(want 200\)/),
    );
  });
});
