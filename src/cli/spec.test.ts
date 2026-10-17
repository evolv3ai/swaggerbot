import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXAMPLES } from "../components/docs/reference";
import type { Outcome } from "../domain/outcome";
import { runCli } from "./main";
import type { Io } from "./render";

const sha256 = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

/** The Current Spec's Published Form, its alternate's and its Normalized Form. */
const CURRENT = '{"openapi":"3.0.3","info":{"title":"Val API","version":"1"}}';
const ALTERNATE =
  '{"openapi":"3.1.0","info":{"title":"Val API","version":"2"}}';
const NORMALIZED =
  '{"openapi":"3.1.0","info":{"title":"Val API","version":"1"},"paths":{}}';
/** A Preview Version's Published Form: not an Alternate, so only a Lookup for its API Version finds it. */
const PREVIEW =
  '{"openapi":"3.1.0","info":{"title":"Val API","version":"2025-01-preview"}}';
const CURRENT_ID = sha256(CURRENT);
const ALTERNATE_ID = sha256(ALTERNATE);
const PREVIEW_ID = sha256(PREVIEW);
/** A Spec whose bytes on the wire aren't its own: the server serves CURRENT for it. */
const TAMPERED_ID = "b".repeat(64);
/** A Spec whose Normalized Form couldn't be built. */
const FAILED_ID = "f".repeat(64);

/** The recorded Resolved answer for Val Town, with this file's Specs in it. */
function resolved(url: string): Outcome {
  const example = JSON.parse(
    EXAMPLES.find((e) => e.id === "lookup")?.answer ?? "",
  ) as Extract<Outcome, { outcome: "Resolved" }>;
  const current = example.currentSpec;
  return {
    ...example,
    currentSpec: {
      ...current,
      id: CURRENT_ID,
      apiVersion: "1",
      // A path, as the server gives without PUBLIC_BASE_URL.
      downloads: {
        published: `/api/specs/${CURRENT_ID}/published`,
        normalized: `/api/specs/${CURRENT_ID}/normalized`,
      },
    },
    alternateSpecs: [
      {
        ...current,
        id: ALTERNATE_ID,
        apiVersion: "2",
        // An absolute URL, as the server gives with PUBLIC_BASE_URL.
        downloads: {
          published: `${url}/api/specs/${ALTERNATE_ID}/published`,
          normalized: `${url}/api/specs/${ALTERNATE_ID}/normalized`,
        },
      },
    ],
  };
}

/**
 * What a Lookup for Val Town with `apiVersion` answers: Resolved with that
 * API Version's Spec as its Current Spec when the fake knows it, else NoSpec.
 */
function resolvedAt(url: string, apiVersion: string): Outcome {
  const plain = resolved(url) as Extract<Outcome, { outcome: "Resolved" }>;
  const preview = {
    ...plain.currentSpec,
    id: PREVIEW_ID,
    apiVersion: "2025-01-preview",
    downloads: {
      published: `/api/specs/${PREVIEW_ID}/published`,
      normalized: `/api/specs/${PREVIEW_ID}/normalized`,
    },
  };
  const spec = [plain.currentSpec, ...plain.alternateSpecs, preview].find(
    (s) => s.apiVersion === apiVersion,
  );
  if (!spec)
    return {
      outcome: "NoSpec",
      api: plain.api,
      vendor: plain.vendor,
      communityAvailable: false,
      diagnostics: plain.diagnostics,
      timings: plain.timings,
    };
  return { ...plain, currentSpec: spec, alternateSpecs: [] };
}

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

