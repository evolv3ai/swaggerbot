import { describe, expect, it } from "vitest";
import { freshnessDaysOf } from "./app";

describe("freshnessDaysOf", () => {
  it("defaults to 7 days when FRESHNESS_DAYS is unset or blank", () => {
    expect(freshnessDaysOf({})).toBe(7);
    expect(freshnessDaysOf({ FRESHNESS_DAYS: " " })).toBe(7);
  });

  it("reads a positive number of days", () => {
    expect(freshnessDaysOf({ FRESHNESS_DAYS: "1.5" })).toBe(1.5);
  });

  it.each(["0", "-2", "soon"])("rejects %s", (days) => {
    expect(() => freshnessDaysOf({ FRESHNESS_DAYS: days })).toThrow(
      /FRESHNESS_DAYS/,
    );
  });
});
