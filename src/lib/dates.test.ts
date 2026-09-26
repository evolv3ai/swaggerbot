import { describe, expect, it } from "vitest";
import { dayOf } from "./dates";

describe("dayOf", () => {
  it("writes an ISO timestamp as its UTC day", () => {
    expect(dayOf("2026-09-24T10:00:00.000Z")).toMatch(/^24 Sept? 2026$/);
  });

  it("takes the day in UTC, not local time", () => {
    expect(dayOf("2026-09-24T23:59:59.000Z")).toMatch(/^24 Sept? 2026$/);
    expect(dayOf("2026-01-01T00:00:00.000Z")).toBe("01 Jan 2026");
  });
});
