import { describe, expect, it } from "vitest";
import { bestProvenance, Provenance } from "./provenance";

describe("bestProvenance", () => {
  it("picks the strongest tier", () => {
    expect(bestProvenance(["Mirror", "Official"])).toBe("Official");
    expect(bestProvenance(["Community", "Mirror", "Endorsed"])).toBe(
      "Endorsed",
    );
    expect(bestProvenance(["Community"])).toBe("Community");
  });

  it("is undefined for no Sources", () => {
    expect(bestProvenance([])).toBeUndefined();
  });

  it("rejects an unknown tier", () => {
    expect(Provenance.safeParse("Trusted").success).toBe(false);
  });
});
