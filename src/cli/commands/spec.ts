import { createHash, randomBytes } from "node:crypto";
import { type FileHandle, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { CliCommand } from "../args";
import { storedKeyOf } from "../config";
import {
  type CliHttpError,
  DOWNLOAD_TIMEOUT_MS,
  durationWords,
  getDownload,
  getJson,
  retryAfterSeconds,
  TIMEOUT_MS,
  transportError,
} from "../http";
import { EXIT, palette, renderUsageError, sizeWords } from "../render";
import {
  type CommandContext,
  failed,
  printOutcome,
  requestLookup,
} from "./lookup";

export type SpecArgs = Extract<CliCommand, { command: "spec" }>;

/** How long, in all, `spec` waits for a Normalized Form being built. */
export const BUILD_WAIT_SECONDS = 120;

/** The wait between tries when the server gives no `retry-after`. */
const DEFAULT_RETRY_SECONDS = 10;

/** The Spec to download: its id, its API's id when known, and the form's URL. */
type Chosen = { specId: string; apiId: string | null; url: string };

/** What `GET /api/apis/{apiId}/outline` answers that `spec` reads. */
type OutlineBody = {
  apiId: string;
  specId: string;
  downloads: { published: string; normalized: string };
};

/** A request's failure as `whileBuilding` reads it: 409 is "still being built". */
type Attempt =
  | { ok: true }
  | { ok: false; error: CliHttpError; text?: string; headers?: Headers };

/**
 * `swaggerbot spec <name | apiId | specId>`: downloads one form of a Spec.
 * A Spec id needs no Lookup; an apiId's Current Spec is read from its
 * outline; a name is looked up, and only a Resolved answer is downloaded
 * (its Current Spec, or with `--api-version` the Spec of that API Version);
 * any other Outcome is printed as `lookup` prints it, with its exit code.
 * The bytes go to `-o FILE`, else to stdout on a pipe, else to the file
 * the server names in the current directory (`--force` to overwrite it).
 * A Normalized Form being built is waited for, `retry-after` at a time, up
 * to `BUILD_WAIT_SECONDS`; `--no-wait` fails at once. The Published Form's
 * sha256 must be its Spec id. Exit codes as `EXIT`.
 */
export async function runSpec(
  args: SpecArgs,
  context: CommandContext,
): Promise<number> {
  const { globals, io, stderrColor } = context;
  if (globals.json && args.output === undefined && !io.isTTY) {
    io.stderr.write(
      renderUsageError(
        "--json can't share stdout with the Spec's bytes: give -o FILE",
        stderrColor,
      ),
    );
    return EXIT.usage;
  }
  const chosen = await choose(args, context);
  if (typeof chosen === "number") return chosen;
  return download(args, chosen, context);
}

/** The Spec the argument names, or the exit code when there is none to download. */
async function choose(
  args: SpecArgs,
  context: CommandContext,
): Promise<Chosen | number> {
  const { http, configPath, note, globals, io, stderrColor } = context;
  const { target, form } = args;
  switch (target.kind) {
    case "specId":
      return {
        specId: target.specId,
        apiId: null,
        url: `/api/specs/${target.specId}/${form}`,
      };
    case "apiId": {
      const path = `/api/apis/${target.apiId.split("/").map(encodeURIComponent).join("/")}/outline`;
      const result = await whileBuilding(
        () => getJson<OutlineBody>(http, path, { timeoutMs: TIMEOUT_MS }),
        args,
        context,
      );
      if (typeof result === "number") return result;
      if (!result.ok)
        return failed(
          result.error.status === 422
            ? {
                ...result,
                error: {
                  ...result.error,
                  hint: `Its Spec Outline couldn't be built, so its Current Spec can't be found by apiId: name the API, or give its Spec id.`,
                },
              }
            : result,
          globals,
          io,
          stderrColor,
        );
      return {
        specId: result.body.specId,
        apiId: result.body.apiId,
        url: result.body.downloads[form],
      };
    }
    case "name": {
      const result = await requestLookup({ name: target.name }, http, {
        retryWithStored: true,
        stored: () => storedKeyOf(configPath, http.baseUrl, note),
      });
      if (!result.ok) return failed(result, globals, io, stderrColor);
      const outcome = result.body;
      if (outcome.outcome !== "Resolved") return printOutcome(result, context);
      const specs = [outcome.currentSpec, ...outcome.alternateSpecs];
      const spec =
        args.apiVersion === undefined
          ? outcome.currentSpec
          : specs.find((s) => s.apiVersion === args.apiVersion);
      if (!spec) {
        const versions = specs.map(
          (s) =>
            `${s.apiVersion ?? "none"}${s === outcome.currentSpec ? " (Current)" : ""}`,
        );
        return failed(
          {
            error: {
              status: 404,
              error: `${outcome.api.name} (${outcome.api.id}) has no Spec for API Version ${args.apiVersion}.`,
              hint: `Its API Versions: ${versions.join(", ")}.`,
            },
          },
          globals,
          io,
          stderrColor,
        );
      }
      return {
        specId: spec.id,
        apiId: outcome.api.id,
        url: spec.downloads[form],
      };
    }
  }
}

/**
 * Tries `attempt` until it answers other than 409 (a Normalized Form being
 * built), waiting the server's `retry-after` between tries and
 * `BUILD_WAIT_SECONDS` in all; `--no-wait` gives up at the first 409. Gives
 * the last answer, or the exit code when it gave up.
 */
async function whileBuilding<R extends Attempt>(
  attempt: () => Promise<R>,
  args: SpecArgs,
  { globals, io, stderrColor }: CommandContext,
): Promise<R | number> {
  const sleep =
    io.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = () => (io.now?.() ?? new Date()).getTime();
  let waited = 0;
  for (;;) {
    const result = await attempt();
    if (result.ok || result.error.status !== 409) return result;
    const retry = Math.max(
      1,
      retryAfterSeconds(result.headers?.get("retry-after"), now()) ??
        DEFAULT_RETRY_SECONDS,
    );
    const giveUp = (error: string, hint: string) =>
      failed(
        { error: { status: 409, error, hint }, text: result.text },
        globals,
        io,
        stderrColor,
      );
    if (args.noWait)
      return giveUp(
        "The Normalized Form is being built.",
        `Retry in ${durationWords(retry)}, or leave out --no-wait to wait for it.`,
      );
    if (waited >= BUILD_WAIT_SECONDS)
      return giveUp(
        `The Normalized Form is still being built after ${BUILD_WAIT_SECONDS} s.`,
        args.form === "normalized"
          ? "Retry in a minute, or download the Published Form (leave out --form normalized)."
          : "Retry in a minute, or name the API instead of its apiId.",
      );
    if (waited === 0)
      io.stderr.write(
        `${palette(stderrColor).dim("Normalized Form being built…")}\n`,
      );
    const wait = Math.min(retry, BUILD_WAIT_SECONDS - waited);
    await sleep(wait * 1000);
    waited += wait;
  }
}

/** Downloads `chosen`'s form to where `args` and the terminal say, then says what was written. */
async function download(
  args: SpecArgs,
  chosen: Chosen,
  context: CommandContext,
): Promise<number> {
  const { http, globals, io, stderrColor } = context;
  const refuse = (error: string, hint?: string) =>
    failed(
      { error: { status: 0, error, ...(hint ? { hint } : {}) } },
      globals,
      io,
      stderrColor,
    );

  const result = await whileBuilding(
    () => getDownload(http, chosen.url),
    args,
    context,
  );
  if (typeof result === "number") return result;
  if (!result.ok) return failed(result, globals, io, stderrColor);
  const { response, alive, done } = result;

  // Where the bytes go: `shown` is the path as said back, `path` where it is.
  let file: { path: string; shown: string } | undefined;
  if (args.output !== undefined)
    file = { path: args.output, shown: args.output };
  else if (io.isTTY) {
    const name = fileNameOf(response.headers, chosen, args.form);
    file = { path: join(io.cwd ?? process.cwd(), name), shown: name };
    if (!args.force && (await exists(file.path))) {
      done();
      await response.body?.cancel().catch(() => {});
      return refuse(
        `${name} exists already.`,
        "Pass --force to overwrite it, or -o another path.",
      );
    }
  }

  // A file is written beside itself, then renamed into place once its bytes
  // are known good, so a failed download never leaves a file behind.
  const part = file
    ? join(
        dirname(file.path),
        `.${basename(file.path)}.${randomBytes(4).toString("hex")}.part`,
      )
    : undefined;
  let handle: FileHandle | undefined;
  const discard = async () => {
    await handle?.close().catch(() => {});
    if (part) await rm(part, { force: true });
  };
  if (file && part)
    try {
      handle = await open(part, "wx");
    } catch (err) {
      done();
      await response.body?.cancel().catch(() => {});
      return refuse(`Can't write ${file.shown}: ${(err as Error).message}`);
    }

  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const reader = response.body?.getReader();
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) break;
      alive();
      hash.update(next.value);
      bytes += next.value.byteLength;
      if (handle) await handle.write(next.value);
      else await writeOut(io, next.value);
    }
  } catch (err) {
    await discard();
    if (typeof (err as { code?: unknown }).code === "string" && file)
      return refuse(`Can't write ${file.shown}: ${(err as Error).message}`);
    return failed(
      { error: transportError(err, http.baseUrl, DOWNLOAD_TIMEOUT_MS) },
      globals,
      io,
      stderrColor,
    );
  } finally {
    done();
  }

  const sha256 = hash.digest("hex");
  if (args.form === "published" && sha256 !== chosen.specId) {
    await discard();
    return refuse(
      `The bytes downloaded aren't Spec ${chosen.specId}: their sha256 is ${sha256}.`,
      file
        ? "Nothing was kept. Retry; if it happens again, something between you and the server changed them."
        : "Don't use what was written to stdout. Retry; if it happens again, something between you and the server changed them.",
    );
  }
  if (handle && file && part) {
    try {
      await handle.close();
      handle = undefined;
      await rename(part, file.path);
    } catch (err) {
      await discard();
      return refuse(`Can't write ${file.shown}: ${(err as Error).message}`);
    }
    io.stderr.write(`Wrote ${file.shown} (${sizeWords(bytes)})\n`);
  }
  if (globals.json)
    io.stdout.write(
      `${JSON.stringify({
        specId: chosen.specId,
        apiId: chosen.apiId,
        form: args.form,
        path: file ? file.shown : "stdout",
        bytes,
        sha256,
      })}\n`,
    );
  return EXIT.ok;
}