let server: Server;
let url: string;
/** Every request the fake answered, as `METHOD path`. */
const seen: string[] = [];
/** How many more times the Normalized Form (and the outline) answer 409. */
let pending = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const path = req.url ?? "";
      seen.push(`${req.method} ${path}`);
      const json = (status: number, body: unknown, headers = {}) => {
        res.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        });
        res.end(JSON.stringify(body));
      };
      const building = () => {
        if (pending <= 0) return false;
        pending -= 1;
        json(409, { status: "pending" }, { "retry-after": "7" });
        return true;
      };
      if (req.method === "POST" && path === "/api/lookup") {
        const { name, apiVersion } = JSON.parse(raw) as {
          name: string;
          apiVersion?: string;
        };
        if (name === "Val Town") {
          if (apiVersion === undefined) return json(200, resolved(url));
          const answer = resolvedAt(url, apiVersion);
          // Without a key, the Index alone answers: a version it lacks needs Discovery.
          if (answer.outcome !== "Resolved" && !req.headers.authorization)
            return json(401, { error: "Discovery needs an API key." });
          return json(200, answer);
        }
        if (name === "Jira") return json(200, AMBIGUOUS);
        return json(500, { error: `the fake knows no ${name}` });
      }
      if (path === "/api/apis/val.town/api/outline") {
        if (building()) return;
        return json(200, {
          apiId: "val.town/api",
          specId: CURRENT_ID,
          specVersion: "3.0.3",
          normalized: "ready",
          outline: { tags: [], operations: [] },
          downloads: {
            published: `/api/specs/${CURRENT_ID}/published`,
            normalized: `/api/specs/${CURRENT_ID}/normalized`,
          },
        });
      }
      if (path === "/api/apis/nowhere.example/api/outline")
        return json(404, { error: "No API nowhere.example/api in the Index." });
      const download =
        /^\/api\/specs\/([0-9a-f]{64})\/(published|normalized)$/.exec(path);
      if (download) {
        const [, id, form] = download;
        if (form === "published") {
          const bytes =
            id === ALTERNATE_ID
              ? ALTERNATE
              : id === PREVIEW_ID
                ? PREVIEW
                : CURRENT;
          if (
            id !== CURRENT_ID &&
            id !== ALTERNATE_ID &&
            id !== PREVIEW_ID &&
            id !== TAMPERED_ID
          )
            return json(404, { error: "No such Spec." });
          res.writeHead(200, {
            "content-type": "application/json",
            "content-disposition": `inline; filename="api-${id?.slice(0, 12)}.json"`,
          });
          return res.end(bytes);
        }
        if (id === FAILED_ID)
          return json(422, {
            status: "failed",
            error: "The Spec couldn't be dereferenced: a $ref loops.",
          });
        if (building()) return;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(NORMALIZED);
      }
      json(404, { error: "No such route." });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let cwd: string;
/** The waits the fake clock was asked for, in ms. */
let slept: number[];

beforeEach(() => {
  seen.length = 0;
  pending = 0;
  slept = [];
  cwd = mkdtempSync(join(tmpdir(), "swaggerbot-cli-spec-"));
});

/** Runs the CLI against the fake in `cwd`, capturing what it writes, on a fake clock. */
async function cli(args: string[], { isTTY = false } = {}) {
  let stdout = "";
  let stderr = "";
  const decoder = new TextDecoder();
  const io: Io = {
    stdout: {
      write: (chunk) =>
        (stdout +=
          typeof chunk === "string"
            ? chunk
            : decoder.decode(chunk, { stream: true })),
    },
    stderr: { write: (text) => (stderr += text) },
    isTTY,
    stderrIsTTY: false,
    env: {
      SWAGGERBOT_URL: url,
      SWAGGERBOT_CONFIG: join(cwd, "no-config.json"),
    },
    cwd,
    sleep: async (ms) => {
      slept.push(ms);
    },
  };
  const code = await runCli(args, io);
  return { code, stdout, stderr };
}

