import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The CLI's config file (D3): the keys `swaggerbot login` stored, one per
 * swagger.bot origin, each sent to that origin only. Nothing else is kept
 * in it, and the key is written nowhere else.
 */
export type CliConfig = { keys: Record<string, string> };

/**
 * Where the config file lives: `SWAGGERBOT_CONFIG` when set; else
 * `%APPDATA%\swaggerbot\config.json` on Windows and
 * `$XDG_CONFIG_HOME/swaggerbot/config.json` (`~/.config/…`) elsewhere.
 */
export function configPathOf(
  env: NodeJS.ProcessEnv,
  { platform = process.platform, home = homedir() } = {},
): string {
  const override = env.SWAGGERBOT_CONFIG?.trim();
  if (override) return override;
  const base =
    platform === "win32"
      ? env.APPDATA?.trim() || join(home, "AppData", "Roaming")
      : env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return join(base, "swaggerbot", "config.json");
}

/** The origin a swagger.bot URL names, the part a key is stored under; undefined when it isn't a URL. */
export function originOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
}

/** The config file as it stands, or an empty one when there is none; a file that isn't the config is an error naming it. */
export function readConfig(path: string): CliConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return { keys: {} };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} isn't JSON; fix or remove it.`);
  }
  const keys =
    parsed && typeof parsed === "object"
      ? (parsed as { keys?: unknown }).keys
      : undefined;
  const config: CliConfig = { keys: {} };
  if (keys && typeof keys === "object")
    for (const [origin, key] of Object.entries(keys))
      if (typeof key === "string" && key) config.keys[origin] = key;
  return config;
}

/**
 * Writes the config, readable by its owner only (mode 0600, in a 0700
 * directory, made as needed): written whole to a sibling, then moved into
 * place, so a crash leaves the old file, never half of the new.
 */
export function writeConfig(path: string, config: CliConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  // The mode on write applies only to a new file: say it again for one that was there.
  if (process.platform !== "win32") chmodSync(temp, 0o600);
  renameSync(temp, path);
}

/** The key stored for `baseUrl`'s origin, and no other's; none without one. */
export function storedKeyOf(path: string, baseUrl: string): string | undefined {
  const origin = originOf(baseUrl);
  if (!origin) return undefined;
  return readConfig(path).keys[origin];
}

/** Stores `key` for `baseUrl`'s origin, keeping the other origins' keys. */
export function storeKey(path: string, baseUrl: string, key: string): void {
  const origin = originOf(baseUrl);
  if (!origin) throw new Error(`${baseUrl} isn't a URL.`);
  const config = readConfig(path);
  config.keys[origin] = key;
  writeConfig(path, config);
}

/**
 * Removes the key stored for `baseUrl`'s origin: true when there was one.
 * A config with no key left is removed with it.
 */
export function removeKey(path: string, baseUrl: string): boolean {
  const origin = originOf(baseUrl);
  if (!origin) return false;
  const config = readConfig(path);
  if (!(origin in config.keys)) return false;
  delete config.keys[origin];
  if (Object.keys(config.keys).length === 0) {
    try {
      unlinkSync(path);
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") throw err;
    }
  } else writeConfig(path, config);
  return true;
}
