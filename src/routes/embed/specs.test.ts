import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { specForms } from "~/index-store/schema";
import { createSpecForms } from "~/index-store/spec-forms";
import { SCALAR_CSS } from "~/server/spec-embed";
import { SpecFormsError } from "~/spec-forms/build";
import { Route as EmbedRoute } from "./specs/$specId";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-embed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The route's shared app, over an Index in a temp database.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());
createApp.mockImplementation(() => ({ db }));

const repo = createRepo(db);
const forms = createSpecForms(db);
repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
repo.upsertApi({
  id: "payco.com/payco-api",
  vendorId: "payco.com",
  name: "PayCo <API>",
});
function put(text: string): string {
  return repo.putSpec("payco.com/payco-api", new TextEncoder().encode(text), {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format: "json",
  }).id;
}
const specId = put(
  '{"openapi":"3.1.0","info":{"title":"PayCo","version":"1"}}',
);
// One byte over the limit: 10,000,001 bytes.
const big = '{"openapi":"3.1.0","x":"';
const bigId = put(`${big}${"a".repeat(10_000_001 - big.length - 2)}"}`);

async function get(id: string, query = ""): Promise<Response> {
  const handlers = EmbedRoute.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.GET;
  if (typeof handler !== "function") throw new Error("no GET handler");
  const response = await handler({
    request: new Request(`http://localhost:3000/embed/specs/${id}${query}`),
    params: { specId: id },
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

const CSP_NONE =
  "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

describe("GET /embed/specs/{specId}", () => {
  afterEach(() => {
    db.delete(specForms).where(eq(specForms.specId, specId)).run();
  });

  it("serves Scalar on the Published Form under the frame's CSP, exactly", async () => {
    const response = await get(specId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("content-security-policy")).toBe(
      `sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src http://localhost:3000/api/specs/${specId}/published; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("configures Scalar read-only, with no inline script", async () => {
    const html = await (await get(specId, "?form=published")).text();

    const configuration = html.match(/data-configuration="([^"]*)"/)?.[1];
    expect(JSON.parse((configuration ?? "").replaceAll("&quot;", '"'))).toEqual(
      {
        url: `http://localhost:3000/api/specs/${specId}/published`,
        darkMode: true,
        forceDarkModeState: "dark",
        hideDarkModeToggle: true,
        customCss: SCALAR_CSS,
        hideTestRequestButton: true,
        hideClientButton: true,
        telemetry: false,
        withDefaultFonts: false,
        agent: { disabled: true },
        mcp: { disabled: true },
        showDeveloperTools: "never",
        documentDownloadType: "none",
      },
    );
    expect(html).not.toContain("proxyUrl");
    // Every <script> is a file of ours, or JSON (not run).
    const scripts = [...html.matchAll(/<script([^>]*)>([^<]*)<\/script>/g)];
    expect(scripts.map((s) => s[1]?.match(/src="([^"]+)"/)?.[1])).toEqual([
      undefined,
      "/embed/memory-storage.js",
      "/embed/scalar-api-reference.js",
    ]);
    expect(scripts[0]?.[1]).toContain('type="application/json"');
    expect(scripts.every((s) => s[2] === "")).toBe(true);
    // The API's name is escaped in the title.
    expect(html).toContain(
      "<title>API reference for PayCo &lt;API&gt;</title>",
    );
  });

  it("renders Scalar in the site's theme, and only in dark or light", async () => {
    const config = async (query: string) => {
      const html = await (await get(specId, query)).text();
      return {
        html,
        configuration: JSON.parse(
          (html.match(/data-configuration="([^"]*)"/)?.[1] ?? "").replaceAll(
            "&quot;",
            '"',
          ),
        ),
      };
    };

    const light = await config("?theme=light");
    expect(light.configuration).toMatchObject({
      darkMode: false,
      forceDarkModeState: "light",
      hideDarkModeToggle: true,
    });
    expect(light.html).toContain('<meta name="color-scheme" content="light">');
    // Anything but `light` is the default, dark, and never echoed.
    const hostile = await config('?theme="><script>alert(1)</script>');
    expect(hostile.configuration).toMatchObject({
      darkMode: true,
      forceDarkModeState: "dark",
    });
    expect(hostile.html).not.toContain("alert(1)");
    expect(hostile.html).toContain('<meta name="color-scheme" content="dark">');
  });

  it("points at the Normalized Form once it is built", async () => {
    forms.saveBuilt(
      specId,
      {
        normalized: new TextEncoder().encode('{"openapi":"3.1.1"}'),
        normalizedSpecVersion: "3.1.1",
        validityIssues: [],
        validityFindingCount: 0,
        normalizedFindingCount: 0,
        outline: {
          title: "PayCo",
          apiVersion: "1",
          servers: [],
          securitySchemes: [],
          tags: [],
          operations: [],
        },
      },
      "2026-09-25T10:00:00.000Z",
    );

    const response = await get(specId, "?form=normalized");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      `; connect-src http://localhost:3000/api/specs/${specId}/normalized;`,
    );
  });

  it("says a pending Normalized Form is being built, and connects nowhere", async () => {
    const response = await get(specId, "?form=normalized");

    expect(response.status).toBe(409);
    expect(response.headers.get("content-security-policy")).toBe(CSP_NONE);
    const html = await response.text();
    expect(html).toContain("being built");
    expect(html).not.toContain("<script");
  });

  it("says why a Normalized Form failed", async () => {
    forms.saveFailure(
      specId,
      new SpecFormsError("not-openapi", "not an <OpenAPI> document"),
      "2026-09-25T10:00:00.000Z",
    );

    const html = await (await get(specId, "?form=normalized")).text();

    expect(html).toContain("couldn't be built");
    expect(html).toContain("not an &lt;OpenAPI&gt; document");
  });

  it("doesn't load Scalar on a form over 10 MB", async () => {
    const response = await get(bigId);

    expect(response.status).toBe(413);
    expect(response.headers.get("content-security-policy")).toBe(CSP_NONE);
    expect(await response.text()).not.toContain("<script");
  });

  it("answers 404 for an unknown Spec and 400 for a malformed id", async () => {
    expect((await get("0".repeat(64))).status).toBe(404);
    expect((await get("nope")).status).toBe(400);
  });
});
