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
    [
      "a Spec id, lowercased",
      ["spec", "AB".repeat(32)],
      { kind: "specId", specId: "ab".repeat(32) },
    ],
    [
      "an apiId",
      ["spec", "stripe.com/stripe-api"],
      { kind: "apiId", apiId: "stripe.com/stripe-api" },
    ],
    ["a name", ["spec", "Val Town"], { kind: "name", name: "Val Town" }],
  ])("parses spec with %s, Published by default", (_, args, target) => {
    expect(parseCliArgs(args)).toEqual({
      ok: true,
      command: {
        command: "spec",
        target,
        form: "published",
        force: false,
        noWait: false,
      },
      globals: NO_GLOBALS,
    });
  });

  it("parses every spec flag", () => {
    expect(
      parseCliArgs([
        "spec",
        "Stripe",
        "--form",
        "normalized",
        "--api-version",
        "2024-06-20",
        "-o",
        "stripe.json",
        "--force",
        "--no-wait",
        "--json",
      ]),
    ).toEqual({
      ok: true,
      command: {
        command: "spec",
        target: { kind: "name", name: "Stripe" },
        form: "normalized",
        apiVersion: "2024-06-20",
        output: "stripe.json",
        force: true,
        noWait: true,
      },
      globals: { ...NO_GLOBALS, json: true },
    });
  });

  it("parses every outline flag, and an apiId or a name", () => {
    expect(
      parseCliArgs([
        "outline",
        "stripe.com/stripe-api",
        "--tag",
        "Customers",
        "--query",
        " customers ",
        "--spec-id",
        "A".repeat(64),
        "--limit",
        "500",
        "--all",
        "--cursor",
        "100",
        "--json",
      ]),
    ).toEqual({
      ok: true,
      command: {
        command: "outline",
        target: { kind: "apiId", apiId: "stripe.com/stripe-api" },
        tag: "Customers",
        query: "customers",
        specId: "a".repeat(64),
        limit: 500,
        all: true,
        cursor: "100",
      },
      globals: { ...NO_GLOBALS, json: true },
    });
    expect(parseCliArgs(["outline", "Stripe"])).toEqual({
      ok: true,
      command: {
        command: "outline",
        target: { kind: "name", name: "Stripe" },
        all: false,
      },
      globals: NO_GLOBALS,
    });
  });

  it("parses operation and schema", () => {
    expect(
      parseCliArgs(["operation", "Stripe", "POST", "/v1/customers/{customer}"]),
    ).toEqual({
      ok: true,
      command: {
        command: "operation",
        target: { kind: "name", name: "Stripe" },
        method: "post",
        path: "/v1/customers/{customer}",
      },
      globals: NO_GLOBALS,
    });
    expect(
      parseCliArgs([
        "schema",
        "stripe.com/stripe-api",
        "customer",
        "--spec-id",
        "b".repeat(64),
      ]),
    ).toEqual({
      ok: true,
      command: {
        command: "schema",
        target: { kind: "apiId", apiId: "stripe.com/stripe-api" },
        name: "customer",
        specId: "b".repeat(64),
      },
      globals: NO_GLOBALS,
    });
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
    [
      "a lookup flag on login",
      ["login", "--fresh"],
      "--fresh only goes with lookup",
    ],
    [
      "--api-version on a command that takes none",
      ["key", "--api-version", "1"],
      "--api-version only goes with lookup or spec",
    ],
    ["-o on lookup", ["lookup", "a", "-o", "x"], "-o only goes with spec"],
    ["spec without an argument", ["spec"], "spec needs a name"],
    ["spec with two arguments", ["spec", "a", "b"], "unexpected argument: b"],
    [
      "spec with an unknown form",
      ["spec", "a", "--form", "yaml"],
      '--form is published or normalized (got "yaml")',
    ],
    [
      "--api-version with a Spec id",
      ["spec", "a".repeat(64), "--api-version", "1"],
      "--api-version goes with a name",
    ],
    [
      "--api-version with an apiId",
      ["spec", "stripe.com/stripe-api", "--api-version", "1"],
      "--api-version goes with a name",
    ],
    ["-o without a file", ["spec", "a", "-o", ""], "-o needs a file"],
    ["login with an argument", ["login", "sb_x"], "unexpected argument: sb_x"],
    ["logout with an argument", ["logout", "now"], "unexpected argument: now"],
    ["key with an argument", ["key", "sb_x"], "unexpected argument: sb_x"],
    [
      "outline without an argument",
      ["outline"],
      "outline needs a name or an apiId",
    ],
    ["outline with two", ["outline", "a", "b"], "unexpected argument: b"],
    [
      "a bad --spec-id",
      ["outline", "a", "--spec-id", "abc"],
      "--spec-id is a Spec id",
    ],
    ["a blank --tag", ["outline", "a", "--tag", " "], "--tag needs a value"],
    [
      "--tag on schema",
      ["schema", "a", "b", "--tag", "x"],
      "--tag only goes with outline",
    ],
    [
      "--all on operation",
      ["operation", "a", "get", "/", "--all"],
      "--all only goes with outline",
    ],
    [
      "operation without a path",
      ["operation", "a", "get"],
      "operation needs a name or an apiId, a method and a path",
    ],
    [
      "operation with an unknown method",
      ["operation", "a", "fetch", "/"],
      'the method is one of get, put, post, delete, options, head, patch, trace (got "fetch")',
    ],
    [
      "schema without a name",
      ["schema", "a"],
      "schema needs a name or an apiId and a schema name",
    ],
    ["schema with three", ["schema", "a", "b", "c"], "unexpected argument: c"],
  ])("refuses %s with exit 2", (_, args, error) => {
    const parsed = parseCliArgs(args);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.exitCode).toBe(2);
    expect(parsed.error).toContain(error);
  });

  it.each(["login", "logout", "key"] as const)(
    "parses %s with the global flags and nothing else",
    (command) => {
      expect(parseCliArgs([command])).toEqual({
        ok: true,
        command: { command },
        globals: NO_GLOBALS,
      });
      expect(parseCliArgs([command, "--key", "sb_x", "--json"])).toEqual({
        ok: true,
        command: { command },
        globals: { ...NO_GLOBALS, key: "sb_x", json: true },
      });
    },
  );

  it("documents every command and every global flag in the usage", () => {
    for (const word of [
      "lookup <name>",
      "login [--key K]",
      "logout",
      "key ",
      "spec <name | apiId | specId>",
      "--form published|normalized",
      "-o FILE",
      "--force",
      "--no-wait",
      "outline <name | apiId>",
      "--tag T",
      "--query Q",
      "--spec-id S",
      "--limit N",
      "--all",
      "operation <name | apiId> <method> <path>",
      "schema <name | apiId> <schemaName>",
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
