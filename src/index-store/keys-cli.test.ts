import { describe, expect, it } from "vitest";
import { parseKeysArgs } from "./keys-cli";

describe("parseKeysArgs", () => {
  it("reads create with and without --quota", () => {
    expect(parseKeysArgs(["create", "Ada Lovelace"])).toEqual({
      ok: true,
      options: { command: "create", owner: "Ada Lovelace" },
    });
    expect(parseKeysArgs(["create", "ada", "--quota", "250"])).toEqual({
      ok: true,
      options: { command: "create", owner: "ada", quota: 250 },
    });
    expect(parseKeysArgs(["create", "--quota=5", "ada"])).toEqual({
      ok: true,
      options: { command: "create", owner: "ada", quota: 5 },
    });
  });

  it("reads list and revoke", () => {
    expect(parseKeysArgs(["list"])).toEqual({
      ok: true,
      options: { command: "list" },
    });
    expect(parseKeysArgs(["revoke", "key_abcdefgh"])).toEqual({
      ok: true,
      options: { command: "revoke", id: "key_abcdefgh" },
    });
  });

  it.each([
    [[], /no command/],
    [["frobnicate"], /unknown command: frobnicate/],
    [["create"], /needs an owner/],
    [["create", "  "], /needs an owner/],
    [["create", "ada", "bob"], /unexpected argument: bob/],
    [["create", "ada", "--quota"], /--quota/],
    [["create", "ada", "--quota", "0"], /positive integer/],
    [["create", "ada", "--quota", "ten"], /positive integer/],
    [["list", "--quota", "5"], /only goes with create/],
    [["list", "extra"], /unexpected argument/],
    [["revoke"], /needs a key id/],
    [["create", "ada", "--verbose"], /verbose/],
  ])("%j exits 2 with %s", (args, error) => {
    const parsed = parseKeysArgs(args);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.exitCode).toBe(2);
    expect(parsed.error).toMatch(error);
  });
});
