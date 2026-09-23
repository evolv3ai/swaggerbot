import { describe, expect, it } from "vitest";
import { freshnessDaysOf, specStepBudgetMsOf } from "./app";

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

describe("specStepBudgetMsOf", () => {
  it("defaults to 9000 ms when SPEC_STEP_BUDGET_MS is unset or blank", () => {
    expect(specStepBudgetMsOf({})).toBe(9000);
    expect(specStepBudgetMsOf({ SPEC_STEP_BUDGET_MS: " " })).toBe(9000);
  });

  it("reads a positive number of milliseconds, or Infinity for none", () => {
    expect(specStepBudgetMsOf({ SPEC_STEP_BUDGET_MS: "12000" })).toBe(12000);
    expect(specStepBudgetMsOf({ SPEC_STEP_BUDGET_MS: "Infinity" })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it.each(["0", "-2", "soon"])("rejects %s", (ms) => {
    expect(() => specStepBudgetMsOf({ SPEC_STEP_BUDGET_MS: ms })).toThrow(
      /SPEC_STEP_BUDGET_MS/,
    );
  });
});
