import { describe, expect, it } from "vitest";
import { createJudge, JevJudge } from ".";

describe("createJudge", () => {
  it("throws naming the variable when TYPESAFE_API_KEY is missing", () => {
    expect(() => createJudge({})).toThrow(/TYPESAFE_API_KEY/);
    expect(() => createJudge({ TYPESAFE_API_KEY: "  " })).toThrow(
      /TYPESAFE_API_KEY/,
    );
  });

  it("returns the Jev judge when the key is set", () => {
    expect(createJudge({ TYPESAFE_API_KEY: "test-key" })).toBeInstanceOf(
      JevJudge,
    );
  });
});
