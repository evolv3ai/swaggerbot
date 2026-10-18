import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXAMPLES } from "../components/docs/reference";
import { runCli } from "./main";
import type { Io, VendorApisBody } from "./render";

const example = (id: string) => EXAMPLES.find((e) => e.id === id)?.answer ?? "";

/** The recorded answer for val.town's APIs, as `/docs` shows it. */
const VAL_TEXT = example("vendor-apis");
const VAL = JSON.parse(VAL_TEXT) as VendorApisBody;
const SPEC_ID = VAL.apis[0]?.currentSpec?.id ?? "";

/** 120 Vendors, as the Index would order them by name. */
const VENDORS = Array.from({ length: 120 }, (_, i) => {
  const n = String(i).padStart(3, "0");
  return {
    id: i === 7 ? "stripe.com" : `vendor${n}.example`,
    name: i === 7 ? "Stripe" : `Vendor ${n}`,
    apiCount: i === 7 ? 2 : (i % 3) + 1,
  };
});

/** Atlassian: one API with a Current Spec whose Normalized Form is pending, one with none. */
const ATLASSIAN: VendorApisBody = {
  vendor: { id: "atlassian.com", name: "Atlassian", domain: "atlassian.com" },
  apis: [
    {
      api: {
        id: "atlassian.com/jira-cloud-platform",
        vendorId: "atlassian.com",
        name: "Jira Cloud Platform REST API",
      },
      currentSpec: {
        id: "a".repeat(64),
        apiId: "atlassian.com/jira-cloud-platform",
        specVersion: "3.0.1",
        apiVersion: "1001.0.0",
        isPreview: false,
        supersededAt: null,
        format: "json",
        byteLength: 2_400_000,
        downloads: {
          published: `/api/specs/${"a".repeat(64)}/published`,
          normalized: `/api/specs/${"a".repeat(64)}/normalized`,
        },
        normalized: "pending",
      },
      alternateSpecs: [],
      provenance: "Official",
      verifiedAt: "2026-10-01T12:00:00.000Z",
    },
    {
      api: {
        id: "atlassian.com/jira-software-cloud",
        vendorId: "atlassian.com",
        name: "Jira Software Cloud REST API",
      },
      currentSpec: null,
      alternateSpecs: [],
      provenance: null,
      verifiedAt: null,
    },
  ],
};

let server: Server;
let url: string;
/** Every request the fake answered, as `METHOD path?query`. */
const seen: string[] = [];
/** When set, `GET /api/vendors` answers this cursor for every page. */
let stuckCursor: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const { pathname, searchParams: params } = new URL(
      req.url ?? "",
      "http://fake",
    );
    const send = (status: number, text: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    };
    const json = (status: number, body: unknown) =>
      send(status, JSON.stringify(body));
    if (pathname === "/api/vendors") {
      const query = params.get("query")?.toLowerCase();
      const cursor = params.get("cursor");
      if (cursor !== null && !/^\d+$/.test(cursor))
        return json(400, {
          error: `"${cursor}" is not a cursor. Pass a page's nextCursor as it was given.`,
        });
      const offset = Number(cursor ?? 0);
      const limit = Number(params.get("limit") ?? 50);
      const matched = VENDORS.filter(
        (v) =>
          !query ||
          v.id.toLowerCase().includes(query) ||
          v.name.toLowerCase().includes(query),
      );
      const vendors = matched.slice(offset, offset + limit);
      const end = offset + vendors.length;
      return json(200, {
        vendors,
        total: matched.length,
        nextCursor:
          stuckCursor ??
          (vendors.length > 0 && end < matched.length ? String(end) : null),
      });
    }
    const route = /^\/api\/vendors\/([^/]+)\/apis$/.exec(pathname);
    if (!route) return json(404, { error: "No such route." });
    const vendor = decodeURIComponent(route[1] ?? "");
    if (vendor === "val.town") return send(200, VAL_TEXT);
    if (vendor === "https://www.atlassian.com/software")
      return json(200, ATLASSIAN);
    if (vendor === "Jira")
      return json(300, {
        vendors: [
          { id: "atlassian.com", name: "Atlassian" },
          { id: "jira.example", name: "Jira Example Co" },
        ],
      });
    if (vendor === "broken") return send(500, "<html>oops</html>");
    return json(404, {
      error: `No Vendor "${vendor}" in the Index.`,
      hint: "Only APIs already in the Index are listed. A Lookup (`POST /api/lookup` with the name of an API) finds an API and adds it, with its Vendor, to the Index.",
    });
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
  stuckCursor = undefined;
});