/**
 * The file name the server gives in `content-disposition`, as a plain name
 * in the current directory and nothing else; else one made like it:
 * `<api>-<first 12 of the Spec id>.json`, `.normalized.json` for that form.
 */
function fileNameOf(
  headers: Headers,
  chosen: Chosen,
  form: SpecArgs["form"],
): string {
  const given = /filename\s*=\s*"?([^";]+)"?/i
    .exec(headers.get("content-disposition") ?? "")?.[1]
    ?.trim();
  const name = [...basename((given ?? "").replace(/\\/g, "/"))]
    .filter((c) => c >= " " && c !== "\u007f")
    .join("");
  if (name && !name.startsWith(".")) return name;
  const slug = chosen.apiId?.slice(chosen.apiId.indexOf("/") + 1);
  const extension =
    form === "normalized"
      ? "normalized.json"
      : /yaml/i.test(headers.get("content-type") ?? "")
        ? "yaml"
        : "json";
  return `${slug ? `${slug}-` : ""}${chosen.specId.slice(0, 12)}.${extension}`;
}

/** Whether anything is at `path`. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes `chunk` to stdout, waiting for it to drain when it says to. */
async function writeOut(
  io: CommandContext["io"],
  chunk: Uint8Array,
): Promise<void> {
  if (io.stdout.write(chunk) === false && io.stdout.once)
    await new Promise<void>((resolve) => io.stdout.once?.("drain", resolve));
}
