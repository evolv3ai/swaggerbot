import type { Outcome } from "../../domain/outcome";
import type { CliCommand, CliGlobals } from "../args";
import {
  type CliHttp,
  type CliHttpError,
  KEYED_LOOKUP_TIMEOUT_MS,
  NEEDS_KEY_HINT,
  postJson,
  TIMEOUT_MS,
} from "../http";
import {
  type Io,
  outcomeExitCode,
  renderError,
  renderOutcome,
} from "../render";

export type LookupArgs = Extract<CliCommand, { command: "lookup" }>;

/** What `swaggerbot lookup` runs with, beyond its own arguments. */
export type CommandContext = {
  http: CliHttp;
  globals: CliGlobals;
  io: Io;
  color: boolean;
};

/**
 * `swaggerbot lookup <name>`: `POST /api/lookup`, then one line per Outcome
 * (or the body as is with `--json`). Exit 0 for Resolved, 1 for any other
 * Outcome, 3 when the request failed. `--fresh` needs a key, so without
 * one it says what the server would, and sends nothing.
 */
export async function runLookup(
  args: LookupArgs,
  { http, globals, io, color }: CommandContext,
): Promise<number> {
  if (args.fresh && !http.key)
    return failed(
      {
        error: {
          status: 401,
          error: "--fresh needs an API key.",
          hint: NEEDS_KEY_HINT,
        },
      },
      globals,
      io,
      color,
    );

  const body = {
    name: args.name,
    ...(args.apiVersion === undefined ? {} : { apiVersion: args.apiVersion }),
    ...(args.community ? { allowCommunity: true } : {}),
    ...(args.fresh ? { fresh: true } : {}),
  };
  const result = await postJson<Outcome>(http, "/api/lookup", body, {
    timeoutMs: http.key ? KEYED_LOOKUP_TIMEOUT_MS : TIMEOUT_MS,
  });
  if (!result.ok) return failed(result, globals, io, color);

  if (globals.json) io.stdout.write(`${result.text}\n`);
  else
    io.stdout.write(
      renderOutcome(result.body, { baseUrl: http.baseUrl, color }),
    );
  return outcomeExitCode(result.body);
}

/**
 * A failed request. With `--json`, stdout gets the server's body exactly as
 * it answered, or `{"status":0,"error":…}` when no answer came; otherwise
 * stderr gets the error for a person. Exit 3.
 */
export function failed(
  { error, text }: { error: CliHttpError; text?: string },
  globals: Pick<CliGlobals, "json">,
  io: Io,
  color: boolean,
): number {
  if (globals.json)
    io.stdout.write(
      `${text ?? JSON.stringify({ status: error.status, error: error.error })}\n`,
    );
  else io.stderr.write(renderError(error, color));
  return 3;
}