/** Runs the CLI against the fake, capturing what it writes. */
async function cli(args: string[]) {
  let stdout = "";
  let stderr = "";
  const io: Io = {
    stdout: { write: (chunk) => (stdout += String(chunk)) },
    stderr: { write: (text) => (stderr += text) },
    isTTY: false,
    stderrIsTTY: false,
    env: {
      SWAGGERBOT_URL: url,
      SWAGGERBOT_CONFIG: join(tmpdir(), "swaggerbot-cli-no-config.json"),
    },
  };
  const code = await runCli(args, io);
  return { code, stdout, stderr };
}

describe("swaggerbot vendors", () => {
  it("lists the first 50 Vendors as a table, then how many of how many and the next cursor", async () => {
    const { code, stdout, stderr } = await cli(["vendors"]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    const lines = stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(52);
    expect(lines[0]).toBe("vendor000.example  Vendor 000  1 API");
    expect(lines[7]).toBe("stripe.com         Stripe      2 APIs");
    expect(lines[49]).toBe("vendor049.example  Vendor 049  2 APIs");
    expect(lines[50]).toBe("");
    expect(lines[51]).toBe("50 of 120 Vendors; --cursor 50 for the next page");
    expect(seen).toEqual(["GET /api/vendors"]);
  });

  it("gives the page the cursor names, and says the last page has no next", async () => {
    const { code, stdout } = await cli(["vendors", "--cursor", "100"]);

    expect(code).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("vendor100.example  Vendor 100  2 APIs");
    expect(lines.at(-1)).toBe("20 of 120 Vendors");
    expect(seen).toEqual(["GET /api/vendors?cursor=100"]);
  });

  it("keeps the Vendors whose id or name holds the query", async () => {
    const { code, stdout } = await cli(["vendors", "str"]);

    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        "stripe.com  Stripe  2 APIs",
        "",
        '1 of 1 Vendors matching "str"',
        "",
      ].join("\n"),
    );
    expect(seen).toEqual(["GET /api/vendors?query=str"]);
  });

  it("says so when no Vendor matches", async () => {
    const { code, stdout } = await cli(["vendors", "nosuch"]);

    expect(code).toBe(0);
    expect(stdout).toBe('0 of 0 Vendors matching "nosuch"\n');
  });

  it("--all follows every page, the most a page allows, and lists them as one table", async () => {
    const { code, stdout } = await cli(["vendors", "--all"]);

    expect(code).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(122);
    expect(lines.at(-1)).toBe("120 of 120 Vendors");
    expect(seen).toEqual(["GET /api/vendors?limit=200"]);
  });

  it("--all with a query pages through the matches", async () => {
    const { code, stdout } = await cli(["vendors", "vendor", "--all"]);

    expect(code).toBe(0);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(
      '119 of 119 Vendors matching "vendor"',
    );
  });

  it("--json prints the server's body unchanged, one line a page", async () => {
    const { code, stdout } = await cli(["vendors", "str", "--json"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      vendors: [{ id: "stripe.com", name: "Stripe", apiCount: 2 }],
      total: 1,
      nextCursor: null,
    });
  });

  it("stops paging when the service hands out a cursor twice", async () => {
    stuckCursor = "50";
    const { code, stderr } = await cli(["vendors", "--all"]);

    expect(code).toBe(1);
    expect(stderr).toContain("handed out cursor 50 twice");
  });

  it("says a refused cursor as the server does, exit 1; --json prints its body", async () => {
    const human = await cli(["vendors", "--cursor", "x"]);
    expect(human.code).toBe(1);
    expect(human.stderr).toContain('"x" is not a cursor');

    const json = await cli(["vendors", "--cursor", "x", "--json"]);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toEqual({
      error: '"x" is not a cursor. Pass a page\'s nextCursor as it was given.',
    });
  });
});

