import { describe, expect, it } from "vitest";
import pkg from "../../cli/package.json";
import { checkReleaseTag } from "./release";

describe("checkReleaseTag", () => {
  it("passes a cli-v tag that is the package's version", () => {
    expect(checkReleaseTag("cli-v0.1.0", "0.1.0")).toEqual({
      ok: true,
      version: "0.1.0",
    });
  });

  it("fails a tag whose version isn't the package's", () => {
    expect(checkReleaseTag("cli-v0.2.0", "0.1.0")).toEqual({
      ok: false,
      error: "cli-v0.2.0 is version 0.2.0, but cli/package.json is 0.1.0.",
    });
    expect(checkReleaseTag("cli-v0.1.0-rc.1", "0.1.0").ok).toBe(false);
  });

  it("fails a tag that isn't cli-v<version>", () => {
    expect(checkReleaseTag("v0.1.0", "0.1.0").ok).toBe(false);
    expect(checkReleaseTag("main", "0.1.0").ok).toBe(false);
    expect(checkReleaseTag("", "0.1.0").ok).toBe(false);
  });

  it("passes the tag of the version cli/package.json has now", () => {
    expect(checkReleaseTag(`cli-v${pkg.version}`, pkg.version).ok).toBe(true);
  });
});
