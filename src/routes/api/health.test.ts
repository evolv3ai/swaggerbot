import { describe, expect, it } from "vitest";
import { Route } from "./health";

describe("GET /api/health", () => {
  it("returns 200 {ok: true}", async () => {
    const handlers = Route.options.server?.handlers;
    const get = typeof handlers === "function" ? undefined : handlers?.GET;
    if (typeof get !== "function") throw new Error("no GET handler");

    const response = await get({
      request: new Request("http://localhost/api/health"),
    } as never);

    if (!(response instanceof Response)) throw new Error("not a Response");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
