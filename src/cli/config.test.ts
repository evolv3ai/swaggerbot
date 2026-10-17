import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configPathOf,
  readConfig,
  removeKey,
  storedKeyOf,
  storeKey,
} from "./config";
import { keyOf } from "./http";

let dir: string;
let path: string;
let notes: string[];
const note = (message: string) => notes.push(message);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "swaggerbot-cli-config-"));
  path = join(dir, "nested", "config.json");
  notes = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("configPathOf", () => {
  it("is SWAGGERBOT_CONFIG when set, on any platform", () => {
    expect(
      configPathOf({ SWAGGERBOT_CONFIG: "/x/c.json" }, { platform: "win32" }),
    ).toBe("/x/c.json");
  });

  it("is $XDG_CONFIG_HOME/swaggerbot/config.json, or ~/.config/…, elsewhere", () => {
    expect(
      configPathOf(
        { XDG_CONFIG_HOME: "/xdg" },
        { platform: "linux", home: "/home/ada" },
      ),
    ).toBe("/xdg/swaggerbot/config.json");
    expect(configPathOf({}, { platform: "linux", home: "/home/ada" })).toBe(
      "/home/ada/.config/swaggerbot/config.json",
    );
  });

  it("is %APPDATA%\\swaggerbot\\config.json on Windows", () => {
    expect(
      configPathOf(
        { APPDATA: "C:\\Users\\ada\\AppData\\Roaming" },
        { platform: "win32", home: "C:\\Users\\ada" },
      ),
    ).toBe(
      join("C:\\Users\\ada\\AppData\\Roaming", "swaggerbot", "config.json"),
    );
  });
});

describe("the config file", () => {
  it("is written 0600 in a 0700 directory, as { keys: { origin: key } }", () => {
    storeKey(path, "https://swaggerbot.dev", "sb_one", note);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      keys: { "https://swaggerbot.dev": "sb_one" },
    });
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "nested")).mode & 0o777).toBe(0o700);
    }
  });

  it("keeps one key per origin and reads it for that origin only", () => {
    storeKey(path, "https://swaggerbot.dev", "sb_one", note);
    storeKey(path, "http://localhost:3000/some/path", "sb_local", note);
    storeKey(path, "https://swaggerbot.dev", "sb_two", note);

    expect(readConfig(path, note).keys).toEqual({
      "https://swaggerbot.dev": "sb_two",
      "http://localhost:3000": "sb_local",
    });
    expect(storedKeyOf(path, "https://swaggerbot.dev", note)).toBe("sb_two");
    expect(storedKeyOf(path, "http://localhost:3000", note)).toBe("sb_local");
    expect(storedKeyOf(path, "https://other.example", note)).toBeUndefined();
    expect(storedKeyOf(path, "not a url", note)).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it("is empty when missing, and empty with a note naming it when it isn't JSON", () => {
    expect(readConfig(path, note)).toEqual({ keys: {} });
    storeKey(path, "https://swaggerbot.dev", "sb_one", note);
    rmSync(path);
    expect(readConfig(path, note)).toEqual({ keys: {} });
    expect(notes).toEqual([]);

    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{");
    expect(readConfig(bad, note)).toEqual({ keys: {} });
    expect(storedKeyOf(bad, "https://swaggerbot.dev", note)).toBeUndefined();
    expect(notes).toEqual([
      `${bad} isn't JSON: read as holding no key; the next \`swaggerbot login\` or \`logout\` replaces it.`,
      `${bad} isn't JSON: read as holding no key; the next \`swaggerbot login\` or \`logout\` replaces it.`,
    ]);
    expect(readFileSync(bad, "utf8")).toBe("{");
  });

  it("forgets one origin's key on removeKey, says when there was none, and leaves an emptied config", () => {
    storeKey(path, "https://swaggerbot.dev", "sb_one", note);
    storeKey(path, "https://other.example", "sb_other", note);

    expect(removeKey(path, "https://swaggerbot.dev", note)).toBe(true);
    expect(readConfig(path, note).keys).toEqual({
      "https://other.example": "sb_other",
    });
    expect(removeKey(path, "https://swaggerbot.dev", note)).toBe(false);
    expect(removeKey(path, "https://other.example", note)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ keys: {} });
    expect(removeKey(path, "https://other.example", note)).toBe(false);
    expect(notes).toEqual([]);
  });

  it("replaces a file that isn't JSON on storeKey and on removeKey, with a note each", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{");

    expect(removeKey(bad, "https://swaggerbot.dev", note)).toBe(false);
    expect(JSON.parse(readFileSync(bad, "utf8"))).toEqual({ keys: {} });
    writeFileSync(bad, "{");
    storeKey(bad, "https://swaggerbot.dev", "sb_one", note);
    expect(JSON.parse(readFileSync(bad, "utf8"))).toEqual({
      keys: { "https://swaggerbot.dev": "sb_one" },
    });
    expect(notes).toHaveLength(2);
  });
});

describe("keyOf", () => {
  it("takes --key, else SWAGGERBOT_API_KEY, else none: the stored key is read by the command that needs it", () => {
    expect(keyOf("sb_flag", { SWAGGERBOT_API_KEY: "sb_env" })).toBe("sb_flag");
    expect(keyOf(undefined, { SWAGGERBOT_API_KEY: "sb_env" })).toBe("sb_env");
    expect(keyOf(undefined, { SWAGGERBOT_API_KEY: "  " })).toBeUndefined();
    expect(keyOf(undefined, {})).toBeUndefined();
  });
});
