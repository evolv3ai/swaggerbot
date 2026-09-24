import { describe, expect, it } from "vitest";
import { Route as ApiCatchAll } from "~/routes/api/$";
import { Route as Health } from "~/routes/api/health";
import { Route as Lookup } from "~/routes/api/lookup";
import { methodNotAllowed, noSuchApiRoute } from "./api-fallbacks";

function anyHandler(route: { options: { server?: unknown } }) {
  const server = route.options.server as
    | { handlers?: Record<string, unknown> }
    | undefined;
  const any = server?.handlers?.ANY;
  if (typeof any !== "function") throw new Error("no ANY handler");
  return any as (ctx: { request: Request }) => Response;
}

describe("methodNotAllowed", () => {
  it("answers 405 JSON with the allowed methods", async () => {
    const response = methodNotAllowed("POST")({
      request: new Request("http://localhost/api/lookup"),
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "GET is not allowed here; use POST.",
    });
  });

  it("allows HEAD wherever GET is allowed", () => {
    const response = methodNotAllowed("GET")({
      request: new Request("http://localhost/api/health", { method: "POST" }),
    });
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("is every API route's fallback", () => {
    const get = anyHandler(Lookup)({
      request: new Request("http://localhost/api/lookup"),
    });
    const post = anyHandler(Health)({
      request: new Request("http://localhost/api/health", { method: "POST" }),
    });
    expect([get.status, post.status]).toEqual([405, 405]);
  });
});

describe("noSuchApiRoute", () => {
  it("answers an unknown /api/ path with a JSON 404", async () => {
    const response = anyHandler(ApiCatchAll)({
      request: new Request("http://localhost/api/nope"),
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("No such route.");
    expect(noSuchApiRoute().status).toBe(404);
  });
});
