import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXAMPLES } from "../components/docs/reference";
import type { Outcome } from "../domain/outcome";
import type { SpecOutline } from "../domain/spec-forms";
import { runCli } from "./main";
import type { Io } from "./render";

const example = (id: string) => EXAMPLES.find((e) => e.id === id)?.answer ?? "";

/** The recorded outline page for val.town/api, as `/docs` shows it, less the line that abridges it. */
const VAL_PAGE = JSON.parse(
  example("outline").replace(/,\n\s*…\n/, "\n"),
) as SpecOutline & { apiId: string; specId: string; specVersion: string };
/** The recorded operation and schema, as `/docs` shows them. */
const OPERATION_TEXT = example("operation");
const SCHEMA_TEXT = example("schema");
const SPEC_ID = VAL_PAGE.specId;

/** val.town/api's Spec Outline: the recorded page's operations, and one under another tag. */
const VAL: SpecOutline = {
  title: VAL_PAGE.title,
  apiVersion: VAL_PAGE.apiVersion,
  servers: VAL_PAGE.servers,
  securitySchemes: VAL_PAGE.securitySchemes,
  tags: VAL_PAGE.tags,
  operations: [
    ...VAL_PAGE.operations,
    {
      method: "delete",
      path: "/v1/blob/{key}",
      operationId: "v1blobsDelete",
      summary: "Delete a\n  blob",
      tags: ["blobs"],
      deprecated: true,
    },
  ],
};

/** A generated outline of 4,000 operations under 30 tags of falling size. */
const TAG_COUNT = 30;
const BIG_OPERATIONS = Array.from({ length: 4000 }, (_, i) => {
  // Tag t gets about twice the operations of tag t + 1, so the 20 largest are the first 20.
  const tag = `tag${String(Math.min(TAG_COUNT - 1, Math.floor(Math.log2(4000 / (4000 - i))))).padStart(2, "0")}`;
  const resource = i % 4 === 0 ? "customers" : "invoices";
  return {
    method: i % 2 === 0 ? "get" : "post",
    path: `/v1/${resource}/${i}`,
    operationId: `op${i}`,
    summary: `Operation ${i}`,
    tags: [tag],
  };
});
const BIG: SpecOutline = {
  title: "Big API",
  apiVersion: "2026-01-01",
  servers: ["https://api.big.example", "https://eu.big.example"],
  securitySchemes: [
    { name: "apiKey", type: "apiKey", in: "header" },
    { name: "bearer", type: "http", scheme: "bearer" },
  ],
  tags: Array.from({ length: TAG_COUNT }, (_, t) => {
    const name = `tag${String(t).padStart(2, "0")}`;
    return {
      name,
      operationCount: BIG_OPERATIONS.filter((op) => op.tags[0] === name).length,
    };
  }),
  operations: BIG_OPERATIONS,
};

/** An outline with one path far longer than the rest. */
const LONG: SpecOutline = {
  ...VAL,
  operations: [
    { method: "get", path: "/a", operationId: "a", summary: "A", tags: [] },
    {
      method: "get",
      path: `/${"b".repeat(70)}`,
      operationId: "b",
      summary: "B",
      tags: [],
    },
  ],
};

/** One page of `outline`, as `GET /api/apis/{apiId}/outline` pages it. */
function page(apiId: string, outline: SpecOutline, params: URLSearchParams) {
  const tag = params.get("tag")?.toLowerCase();
  const query = params.get("query")?.toLowerCase();
  const offset = Number(params.get("cursor") ?? 0);
  const limit = Number(params.get("limit") ?? 100);
  const matched = outline.operations.filter(
    (op) =>
      (!tag || op.tags.some((t) => t.toLowerCase() === tag)) &&
      (!query ||
        op.path.toLowerCase().includes(query) ||
        op.operationId?.toLowerCase().includes(query) ||
        op.summary?.toLowerCase().includes(query)),
  );
  const operations = matched.slice(offset, offset + limit);
  const end = offset + operations.length;
  return {
    apiId,
    specId: params.get("specId") ?? SPEC_ID,
    title: outline.title,
    apiVersion: outline.apiVersion,
    servers: outline.servers,
    securitySchemes: outline.securitySchemes,
    tags: outline.tags,
    operations,
    totalOperations: outline.operations.length,
    matchedOperations: matched.length,
    nextCursor: end < matched.length ? String(end) : null,
    specVersion: "3.1.0",
    normalized: "ready",
    downloads: {
      published: `/api/specs/${SPEC_ID}/published`,
      normalized: `/api/specs/${SPEC_ID}/normalized`,
    },
  };
}

