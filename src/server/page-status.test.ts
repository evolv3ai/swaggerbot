import { describe, expect, it } from "vitest";
import { withPageStatus } from "./page-status";

const page = (status = 200) =>
  new Response("<!doctype html><title>x</title>", {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "30",
    },
  });

describe("withPageStatus", () => {
  it("serves a page with the status its server function set, keeping body and headers", async () => {
    const response = withPageStatus(page(), 429);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.text()).toBe("<!doctype html><title>x</title>");
  });

  it("leaves a page with no status set as it is", () => {
    const original = page();
    expect(withPageStatus(original, 200)).toBe(original);
  });

  it("leaves the router's own 404 and 500 alone", () => {
    const missing = page(404);
    expect(withPageStatus(missing, 400)).toBe(missing);
  });

  it("leaves what isn't a page alone", () => {
    const json = Response.json({ ok: true });
    expect(withPageStatus(json, 400)).toBe(json);
  });
});
