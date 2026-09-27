import { createServerFn } from "@tanstack/react-start";
import type {
  KeyIssued,
  KeyPage,
  KeyRefusal,
  KeyRevoked,
  KeysPage,
} from "./keys-page";

/**
 * `/keys`'s server functions over `createKeyPage`, for whoever is signed in
 * on the request (`currentUser()`); none takes a key id. Server-only modules
 * are imported inside the handlers, keeping them out of the client bundle.
 */

// One per server, on `globalThis` for the reason `getApp` gives
// (src/server/app-instance.ts): its per-person limit and queue must be one.
const KEY_PAGE = Symbol.for("swaggerbot.keyPage");
const held = globalThis as { [KEY_PAGE]?: KeyPage };

async function server() {
  const [
    { getRequest, setResponseStatus, setResponseHeader },
    { currentUser, signInConfigured },
    { gate, getApp },
    { unkeyConfigOf },
    { createWindowLimiter },
    { createKeyPage, KEY_ACTIONS_PER_HOUR },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./auth"),
    import("./app-instance"),
    import("~/index-store/key-store"),
    import("~/lookup/rate-limit"),
    import("./keys-page"),
  ]);
  held[KEY_PAGE] ??= createKeyPage({
    keys: getApp().keys,
    // The page needs both (D9); without them keys are issued by hand.
    configured: signInConfigured() && unkeyConfigOf(process.env) !== undefined,
    quota: gate.dailyQuota,
    perUser: createWindowLimiter({
      limit: KEY_ACTIONS_PER_HOUR,
      windowMs: 3_600_000,
    }),
    gate,
  });
  // Every answer here is one person's, and create and roll carry a secret:
  // no cache may keep any of them.
  setResponseHeader("cache-control", "private, no-store");
  return {
    keyPage: held[KEY_PAGE],
    user: currentUser(),
    request: getRequest(),
    setResponseStatus,
  };
}

/** Serves a refusal with its status (and `retry-after`), the answer as it is. */
async function answer<T extends { ok: true }>(
  result: T | KeyRefusal,
): Promise<T | KeyRefusal> {
  if (result.ok) return result;
  const { setResponseStatus, setResponseHeader } = await import(
    "@tanstack/react-start/server"
  );
  setResponseStatus(result.status);
  if (result.retryAfterSeconds)
    setResponseHeader("retry-after", String(result.retryAfterSeconds));
  return result;
}

/** What `/keys` shows the person on this request. */
export const getKeysPage = createServerFn({ method: "GET" }).handler(
  async (): Promise<KeysPage> => {
    const [{ keyPage, user, request, setResponseStatus }, { publicBaseUrlOf }] =
      await Promise.all([server(), import("~/spec-forms/outcome")]);
    const baseUrl = (
      publicBaseUrlOf(process.env) ?? new URL(request.url).origin
    ).replace(/\/+$/, "");
    const page = await keyPage.page(user, baseUrl);
    setResponseStatus(page.status);
    return page;
  },
);

/** Creates the signed-in person's key; its secret is in this answer only. */
export const createOwnKey = createServerFn({ method: "POST" }).handler(
  async (): Promise<KeyIssued | KeyRefusal> => {
    const { keyPage, user, request } = await server();
    return answer(await keyPage.create(user, request));
  },
);

/** Rolls the signed-in person's key: a new secret, shown once. */
export const rollOwnKey = createServerFn({ method: "POST" }).handler(
  async (): Promise<KeyIssued | KeyRefusal> => {
    const { keyPage, user, request } = await server();
    return answer(await keyPage.roll(user, request));
  },
);

/** Revokes the signed-in person's key. */
export const revokeOwnKey = createServerFn({ method: "POST" }).handler(
  async (): Promise<KeyRevoked | KeyRefusal> => {
    const { keyPage, user, request } = await server();
    return answer(await keyPage.revoke(user, request));
  },
);