describe("swaggerbot spec", () => {
  it("downloads by Spec id with no Lookup, to stdout when it is a pipe", async () => {
    const { code, stdout, stderr } = await cli(["spec", CURRENT_ID]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe(CURRENT);
    expect(seen).toEqual([`GET /api/specs/${CURRENT_ID}/published`]);
  });

  it("downloads by apiId: the outline names the Current Spec", async () => {
    const out = join(cwd, "val.json");
    const { code, stdout, stderr } = await cli([
      "spec",
      "val.town/api",
      "-o",
      out,
    ]);

    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe(`Wrote ${out} (${CURRENT.length} B)\n`);
    expect(readFileSync(out, "utf8")).toBe(CURRENT);
    expect(seen).toEqual([
      "GET /api/apis/val.town/api/outline",
      `GET /api/specs/${CURRENT_ID}/published`,
    ]);
  });

  it("says an apiId the Index doesn't hold, exit 1", async () => {
    const { code, stderr } = await cli(["spec", "nowhere.example/api"]);

    expect(code).toBe(1);
    expect(stderr).toContain("No API nowhere.example/api in the Index.");
  });

  it("downloads by name: a Resolved Lookup's Current Spec, to the file the server names at a terminal", async () => {
    const { code, stdout, stderr } = await cli(["spec", "Val Town"], {
      isTTY: true,
    });
    const name = `api-${CURRENT_ID.slice(0, 12)}.json`;

    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe(`Wrote ${name} (${CURRENT.length} B)\n`);
    expect(readFileSync(join(cwd, name), "utf8")).toBe(CURRENT);
    expect(seen).toEqual([
      "POST /api/lookup",
      `GET /api/specs/${CURRENT_ID}/published`,
    ]);
    // Nothing but the file: no part file left beside it.
    expect(readdirSync(cwd)).toEqual([name]);
  });

  it("refuses to overwrite the file the server names without --force, and overwrites it with", async () => {
    const name = `api-${CURRENT_ID.slice(0, 12)}.json`;
    writeFileSync(join(cwd, name), "mine");

    const refused = await cli(["spec", CURRENT_ID], { isTTY: true });
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`${name} exists already.`);
    expect(refused.stderr).toContain("--force");
    expect(readFileSync(join(cwd, name), "utf8")).toBe("mine");

    const forced = await cli(["spec", CURRENT_ID, "--force"], { isTTY: true });
    expect(forced.code).toBe(0);
    expect(readFileSync(join(cwd, name), "utf8")).toBe(CURRENT);
    expect(readdirSync(cwd)).toEqual([name]);
  });

  it("downloads the Alternate of --api-version, from the absolute URL the server gives", async () => {
    const { code, stdout } = await cli([
      "spec",
      "Val Town",
      "--api-version",
      "2",
    ]);

    expect(code).toBe(0);
    expect(stdout).toBe(ALTERNATE);
    expect(seen).toEqual([
      "POST /api/lookup",
      `GET /api/specs/${ALTERNATE_ID}/published`,
    ]);
  });

  it("downloads a Preview Version of --api-version, which only a Lookup for it finds", async () => {
    const { code, stdout } = await cli([
      "spec",
      "Val Town",
      "--api-version",
      "2025-01-preview",
    ]);

    expect(code).toBe(0);
    expect(stdout).toBe(PREVIEW);
    expect(seen).toEqual([
      "POST /api/lookup",
      `GET /api/specs/${PREVIEW_ID}/published`,
    ]);
  });

  it("names the API Versions there are when --api-version matches none, exit 1", async () => {
    const { code, stdout, stderr } = await cli([
      "spec",
      "Val Town",
      "--api-version",
      "3",
      "--key",
      "sb_test",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`
      "error  Val API (val.town/api) has no Spec for API Version 3.
        Its API Versions: 1 (Current), 2.
      "
    `);
    expect(seen).toEqual(["POST /api/lookup", "POST /api/lookup"]);
  });

  it("names the API Versions there are when, with no key, the Index lacks --api-version's (401), exit 1", async () => {
    const { code, stdout, stderr } = await cli([
      "spec",
      "Val Town",
      "--api-version",
      "3",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`
      "error  Val API (val.town/api) has no Spec for API Version 3.
        Its API Versions: 1 (Current), 2. With an API key (swaggerbot login), Discovery can look for 3.
      "
    `);
    expect(seen).toEqual(["POST /api/lookup", "POST /api/lookup"]);
  });

  it("prints an Ambiguous name's candidates as lookup does, downloads nothing, exit 3", async () => {
    const { code, stdout } = await cli(["spec", "Jira"]);

    expect(code).toBe(3);
    expect(stdout).toMatchInlineSnapshot(`
      "Ambiguous  2 APIs could be meant; say which
        Jira Cloud Platform REST API (Atlassian)  atlassian.com/jira-cloud-platform  55%
        Jira Software Cloud REST API (Atlassian)  atlassian.com/jira-software-cloud  40%
      "
    `);
    expect(seen).toEqual(["POST /api/lookup"]);
  });

  it("waits for a Normalized Form being built, retry-after at a time", async () => {
    pending = 2;
    const { code, stdout, stderr } = await cli([
      "spec",
      CURRENT_ID,
      "--form",
      "normalized",
    ]);

    expect(code).toBe(0);
    expect(stdout).toBe(NORMALIZED);
    expect(stderr).toBe("Normalized Form being built…\n");
    expect(slept).toEqual([7000, 7000]);
  });

  it("waits for the outline of an apiId the same way", async () => {
    pending = 1;
    const { code, stdout } = await cli(["spec", "val.town/api"]);

    expect(code).toBe(0);
    expect(stdout).toBe(CURRENT);
    expect(slept).toEqual([7000]);
  });

  it("gives up after 120 s of waiting, exit 1", async () => {
    pending = 1000;
    const { code, stdout, stderr } = await cli([
      "spec",
      CURRENT_ID,
      "--form",
      "normalized",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(slept.reduce((a, b) => a + b, 0)).toBe(120_000);
    expect(stderr).toContain(
      "The Normalized Form is still being built after 120 s.",
    );
  });

  it("fails at once with --no-wait, saying when to retry, exit 1", async () => {
    pending = 1;
    const { code, stderr } = await cli([
      "spec",
      CURRENT_ID,
      "--form",
      "normalized",
      "--no-wait",
    ]);

    expect(code).toBe(1);
    expect(slept).toEqual([]);
    expect(stderr).toMatchInlineSnapshot(`
      "error  The Normalized Form is being built.
        Retry in 7 s, or leave out --no-wait to wait for it.
      "
    `);
  });

  it("prints the server's error for a Normalized Form that couldn't be built (422), exit 1", async () => {
    const { code, stdout, stderr } = await cli([
      "spec",
      FAILED_ID,
      "--form",
      "normalized",
    ]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "error  The Spec couldn't be dereferenced: a $ref loops.\n",
    );
  });

  it("checks the Published Form's sha256 against its Spec id", async () => {
    const out = join(cwd, "good.json");
    const good = await cli(["spec", CURRENT_ID, "-o", out, "--json"]);
    expect(good.code).toBe(0);
    expect(JSON.parse(good.stdout)).toEqual({
      specId: CURRENT_ID,
      apiId: null,
      form: "published",
      path: out,
      bytes: CURRENT.length,
      sha256: CURRENT_ID,
    });

    const bad = join(cwd, "bad.json");
    const tampered = await cli(["spec", TAMPERED_ID, "-o", bad]);
    expect(tampered.code).toBe(1);
    expect(tampered.stderr).toContain(
      `The bytes downloaded aren't Spec ${TAMPERED_ID}: their sha256 is ${CURRENT_ID}.`,
    );
    expect(existsSync(bad)).toBe(false);
    expect(readdirSync(cwd)).toEqual(["good.json"]);
  });

  it("says what it wrote with --json: the apiId when known and the form", async () => {
    const { code, stdout } = await cli(
      ["spec", "Val Town", "--form", "normalized", "--json"],
      { isTTY: true },
    );
    const name = `api-${CURRENT_ID.slice(0, 12)}.normalized.json`;

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      specId: CURRENT_ID,
      apiId: "val.town/api",
      form: "normalized",
      path: name,
      bytes: NORMALIZED.length,
      sha256: sha256(NORMALIZED),
    });
    expect(readFileSync(join(cwd, name), "utf8")).toBe(NORMALIZED);
  });

  it("refuses --json with the bytes on stdout as a usage error, sending nothing, exit 2", async () => {
    const { code, stdout, stderr } = await cli(["spec", CURRENT_ID, "--json"]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--json can't share stdout");
    expect(seen).toEqual([]);
  });
});
