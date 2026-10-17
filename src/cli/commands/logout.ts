import { removeKey } from "../config";
import { palette } from "../render";
import type { CommandContext } from "./lookup";

/**
 * `swaggerbot logout`: removes the key `login` stored for this
 * swagger.bot's origin, and says when there was none; a config file that
 * isn't JSON is replaced by an empty one. Exit 0 either way. With `--json`,
 * `{ "url", "removed" }`.
 */
export async function runLogout(
  _args: unknown,
  { http, configPath, note, globals, io, color }: CommandContext,
): Promise<number> {
  const removed = removeKey(configPath, http.baseUrl, note);
  if (globals.json) {
    io.stdout.write(`${JSON.stringify({ url: http.baseUrl, removed })}\n`);
    return 0;
  }
  const p = palette(color);
  io.stdout.write(
    removed
      ? `${p.green(p.bold("Signed out"))} of ${http.baseUrl}: the stored key is forgotten\n`
      : `${p.dim("No key was stored")} for ${http.baseUrl}; nothing to forget\n`,
  );
  return 0;
}
