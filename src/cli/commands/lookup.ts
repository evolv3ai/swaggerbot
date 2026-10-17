import type { Outcome } from "../../domain/outcome";
import type { CliCommand, CliGlobals } from "../args";
import { type Note, storedKeyOf } from "../config";
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

/** What a command runs with, beyond its own arguments. */
export type CommandContext = {
  /** With the key in hand (`--key`, `SWAGGERBOT_API_KEY`), if any; the stored one is read only when needed. */
  http: CliHttp;
  /** The config file `login` writes and `logout` empties (D3). */
  configPath: string;
  /** Where a command says what it went on past: a config file that isn't JSON. */
  note: Note;
  globals: CliGlobals;
  io: Io;
  /** Whether to colour stdout, and separately stderr. */
  color: boolean;
  stderrColor: boolean;
};

/**
 * `swaggerbot lookup <name>`: `POST /api/lookup`, then one line per Outcome
 * (or the body as is with `--json`). Exit 0 for Resolved, 1 for any other
 * Outcome, 3 when the request failed. The key in hand goes with the
 * request; the stored one is read only when a key is needed: for `--fresh`
 * before sending, else when the server answers 401 for a name the Index
 * can't answer, and the Lookup is sent again with it. `--fresh` with no
 * key at all says what the server would, and sends nothing; with `--json`
 * the request goes out so stdout carries the server's own answer.
 */
export async function runLookup(
  args: LookupArgs,
  { http, configPath, note, globals, io, color, stderrColor }: CommandContext,
): Promise<number> {
  const stored = () => storedKeyOf(configPath, http.baseUrl, note);
  let keyed = http;
  if (args.fresh && !http.key) keyed = { ...http, key: stored() };
  if (args.fresh && !keyed.key && !globals.json)
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
      stderrColor,
    );

  const body = {
    name: args.name,
    ...(args.apiVersion === undefined ? {} : { apiVersion: args.apiVersion }),
    ...(args.community ? { allowCommunity: true } : {}),
    ...(args.fresh ? { fresh: true } : {}),
  };
  const post = (through: CliHttp) =>
    postJson<Outcome>(through, "/api/lookup", body, {
      timeoutMs: through.key ? KEYED_LOOKUP_TIMEOUT_MS : TIMEOUT_MS,
    });
  let result = await post(keyed);
  if (!result.ok && result.error.status === 401 && !keyed.key && !args.fresh) {
    const key = stored();
    if (key) result = await post({ ...http, key });
  }
  if (!result.ok) return failed(result, globals, io, stderrColor);

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