/** An operation whose expansion stopped at the cap and holds a schema that recurs. */
const DEEP_OPERATION = {
  apiId: "val.town/api",
  specId: SPEC_ID,
  method: "get",
  path: "/v1/tree",
  operation: {
    operationId: "treeGet",
    summary: "The whole tree",
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Node", "x-circular": true },
          },
        },
      },
      "400": { $ref: "#/components/responses/Bad", "x-truncated": true },
    },
  },
  circular: {
    Node: {
      type: "object",
      properties: {
        children: {
          type: "array",
          items: { $ref: "#/components/schemas/Node", "x-circular": true },
        },
      },
    },
  },
  securitySchemes: {},
  truncated: true,
};

let server: Server;
let url: string;
/** Every request the fake answered, as `METHOD path?query`. */
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      seen.push(`${req.method} ${req.url}`);
      const { pathname, searchParams: params } = new URL(
        req.url ?? "",
        "http://fake",
      );
      const send = (status: number, text: string, headers = {}) => {
        res.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        });
        res.end(text);
      };
      const json = (status: number, body: unknown, headers = {}) =>
        send(status, JSON.stringify(body), headers);
      if (req.method === "POST" && pathname === "/api/lookup") {
        const { name } = JSON.parse(raw) as { name: string };
        if (name === "Val Town") return send(200, example("lookup"));
        if (name === "Jira") return json(200, AMBIGUOUS);
        return json(500, { error: `the fake knows no ${name}` });
      }
      const route = /^\/api\/apis\/(.+)\/(outline|operation|schema)$/.exec(
        pathname,
      );
      if (!route) return json(404, { error: "No such route." });
      const [, apiId, resource] = route;
      if (apiId === "pending.example/api")
        return json(409, { status: "pending" }, { "retry-after": "10" });
      if (apiId === "failed.example/api")
        return json(422, {
          status: "failed",
          error: "The Spec couldn't be dereferenced: a $ref loops.",
        });
      if (resource === "outline") {
        if (apiId === "val.town/api")
          return json(200, page(apiId, VAL, params));
        if (apiId === "big.example/api")
          return json(200, page(apiId, BIG, params));
        if (apiId === "long.example/api")
          return json(200, page(apiId, LONG, params));
        return json(404, {
          error: `The Index holds no API ${apiId}, or none with a Current Spec.`,
          hint: "A Lookup (`POST /api/lookup` with a `name`) finds APIs and gives their ids.",
        });
      }
      if (resource === "operation") {
        const method = params.get("method");
        const path = params.get("path");
        if (method === "delete" && path === "/v1/blob/{key}")
          return send(200, OPERATION_TEXT);
        if (method === "get" && path === "/v1/tree")
          return json(200, DEEP_OPERATION);
        return json(404, {
          error: `This Spec has no operation ${method?.toUpperCase()} ${path}.`,
          hint: `GET /api/apis/${apiId}/outline lists its operations; path must equal one of them exactly.`,
        });
      }
      if (params.get("name") === "PaginationLinks")
        return send(200, SCHEMA_TEXT);
      return json(404, {
        error: `This Spec has no schema ${params.get("name")} in components.schemas.`,
        nearest:
          params.get("name") === "Zzz"
            ? []
            : ["PaginationLinks", "Pagination", "Links"],
      });
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

/** The operation rows of an outline view: the lines between the blank lines. */
function rows(stdout: string): string[] {
  const blocks = stdout.trimEnd().split("\n\n");
  return blocks.length === 3 ? (blocks[1]?.split("\n") ?? []) : [];
}

