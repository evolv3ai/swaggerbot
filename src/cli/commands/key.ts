import { getJson, KEYS_URL, type KeyAnswer, TIMEOUT_MS } from "../http";
import { creditsWords, palette, resetWords } from "../render";
import { type CommandContext, failed } from "./lookup";

/**
 * `swaggerbot key`: `GET /api/key` with the key in use (`--key`, else
 * `SWAGGERBOT_API_KEY`, else the one `login` stored for this origin), and
 * one line: its id, the credits left today and when they reset. Without a
 * key it says so. Exit 0, or 3 when there is no key or the request failed.
 */
export async function runKey(
  _args: unknown,
  { http, globals, io, color, stderrColor }: CommandContext,
): Promise<number> {
  if (!http.key)
    return failed(
      {
        error: {
          status: 0,
          error: `No API key is configured for ${http.baseUrl}.`,
          hint: `Get one at ${KEYS_URL}, then run \`swaggerbot login\`.`,
        },
      },
      globals,
      io,
      stderrColor,
    );
  const result = await getJson<KeyAnswer>(http, "/api/key", {
    timeoutMs: TIMEOUT_MS,
  });
  if (!result.ok) return failed(result, globals, io, stderrColor);
  if (globals.json) {
    io.stdout.write(`${result.text}\n`);
    return 0;
  }
  const p = palette(color);
  const { id, remaining, limit, resetsAt } = result.body;
  const now = io.now?.() ?? new Date();
  const parts = [p.bold(id)];
  if (remaining === undefined) parts.push("credits unknown");
  else
    parts.push(
      `${creditsWords(remaining)}${limit === undefined ? "" : ` of ${limit}`}`,
    );
  if (resetsAt) parts.push(p.dim(resetWords(resetsAt, now)));
  io.stdout.write(`${parts.filter(Boolean).join("  ")}\n`);
  return 0;
}
