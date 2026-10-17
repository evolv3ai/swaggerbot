import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type { KeyAnswer } from "../../domain/api-key";
import { storeKey } from "../config";
import { type CliHttp, getJson, KEYS_URL, TIMEOUT_MS } from "../http";
import { creditsWords, type Io, palette } from "../render";
import { type CommandContext, failed } from "./lookup";

/** Said when a key is needed and the person has none in hand. */
const NO_KEY_GIVEN = `No key given. Get one at ${KEYS_URL} and pass it with --key, or pipe it in.`;

/**
 * `swaggerbot login [--key K]`: the key from `--key`, else prompted for
 * (hidden on a terminal, read from a pipe otherwise), checked with
 * `GET /api/key` at no cost, then stored for this swagger.bot's origin and
 * no other's. A key that isn't live (401) is said so and stored nowhere;
 * a key store outage (503) is said with when to retry. The key is never
 * echoed. Exit 0 when signed in, 3 when the request failed, 2 without a
 * key to check.
 */
export async function runLogin(
  _args: unknown,
  { http, configPath, note, globals, io, color, stderrColor }: CommandContext,
): Promise<number> {
  const key = globals.key ?? (await promptKey(io));
  if (!key) {
    io.stderr.write(
      `${palette(stderrColor).red(palette(stderrColor).bold("error"))}  ${NO_KEY_GIVEN}\n`,
    );
    return 2;
  }
  const keyed: CliHttp = { ...http, key };
  const result = await getJson<KeyAnswer>(keyed, "/api/key", {
    timeoutMs: TIMEOUT_MS,
  });
  if (!result.ok) {
    const error =
      result.error.status === 401
        ? { ...result.error, error: "That key isn't live." }
        : result.error;
    return failed({ error, text: result.text }, globals, io, stderrColor);
  }

  storeKey(configPath, http.baseUrl, key, note);
  if (globals.json) {
    io.stdout.write(`${result.text}\n`);
    return 0;
  }
  const p = palette(color);
  const { id, remaining } = result.body;
  const credits = remaining === undefined ? "" : `: ${creditsWords(remaining)}`;
  io.stdout.write(
    `${p.green(p.bold("Signed in"))} to ${http.baseUrl} as ${id}${credits}\n`,
  );
  return 0;
}

/**
 * The key typed at a terminal, hidden (readline writes its echo to a sink,
 * so nothing shows), or the first line piped in; empty when neither gives
 * one, or when the prompt is left with Ctrl-C or Ctrl-D.
 */
async function promptKey(io: Io): Promise<string> {
  const { stdin } = io;
  if (!stdin) return "";
  if (stdin.isTTY) {
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rl = createInterface({ input: stdin, output: muted, terminal: true });
    rl.on("SIGINT", () => rl.close());
    io.stderr.write("API key (hidden): ");
    try {
      return (
        await new Promise<string>((resolve) => {
          rl.once("close", () => resolve(""));
          rl.question("", (answer) => resolve(answer));
        })
      ).trim();
    } finally {
      rl.close();
      io.stderr.write("\n");
    }
  }
  const rl = createInterface({ input: stdin, terminal: false });
  try {
    for await (const line of rl) {
      const key = line.trim();
      if (key) return key;
    }
    return "";
  } finally {
    rl.close();
  }
}
