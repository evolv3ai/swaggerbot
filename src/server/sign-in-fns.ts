import { createServerFn } from "@tanstack/react-start";
import type { EmailSignIn, SignInRefusal } from "./email-sign-in";

/**
 * `/auth/sign-in`'s server functions: send a code, check it. Server-only
 * modules are imported inside the handlers, keeping them out of the client
 * bundle.
 */

// One per server, on `globalThis` for the reason `getApp` gives
// (src/server/app-instance.ts): its limits must be one.
const EMAIL_SIGN_IN = Symbol.for("swaggerbot.emailSignIn");
const held = globalThis as { [EMAIL_SIGN_IN]?: EmailSignIn };

/** What the page is told: the answer, or why not. */
export type SignInPage =
  | { state: "off" }
  | { state: "signed-in"; returnTo: string }
  | { state: "ready"; returnTo: string };

async function server() {
  const [
    { getRequest, setResponseHeader },
    { getAuthkit },
    { sessionEncryption },
    { signInConfigured },
    { clientIpHeader, clientIpOf, createWindowLimiter },
    {
      createEmailSignIn,
      CHECKS_PER_EMAIL_PER_10_MIN,
      SEND_PER_EMAIL_PER_HOUR,
      SEND_PER_IP_PER_HOUR,
    },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@workos/authkit-tanstack-react-start"),
    import("@workos/authkit-session"),
    import("./auth"),
    import("~/lookup/rate-limit"),
    import("./email-sign-in"),
  ]);
  const workos = async () => (await getAuthkit()).getWorkOS().userManagement;
  held[EMAIL_SIGN_IN] ??= createEmailSignIn({
    sendCode: async (email, { ip, userAgent }) => {
      await (await workos()).createMagicAuth({
        email,
        ...(ip === "unknown" ? {} : { ipAddress: ip }),
        userAgent,
      });
    },
    checkCode: async (email, code, { ip, userAgent }) => {
      const answer = await (await workos()).authenticateWithMagicAuth({
        clientId: process.env.WORKOS_CLIENT_ID,
        email,
        code,
        ...(ip === "unknown" ? {} : { ipAddress: ip }),
        userAgent,
      });
      return {
        accessToken: answer.accessToken,
        refreshToken: answer.refreshToken,
        user: answer.user,
        impersonator: answer.impersonator,
      };
    },
    // Sealed as AuthKit's callback seals it (AuthKitCore.encryptSession), and
    // saved through its storage, so its middleware reads it like any other.
    startSession: async (session) => {
      const sealed = await sessionEncryption.sealData(session, {
        password: process.env.WORKOS_COOKIE_PASSWORD ?? "",
        ttl: 0,
      });
      await (await getAuthkit()).saveSession(undefined, sealed);
    },
    limits: {
      sendPerEmail: createWindowLimiter({
        limit: SEND_PER_EMAIL_PER_HOUR,
        windowMs: 3_600_000,
      }),
      sendPerIp: createWindowLimiter({
        limit: SEND_PER_IP_PER_HOUR,
        windowMs: 3_600_000,
      }),
      checkPerEmail: createWindowLimiter({
        limit: CHECKS_PER_EMAIL_PER_10_MIN,
        windowMs: 600_000,
      }),
    },
  });
  setResponseHeader("cache-control", "private, no-store");
  const request = getRequest();
  return {
    signIn: held[EMAIL_SIGN_IN],
    configured: signInConfigured(),
    meta: {
      ip: clientIpOf(request, clientIpHeader()),
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    },
  };
}

const OFF: SignInRefusal = {
  ok: false,
  status: 503,
  error: "Sign-in is off on this site.",
};

/** Serves a refusal with its status (and `retry-after`), the answer as it is. */
async function answer<T extends { ok: true }>(
  result: T | SignInRefusal,
): Promise<T | SignInRefusal> {
  if (result.ok) return result;
  const { setResponseStatus, setResponseHeader } = await import(
    "@tanstack/react-start/server"
  );
  setResponseStatus(result.status);
  if (result.retryAfterSeconds)
    setResponseHeader("retry-after", String(result.retryAfterSeconds));
  return result;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Where `/auth/sign-in` stands for this visitor. */
export const getSignInPage = createServerFn({ method: "GET" })
  .inputValidator((input: { returnTo?: unknown }) => ({
    returnTo: text(input.returnTo),
  }))
  .handler(async ({ data }): Promise<SignInPage> => {
    const [
      { currentUser, returnPath, signInConfigured },
      { setResponseHeader },
    ] = await Promise.all([
      import("./auth"),
      import("@tanstack/react-start/server"),
    ]);
    if (!signInConfigured()) return { state: "off" };
    setResponseHeader("cache-control", "private, no-store");
    const returnTo = returnPath(data.returnTo);
    return currentUser()
      ? { state: "signed-in", returnTo }
      : { state: "ready", returnTo };
  });

/** Emails a sign-in code to the address typed in. */
export const sendSignInCode = createServerFn({ method: "POST" })
  .inputValidator((input: { email?: unknown }) => ({
    email: text(input.email).slice(0, 400),
  }))
  .handler(
    async ({ data }): Promise<{ ok: true; email: string } | SignInRefusal> => {
      const { signIn, configured, meta } = await server();
      if (!configured) return answer<never>(OFF);
      return answer(await signIn.sendCode({ email: data.email, ...meta }));
    },
  );

/** Checks the code; when it is right, the session cookie is on this answer. */
export const checkSignInCode = createServerFn({ method: "POST" })
  .inputValidator((input: { email?: unknown; code?: unknown }) => ({
    email: text(input.email).slice(0, 400),
    code: text(input.code).slice(0, 40),
  }))
  .handler(async ({ data }): Promise<{ ok: true } | SignInRefusal> => {
    const { signIn, configured, meta } = await server();
    if (!configured) return answer<never>(OFF);
    return answer(
      await signIn.checkCode({ email: data.email, code: data.code, ...meta }),
    );
  });
