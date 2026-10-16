import { describe, expect, it } from "vitest";
import { CLI_USAGE, parseCliArgs } from "./args";

const NO_GLOBALS = { json: false, noColor: false };

describe("parseCliArgs", () => {
  it("parses lookup with only a name", () => {
    expect(parseCliArgs(["lookup", "Val Town"])).toEqual({
      ok: true,
      command: {
        command: "lookup",
        name: "Val Town",
        community: false,
        fresh: false,
      },
      globals: NO_GLOBALS,
    });
  });

  it("parses every lookup flag and every global flag", () => {
    expect(
      parseCliArgs([
        "--json",
        "--key",
        "sb_abc",
        "--url",
        "http://localhost:3000/",
        "--no-color",
        "lookup",
        "Stripe",
        "--api-version",
        "2024-06-20",
        "--community",
        "--fresh",
      ]),
    ).toEqual({
      ok: true,
      command: {
        command: "lookup",
        name: "Stripe",
        apiVersion: "2024-06-20",
        community: true,
        fresh: true,
      },
      globals: {
        json: true,
        key: "sb_abc",
        url: "http://localhost:3000",
        noColor: true,
      },
    });
  });

  it("takes the flags after the positionals too", () => {
    const parsed = parseCliArgs(["lookup", "Stripe", "--json", "--fresh"]);
    expect(parsed.ok && parsed.globals.json).toBe(true);
    expect(parsed.ok && parsed.command).toMatchObject({ fresh: true });
  });

  it.each([
    ["--version", ["--version"]],
    ["-V", ["-V"]],
    ["--version before anything else", ["--version", "lookup"]],
  ])("answers version for %s", (_, args) => {
    expect(parseCliArgs(args)).toMatchObject({
      ok: true,
      command: { command: "version" },
    });
  });

  it.each([
    ["--help", ["--help"]],
    ["-h", ["-h"]],
    ["--help with a command", ["lookup", "--help"]],
  ])("answers help for %s", (_, args) => {
    expect(parseCliArgs(args)).toMatchObject({
      ok: true,
      command: { command: "help" },
    });
  });

  it.each([
    ["no command", [], "no command given"],
    ["an unknown command", ["frobnicate"], "unknown command: frobnicate"],
    ["lookup without a name", ["lookup"], "lookup needs a name"],
    ["lookup with a blank name", ["lookup", " "], "lookup needs a name"],
    ["lookup with two names", ["lookup", "a", "b"], "unexpected argument: b"],
    ["an unknown flag", ["lookup", "a", "--verbose"], "Unknown option"],
    [
      "--json with a bad flag",
      ["--json", "lookup", "a", "--bogus"],
      "Unknown option",
    ],
    ["--key without a key", ["--key", "", "lookup", "a"], "--key needs a key"],
    [
      "--url that isn't an origin",
      ["--url", "swaggerbot.dev", "lookup", "a"],
      "--url must be an http(s) origin",
    ],
    [
      "--api-version without a version",
      ["lookup", "a", "--api-version", ""],
      "--api-version needs a version",
    ],
    [
      "a lookup flag on another command",
      ["--fresh", "frobnicate"],
      "--fresh only goes with lookup",
    ],
  ])("refuses %s with exit 2", (_, args, error) => {
    const parsed = parseCliArgs(args);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.exitCode).toBe(2);
    expect(parsed.error).toContain(error);
  });

  it("documents lookup and every global flag in the usage", () => {
    for (const word of [
      "lookup <name>",
      "--api-version",
      "--community",
      "--fresh",
      "--json",
      "--key",
      "--url",
      "--no-color",
      "--version",
      "--help",
    ])
      expect(CLI_USAGE).toContain(word);
  });
});
