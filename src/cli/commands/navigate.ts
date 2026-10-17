import type { ApiTarget } from "../args";
import { storedKeyOf } from "../config";
import {
  type CliHttpResult,
  durationWords,
  getJson,
  retryAfterSeconds,
  TIMEOUT_MS,
} from "../http";
import {
  type CommandContext,
  failed,
  printOutcome,
  requestLookup,
} from "./lookup";

/**
 * The apiId `target` names: an apiId as is; a name through a Lookup, as
 * `spec` makes one, Resolved only. Any other Outcome is printed as `lookup`
 * prints it, and its exit code is the answer, as is a failed Lookup's.
 */
export async function apiIdOf(
  target: ApiTarget,
  context: CommandContext,
): Promise<string | number> {
  if (target.kind === "apiId") return target.apiId;
  const { http, configPath, note, globals, io, stderrColor } = context;
  const result = await requestLookup({ name: target.name }, http, {
    retryWithStored: true,
    stored: () => storedKeyOf(configPath, http.baseUrl, note),
  });
  if (!result.ok) return failed(result, globals, io, stderrColor);
  if (result.body.outcome !== "Resolved") return printOutcome(result, context);
  return result.body.api.id;
}

/**
 * `GET /api/apis/{apiId}/{resource}?{params}`, the apiId keeping its slash.
 * A failure is printed (`failed`: the server's body as is with `--json`)
 * and its exit code is the answer. 409 and 422 say the Spec's forms are
 * pending or failed, as the server answers them; `what` names what was asked
 * for, as in "The operation". `notFoundHint` gives a 404 the hint read from
 * its body, when the server's own hint isn't enough.
 */
export async function getNavigation<T>(
  {
    apiId,
    resource,
    params,
    what,
    notFoundHint,
  }: {
    apiId: string;
    resource: "outline" | "operation" | "schema";
    params: Record<string, string | undefined>;
    what: string;
    notFoundHint?: (body: unknown) => string | undefined;
  },
  { http, globals, io, stderrColor }: CommandContext,
): Promise<Extract<CliHttpResult<T>, { ok: true }> | number> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params))
    if (value !== undefined) query.set(name, value);
  const path = `/api/apis/${apiId.split("/").map(encodeURIComponent).join("/")}/${resource}${query.size > 0 ? `?${query}` : ""}`;
  const result = await getJson<T>(http, path, { timeoutMs: TIMEOUT_MS });
  if (result.ok) return result;
  const { status } = result.error;
  if (status === 409) {
    const retry = retryAfterSeconds(
      result.headers?.get("retry-after"),
      (io.now?.() ?? new Date()).getTime(),
    );
    return failed(
      {
        ...result,
        error: {
          status,
          error: `${what} can't be read yet: the Spec's forms are pending (still being built).`,
          hint: `Retry in ${durationWords(retry ?? 0)}.`,
        },
      },
      globals,
      io,
      stderrColor,
    );
  }
  if (status === 422)
    return failed(
      {
        ...result,
        error: {
          status,
          error: `The Spec's forms failed: ${result.error.error}`,
          hint: "So it has no Spec Outline or Normalized Form to read; `swaggerbot spec` still downloads its Published Form.",
        },
      },
      globals,
      io,
      stderrColor,
    );
  if (status === 404 && notFoundHint) {
    let body: unknown;
    try {
      body = JSON.parse(result.text ?? "");
    } catch {
      // Not JSON: no hint to read from it.
    }
    const hint = notFoundHint(body);
    if (hint)
      return failed(
        { ...result, error: { ...result.error, hint } },
        globals,
        io,
        stderrColor,
      );
  }
  return failed(result, globals, io, stderrColor);
}
