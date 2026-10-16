/** Where the CLI goes unless `--url` or `SWAGGERBOT_URL` says otherwise. */
export const DEFAULT_URL = "https://swaggerbot.dev";

/** Where a Caller gets an API key. */
export const KEYS_URL = "https://swaggerbot.dev/keys";

/** Said whenever Discovery or `--fresh` is asked for without a key. */
export const NEEDS_KEY_HINT = `Discovery needs an API key. Get one at ${KEYS_URL}, then run \`swaggerbot login\`.`;

/** A request without a key waits this long; a keyed Lookup (Discovery) longer. */
export const TIMEOUT_MS = 30_000;
export const KEYED_LOOKUP_TIMEOUT_MS = 120_000;

/** What the CLI needs to reach a swagger.bot. */
export type CliHttp = {
  /** The origin, no trailing slash. */
  baseUrl: string;
  /** The API key, sent as the bearer when given. */
  key?: string;
  /** The CLI's version, for the User-Agent. */
  version: string;
  /** `globalThis.fetch` unless a test supplies one. */
  fetch?: typeof fetch;
};

/**
 * Why a request failed: the HTTP status (0 when no answer came at all),
 * what went wrong and, when known, what fixes it. The server's own `error`
 * and `hint` are kept when its body has them.
 */
export type CliHttpError = { status: number; error: string; hint?: string };

/** A request's answer: the parsed JSON and the exact bytes, or the error. */
export type CliHttpResult<T> =
  | { ok: true; status: number; body: T; text: string; headers: Headers }
  | { ok: false; error: CliHttpError };

/**
 * The CLI's origin: `--url`, else `SWAGGERBOT_URL`, else swaggerbot.dev,
 * without a trailing slash.
 */
export function baseUrlOf(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  return (
    (flag ?? env.SWAGGERBOT_URL?.trim() ?? "").replace(/\/+$/, "") ||
    DEFAULT_URL
  );
}

/** The key: `--key`, else `SWAGGERBOT_API_KEY`; none when neither is set. */
export function keyOf(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  return flag ?? (env.SWAGGERBOT_API_KEY?.trim() || undefined);
}

/** `swaggerbot-cli/<version> node/<v>`, so the server can tell the CLI apart. */
export function userAgentOf(version: string): string {
  return `swaggerbot-cli/${version} node/${process.versions.node}`;
}

/**
 * `POST <baseUrl><path>` with a JSON body, the bearer when a key is given,
 * and `timeoutMs` to answer. A 2xx is `ok` with the body parsed and its
 * exact text; anything else, or no answer, is the error mapped from the
 * server's body (`error`, `hint`) with a hint for the statuses the CLI
 * knows how to get past.
 */
export async function postJson<T>(
  http: CliHttp,
  path: string,
  body: unknown,
  { timeoutMs }: { timeoutMs: number },
): Promise<CliHttpResult<T>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": userAgentOf(http.version),
  };
  if (http.key) headers.authorization = `Bearer ${http.key}`;
  const doFetch = http.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(`${http.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, error: transportError(err, http.baseUrl, timeoutMs) };
  }

  const text = await response.text();
  if (response.ok) {
    try {
      return {
        ok: true,
        status: response.status,
        body: JSON.parse(text) as T,
        text,
        headers: response.headers,
      };
    } catch {
      return {
        ok: false,
        error: {
          status: response.status,
          error: `${http.baseUrl} answered ${response.status} but not with JSON.`,
        },
      };
    }
  }
  return { ok: false, error: serverError(response, text, http.baseUrl) };
}

/** A failed response as the CLI's error: the server's words, plus a way past. */
function serverError(
  response: Response,
  text: string,
  baseUrl: string,
): CliHttpError {
  const { status } = response;
  let parsed: { error?: unknown; hint?: unknown } = {};
  try {
    const json: unknown = JSON.parse(text);
    if (json && typeof json === "object") parsed = json as typeof parsed;
  } catch {
    // Not JSON: say what the status means.
  }
  const error =
    typeof parsed.error === "string" && parsed.error
      ? parsed.error
      : `${baseUrl} answered ${status}${response.statusText ? ` ${response.statusText}` : ""}.`;
  const serverHint = typeof parsed.hint === "string" ? parsed.hint : undefined;
  const retryAfter = response.headers.get("retry-after");

  switch (status) {
    case 401:
      return {
        status,
        error,
        hint: /needs an api key/i.test(error)
          ? NEEDS_KEY_HINT
          : `Check the key, or get a new one at ${KEYS_URL}, then run \`swaggerbot login\`.`,
      };
    case 429:
      return {
        status,
        error,
        hint: retryAfter
          ? `Retry in ${retryAfterWords(retryAfter)}.`
          : (serverHint ?? "Retry later."),
      };
    case 503:
      return {
        status,
        error,
        hint: retryAfter
          ? `Retry in ${retryAfterWords(retryAfter)}.`
          : (serverHint ?? "Retry shortly."),
      };
    default:
      return serverHint
        ? { status, error, hint: serverHint }
        : { status, error };
  }
}

/** No answer at all: refused, unreachable or too slow. Status 0. */
function transportError(
  err: unknown,
  baseUrl: string,
  timeoutMs: number,
): CliHttpError {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError")
    return {
      status: 0,
      error: `${baseUrl} did not answer within ${Math.round(timeoutMs / 1000)} s.`,
      hint: "Retry, or check the service at https://swaggerbot.dev/api/health.",
    };
  const cause = (err as { cause?: unknown })?.cause;
  const detail =
    cause instanceof Error
      ? cause.message
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    status: 0,
    error: `Could not reach ${baseUrl}: ${detail}`,
    hint: "Check the network, or --url / SWAGGERBOT_URL if you set one.",
  };
}

/** `retry-after` as words: seconds, or an HTTP date's distance from now. */
function retryAfterWords(value: string): string {
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.ceil(seconds / 3600)} h`;
}