describe("swaggerbot vendor", () => {
  it("lists each API with its id, Current Spec, Provenance, verifiedAt and both download URLs", async () => {
    const { code, stdout, stderr } = await cli(["vendor", "val.town"]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe(
      [
        "val.town  val.town",
        "",
        "Val API  val.town/api",
        "  API Version 1  json  Official  verified 2026-09-24",
        `  published   https://swaggerbot.dev/api/specs/${SPEC_ID}/published`,
        `  normalized  https://swaggerbot.dev/api/specs/${SPEC_ID}/normalized`,
        "",
        "1 API in the Index",
        "",
      ].join("\n"),
    );
    expect(seen).toEqual(["GET /api/vendors/val.town/apis"]);
  });

  it("says when an API has no confirmed Spec yet, and when a Normalized Form is being built", async () => {
    const { code, stdout } = await cli([
      "vendor",
      "https://www.atlassian.com/software",
    ]);

    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        "Atlassian  atlassian.com",
        "",
        "Jira Cloud Platform REST API  atlassian.com/jira-cloud-platform",
        "  API Version 1001.0.0  json  Official  verified 2026-10-01",
        `  published   ${url}/api/specs/${"a".repeat(64)}/published`,
        `  normalized  ${url}/api/specs/${"a".repeat(64)}/normalized  (being built)`,
        "",
        "Jira Software Cloud REST API  atlassian.com/jira-software-cloud",
        "  no confirmed Spec in the Index yet",
        "",
        "2 APIs in the Index",
        "",
      ].join("\n"),
    );
    expect(seen).toEqual([
      "GET /api/vendors/https%3A%2F%2Fwww.atlassian.com%2Fsoftware/apis",
    ]);
  });

  it("lists the Vendors a 300 offers to retry with, exit 3 as Ambiguous", async () => {
    const { code, stdout, stderr } = await cli(["vendor", "Jira"]);

    expect({ code, stderr }).toEqual({ code: 3, stderr: "" });
    expect(stdout).toBe(
      [
        'Ambiguous  2 Vendors match "Jira"; say which',
        "  atlassian.com  Atlassian",
        "  jira.example   Jira Example Co",
        "  `swaggerbot vendor <id>` lists one",
        "",
      ].join("\n"),
    );
  });

  it("says a 404 Vendor isn't in the Index and how a Lookup adds it, exit 6 as Unknown", async () => {
    const { code, stdout, stderr } = await cli(["vendor", "nosuch"]);

    expect({ code, stderr }).toEqual({ code: 6, stderr: "" });
    expect(stdout).toBe(
      [
        'Unknown  no Vendor "nosuch" in the Index',
        "  Only APIs already in the Index are listed: `swaggerbot lookup <name>` finds an API and adds it, with its Vendor, to the Index.",
        "",
      ].join("\n"),
    );
  });

  it.each([
    ["val.town", 0],
    ["Jira", 3],
    ["nosuch", 6],
  ])(
    "--json prints the server's body for %s unchanged, exit %i",
    async (vendor, exit) => {
      seen.length = 0;
      const { code, stdout } = await cli(["vendor", vendor, "--json"]);
      const direct = await fetch(
        `${url}/api/vendors/${encodeURIComponent(vendor)}/apis`,
      );

      expect(code).toBe(exit);
      expect(stdout).toBe(`${await direct.text()}\n`);
    },
  );

  it("any other failure is exit 1, the server's body as is with --json", async () => {
    const human = await cli(["vendor", "broken"]);
    expect(human.code).toBe(1);
    expect(human.stderr).toContain("answered 500");

    const json = await cli(["vendor", "broken", "--json"]);
    expect(json).toEqual({
      code: 1,
      stdout: "<html>oops</html>\n",
      stderr: "",
    });
  });
});
