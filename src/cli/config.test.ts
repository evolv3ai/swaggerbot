import {
  existsSync,
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "swaggerbot-cli-config-"));
  path = join(dir, "nested", "config.json");
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
    storeKey(path, "https://swaggerbot.dev", "sb_one");

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      keys: { "https://swaggerbot.dev": "sb_one" },
    });
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "nested")).mode & 0o777).toBe(0o700);
    }
  });

  it("keeps one key per origin and reads it for that origin only", () => {
    storeKey(path, "https://swaggerbot.dev", "sb_one");
    storeKey(path, "http://localhost:3000/some/path", "sb_local");
    storeKey(path, "https://swaggerbot.dev", "sb_two");

    expect(readConfig(path).keys).toEqual({
      "https://swaggerbot.dev": "sb_two",
      "http://localhost:3000": "sb_local",
    });
    expect(storedKeyOf(path, "https://swaggerbot.dev")).toBe("sb_two");
    expect(storedKeyOf(path, "http://localhost:3000")).toBe("sb_local");
    expect(storedKeyOf(path, "https://other.example")).toBeUndefined();
    expect(storedKeyOf(path, "not a url")).toBeUndefined();
  });

  it("is empty when missing, and an error naming it when it isn't JSON", () => {
    expect(readConfig(path)).toEqual({ keys: {} });
    storeKey(path, "https://swaggerbot.dev", "sb_one");
    rmSync(path);
    expect(readConfig(path)).toEqual({ keys: {} });
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{");
    expect(() => readConfig(bad)).toThrow(`${bad} isn't JSON`);
  });

  it("forgets one origin's key on removeKey, says when there was none, and removes an emptied file", () => {
    storeKey(path, "https://swaggerbot.dev", "sb_one");
    storeKey(path, "https://other.example", "sb_other");

    expect(removeKey(path, "https://swaggerbot.dev")).toBe(true);
    expect(readConfig(path).keys).toEqual({
      "https://other.example": "sb_other",
    });
    expect(removeKey(path, "https://swaggerbot.dev")).toBe(false);
    expect(removeKey(path, "https://other.example")).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(removeKey(path, "https://other.example")).toBe(false);
  });
});

describe("keyOf", () => {
  it("takes --key, else SWAGGERBOT_API_KEY, else the stored key for the origin, else none", () => {
    storeKey(path, "https://swaggerbot.dev", "sb_stored");
    const config = { path, baseUrl: "https://swaggerbot.dev" };

    expect(keyOf("sb_flag", { SWAGGERBOT_API_KEY: "sb_env" }, config)).toBe(
      "sb_flag",
    );
    expect(keyOf(undefined, { SWAGGERBOT_API_KEY: "sb_env" }, config)).toBe(
      "sb_env",
    );
    expect(keyOf(undefined, {}, config)).toBe("sb_stored");
    expect(
      keyOf(undefined, {}, { path, baseUrl: "https://other.example" }),
    ).toBeUndefined();
    expect(keyOf(undefined, {})).toBeUndefined();
  });
});