describe("swaggerbot outline", () => {
  it("shows the title, servers, security schemes and tags, then the operations as a table", async () => {
    const { code, stdout, stderr } = await cli(["outline", "val.town/api"]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe(
      [
        "Val Town API  API Version 1  val.town/api",
        "servers   https://api.val.town",
        "security  bearerAuth (http bearer)",
        "tags      vals 20, alias 2, me 2",
        "",
        "GET     /v1/me          meGet",
        "GET     /v2/me/vals     meVals2",
        "DELETE  /v1/blob/{key}  v1blobsDelete  Delete a blob (deprecated)",
        "",
        "3 of 3 operations",
        "",
      ].join("\n"),
    );
    expect(seen).toEqual(["GET /api/apis/val.town/api/outline?limit=100"]);
  });

  it("pads the path column to at most 48: a longer path runs past it on its own row", async () => {
    const { stdout } = await cli(["outline", "long.example/api"]);

    expect(rows(stdout)).toEqual([
      `GET  /a${" ".repeat(46)}  a  A`,
      `GET  /${"b".repeat(70)}  b  B`,
    ]);
  });

  it("looks a name up first, as spec does, and outlines the API it resolves to", async () => {
    const { code, stdout } = await cli(["outline", "Val Town"]);

    expect(code).toBe(0);
    expect(stdout).toContain("Val Town API  API Version 1  val.town/api");
    expect(seen).toEqual([
      "POST /api/lookup",
      "GET /api/apis/val.town/api/outline?limit=100",
    ]);
  });

  it("prints a name's Outcome other than Resolved as lookup does, with its exit code, and outlines nothing", async () => {
    const { code, stdout } = await cli(["outline", "Jira"]);

    expect(code).toBe(3);
    expect(stdout).toContain("Ambiguous");
    expect(seen).toEqual(["POST /api/lookup"]);
  });

  it("shows the first 100 of 4,000 operations, the 20 largest tags, and the cursor of the next page", async () => {
    const { code, stdout } = await cli(["outline", "big.example/api"]);
    const lines = stdout.split("\n");

    expect(code).toBe(0);
    expect(lines[0]).toBe("Big API  API Version 2026-01-01  big.example/api");
    expect(lines[1]).toBe(
      "servers   https://api.big.example  https://eu.big.example",
    );
    expect(lines[2]).toBe(
      "security  apiKey (apiKey in header), bearer (http bearer)",
    );
    const tags = lines[3]?.replace(/^tags {6}/, "").split("  (")[0];
    expect(tags?.split(", ")).toHaveLength(20);
    expect(
      tags?.startsWith(`tag00 ${BIG.tags[0]?.operationCount}, tag01`),
    ).toBe(true);
    expect(lines[3]).toContain("(+10 more: --all lists them)");
    const table = rows(stdout);
    expect(table).toHaveLength(100);
    expect(table[0]).toMatch(/^GET {3}\/v1\/customers\/0 +op0 +Operation 0$/);
    expect(table[99]).toMatch(
      /^POST {2}\/v1\/invoices\/99 +op99 +Operation 99$/,
    );
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(
      "100 of 4000 operations; next page: --cursor 100",
    );
  });

  it("pages with --cursor, the hidden flag the next-page line names", async () => {
    const { code, stdout } = await cli([
      "outline",
      "big.example/api",
      "--cursor",
      "3900",
    ]);

    expect(code).toBe(0);
    expect(rows(stdout)[0]).toContain("op3900");
    expect(stdout.trimEnd().split("\n").at(-1)).toBe("100 of 4000 operations");
    expect(seen).toEqual([
      "GET /api/apis/big.example/api/outline?cursor=3900&limit=100",
    ]);
  });

  it("follows every page with --all, 500 at a time, and lists every tag", async () => {
    const { code, stdout } = await cli(["outline", "big.example/api", "--all"]);

    expect(code).toBe(0);
    expect(seen).toHaveLength(8);
    expect(seen[0]).toBe("GET /api/apis/big.example/api/outline?limit=500");
    expect(seen[7]).toBe(
      "GET /api/apis/big.example/api/outline?cursor=3500&limit=500",
    );
    expect(rows(stdout)).toHaveLength(4000);
    expect(stdout.split("\n")[3]?.split(", ")).toHaveLength(TAG_COUNT);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe("4000 of 4000 operations");
  });

  it("with --all --json prints each page's body unchanged, one line a page", async () => {
    const { code, stdout } = await cli([
      "outline",
      "big.example/api",
      "--all",
      "--limit",
      "100",
      "--json",
    ]);
    const lines = stdout.trimEnd().split("\n");

    expect(code).toBe(0);
    expect(lines).toHaveLength(40);
    expect(JSON.parse(lines[0] ?? "")).toEqual(
      page("big.example/api", BIG, new URLSearchParams({ limit: "100" })),
    );
    expect(JSON.parse(lines[39] ?? "").nextCursor).toBeNull();
  });

  it("narrows by --query: a word of the path, operationId or summary", async () => {
    const { code, stdout } = await cli([
      "outline",
      "big.example/api",
      "--query",
      "customers",
    ]);

    expect(code).toBe(0);
    expect(rows(stdout).every((row) => row.includes("/v1/customers/"))).toBe(
      true,
    );
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(
      "100 of 1000 matching operations (4000 in all); next page: --cursor 100",
    );
    expect(seen).toEqual([
      "GET /api/apis/big.example/api/outline?query=customers&limit=100",
    ]);
  });

  it("narrows by --tag, and passes --spec-id", async () => {
    const specId = "c".repeat(64);
    const { code, stdout } = await cli([
      "outline",
      "big.example/api",
      "--tag",
      "tag05",
      "--spec-id",
      specId.toUpperCase(),
    ]);
    const count = BIG.tags[5]?.operationCount;

    expect(code).toBe(0);
    expect(rows(stdout)).toHaveLength(count ?? 0);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(
      `${count} of ${count} matching operations (4000 in all)`,
    );
    expect(seen).toEqual([
      `GET /api/apis/big.example/api/outline?tag=tag05&specId=${specId}&limit=100`,
    ]);
  });

  it("says when nothing matches", async () => {
    const { code, stdout } = await cli([
      "outline",
      "val.town/api",
      "--query",
      "nothing",
    ]);

    expect(code).toBe(0);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(
      "0 of 0 matching operations (3 in all)",
    );
  });

  it("takes --limit from 1 to 500, as the route does", async () => {
    const at500 = await cli(["outline", "big.example/api", "--limit", "500"]);
    expect(at500.code).toBe(0);
    expect(rows(at500.stdout)).toHaveLength(500);
    expect(seen).toEqual(["GET /api/apis/big.example/api/outline?limit=500"]);

    const at1 = await cli(["outline", "big.example/api", "--limit", "1"]);
    expect(rows(at1.stdout)).toHaveLength(1);

    for (const limit of ["0", "501", "ten", "2.5", "-1"]) {
      const refused = await cli([
        "outline",
        "big.example/api",
        `--limit=${limit}`,
      ]);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toContain(
        "--limit is a whole number from 1 to 500",
      );
    }
  });

  it("says the Spec's forms are pending, exit 1; --json prints the server's body", async () => {
    const human = await cli(["outline", "pending.example/api"]);
    expect(human.code).toBe(1);
    expect(human.stdout).toBe("");
    expect(human.stderr).toBe(
      "error  The Spec Outline can't be read yet: the Spec's forms are pending (still being built).\n  Retry in 10 s.\n",
    );

    const json = await cli(["outline", "pending.example/api", "--json"]);
    expect(json.code).toBe(1);
    expect(json.stdout).toBe('{"status":"pending"}\n');
  });

  it("says the Spec's forms failed, in the server's words, exit 1", async () => {
    const { code, stderr } = await cli(["outline", "failed.example/api"]);

    expect(code).toBe(1);
    expect(stderr).toContain(
      "The Spec's forms failed: The Spec couldn't be dereferenced: a $ref loops.",
    );
  });

  it("says an apiId the Index doesn't hold, with the server's hint, exit 1", async () => {
    const { code, stderr } = await cli(["outline", "nowhere.example/api"]);

    expect(code).toBe(1);
    expect(stderr).toContain(
      "The Index holds no API nowhere.example/api, or none with a Current Spec.",
    );
  });
});

describe("swaggerbot operation", () => {
  it("shows a heading, then the operation and its security schemes as pretty JSON", async () => {
    const { code, stdout, stderr } = await cli([
      "operation",
      "val.town/api",
      "DELETE",
      "/v1/blob/{key}",
    ]);
    const body = JSON.parse(OPERATION_TEXT);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe(
      [
        "DELETE /v1/blob/{key} · v1blobsDelete",
        JSON.stringify(body.operation, null, 2),
        "security schemes",
        JSON.stringify(body.securitySchemes, null, 2),
        "",
      ].join("\n"),
    );
    expect(seen).toEqual([
      "GET /api/apis/val.town/api/operation?method=delete&path=%2Fv1%2Fblob%2F%7Bkey%7D",
    ]);
  });

  it("notes truncated and circular, and shows the schemas that recur", async () => {
    const { code, stdout } = await cli([
      "operation",
      "val.town/api",
      "get",
      "/v1/tree",
    ]);
    const lines = stdout.split("\n");

    expect(code).toBe(0);
    expect(lines[0]).toBe("GET /v1/tree · treeGet · The whole tree");
    expect(lines[1]).toContain("truncated: inlining stopped at the size cap");
    expect(lines[2]).toContain("circular: Node recurs within itself");
    expect(stdout).toContain(
      `circular\n${JSON.stringify(DEEP_OPERATION.circular, null, 2)}\n`,
    );
    expect(stdout).not.toContain("security schemes");
  });

  it("prints the server's body unchanged with --json", async () => {
    const { code, stdout } = await cli([
      "operation",
      "Val Town",
      "delete",
      "/v1/blob/{key}",
      "--json",
    ]);

    expect(code).toBe(0);
    expect(stdout).toBe(`${OPERATION_TEXT}\n`);
    expect(seen[0]).toBe("POST /api/lookup");
  });

  it("says an operation the Spec lacks with the server's hint, exit 1", async () => {
    const { code, stdout, stderr } = await cli([
      "operation",
      "val.town/api",
      "post",
      "/v1/nope",
      "--spec-id",
      SPEC_ID,
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "error  This Spec has no operation POST /v1/nope.\n  GET /api/apis/val.town/api/outline lists its operations; path must equal one of them exactly.\n",
    );
    expect(seen[0]).toContain(`&specId=${SPEC_ID}`);
  });

  it("says pending forms, exit 1", async () => {
    const { code, stderr } = await cli([
      "operation",
      "pending.example/api",
      "get",
      "/",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("The operation can't be read yet");
  });
});

describe("swaggerbot schema", () => {
  it("shows a heading, then the schema as pretty JSON", async () => {
    const { code, stdout, stderr } = await cli([
      "schema",
      "val.town/api",
      "PaginationLinks",
    ]);
    const body = JSON.parse(SCHEMA_TEXT);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe(
      [
        "PaginationLinks · components.schemas of val.town/api",
        JSON.stringify(body.schema, null, 2),
        "",
      ].join("\n"),
    );
    expect(seen).toEqual([
      "GET /api/apis/val.town/api/schema?name=PaginationLinks",
    ]);
  });

  it("prints the server's body unchanged with --json", async () => {
    const { code, stdout } = await cli([
      "schema",
      "val.town/api",
      "PaginationLinks",
      "--json",
    ]);

    expect(code).toBe(0);
    expect(stdout).toBe(`${SCHEMA_TEXT}\n`);
  });

  it("says a schema the Spec lacks with the nearest names, exit 1", async () => {
    const { code, stdout, stderr } = await cli([
      "schema",
      "val.town/api",
      "PaginationLink",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "error  This Spec has no schema PaginationLink in components.schemas.\n  The nearest it has: PaginationLinks, Pagination, Links.\n",
    );
  });

  it("says a missing schema with no nearest names plainly; --json prints the 404's body", async () => {
    const human = await cli(["schema", "val.town/api", "Zzz"]);
    expect(human.code).toBe(1);
    expect(human.stderr).toBe(
      "error  This Spec has no schema Zzz in components.schemas.\n",
    );

    const json = await cli([
      "schema",
      "val.town/api",
      "PaginationLink",
      "--json",
    ]);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout).nearest).toEqual([
      "PaginationLinks",
      "Pagination",
      "Links",
    ]);
  });
});
