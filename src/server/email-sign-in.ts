import type { RateLimiter } from "~/lookup/rate-limit";

/**
 * Email sign-in on our own page (Magic Auth, D5): WorkOS emails a six-digit
 * code, the visitor types it in, and WorkOS's answer becomes the same sealed
 * session AuthKit's callback would have set. WorkOS's hosted page is not in
 * the path: it bounced every visitor back without a code (SESSION 1f/1g).
 * The same code signs up someone new.
 */

/** Who is asking, passed on to WorkOS for its own checks. */
export type RequestMeta = { ip: string; userAgent: string };

/** What WorkOS answers a good code with; sealed as it is into the cookie. */
export type WorkOSSession = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
  impersonator?: unknown;
};

export type EmailSignInDeps = {
  /** WorkOS `createMagicAuth`: emails a code to `email`. */
  sendCode(email: string, meta: RequestMeta): Promise<void>;
  /** WorkOS `authenticateWithMagicAuth`: throws when the code is refused. */
  checkCode(
    email: string,
    code: string,
    meta: RequestMeta,
  ): Promise<WorkOSSession>;
  /** Seals `session` into AuthKit's session cookie on this response. */
  startSession(session: WorkOSSession): Promise<void>;
  limits: {
    sendPerEmail: RateLimiter;
    sendPerIp: RateLimiter;
    checkPerEmail: RateLimiter;
  };
  warn?: (message: string) => void;
};

export type SignInRefusal = {
  ok: false;
  status: 400 | 429 | 503;
  error: string;
  retryAfterSeconds?: number;
};

/** Codes sent to one address an hour, and from one IP. */
export const SEND_PER_EMAIL_PER_HOUR = 5;
export const SEND_PER_IP_PER_HOUR = 20;
/** Codes tried for one address in 10 minutes, the life of a code. */
export const CHECKS_PER_EMAIL_PER_10_MIN = 10;

const MAX_EMAIL = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6}$/;

const UNAVAILABLE =
  "Sign-in can't be reached right now. Try again in a minute.";

function refuse(
  status: SignInRefusal["status"],
  error: string,
  retryAfterSeconds?: number,
): SignInRefusal {
  return retryAfterSeconds === undefined
    ? { ok: false, status, error }
    : { ok: false, status, error, retryAfterSeconds };
}

function tooMany(retryAfterSeconds: number): SignInRefusal {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return refuse(
    429,
    `Too many tries. Wait ${minutes} min and try again.`,
    retryAfterSeconds,
  );
}

/** The HTTP status on a WorkOS SDK error; undefined when the call never got an answer. */
function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

/** WorkOS's code and message on an error, for the log: `authentication_method_not_allowed: Magic Auth is disabled.` */
function detailOf(error: unknown): string {
  const { code, error: oauthError } = (error ?? {}) as {
    code?: unknown;
    error?: unknown;
  };
  const named = typeof code === "string" ? code : oauthError;
  const message = error instanceof Error ? error.message : String(error);
  return `${typeof named === "string" ? `${named}: ` : ""}${message}`.slice(
    0,
    300,
  );
}

export function createEmailSignIn(deps: EmailSignInDeps) {
  const warn = deps.warn ?? console.warn;

  return {
    /** Emails a sign-in code to `email`, unless the address or a limit says no. */
    async sendCode({
      email: typed,
      ...meta
    }: { email: string } & RequestMeta): Promise<
      { ok: true; email: string } | SignInRefusal
    > {
      const email = typed.trim();
      if (email.length > MAX_EMAIL || !EMAIL.test(email))
        return refuse(400, "Enter your email address, like you@example.com.");
      for (const [limiter, key] of [
        [deps.limits.sendPerEmail, email.toLowerCase()],
        [deps.limits.sendPerIp, meta.ip],
      ] as const) {
        const taken = limiter.take(key);
        if (!taken.allowed) return tooMany(taken.retryAfterSeconds);
      }
      try {
        await deps.sendCode(email, meta);
        return { ok: true, email };
      } catch (error) {
        const status = statusOf(error);
        // Logged even when it is the address: a refusal can also be the
        // environment's (Magic Auth switched off in the dashboard).
        warn(`sign-in: sending a code failed (${detailOf(error)})`);
        if (status === 429) return tooMany(60);
        if (status !== undefined && status >= 400 && status < 500)
          return refuse(400, "A code can't be sent to that address.");
        return refuse(503, UNAVAILABLE);
      }
    },

    /** Checks the code WorkOS emailed and, when it is right, signs the visitor in. */
    async checkCode({
      email: typed,
      code: typedCode,
      ...meta
    }: { email: string; code: string } & RequestMeta): Promise<
      { ok: true } | SignInRefusal
    > {
      const email = typed.trim();
      const code = typedCode.replace(/\s+/g, "");
      if (!EMAIL.test(email))
        return refuse(400, "Start again with your email.");
      if (!CODE.test(code))
        return refuse(400, "Enter the 6-digit code from the email.");
      const taken = deps.limits.checkPerEmail.take(email.toLowerCase());
      if (!taken.allowed) return tooMany(taken.retryAfterSeconds);
      let session: WorkOSSession;
      try {
        session = await deps.checkCode(email, code, meta);
      } catch (error) {
        // Logged even for a wrong code: WorkOS may refuse a right one too
        // (`sso_required` for a domain an organisation's SSO claims).
        warn(`sign-in: checking a code failed (${detailOf(error)})`);
        const status = statusOf(error);
        if (status === 429) return tooMany(60);
        if (status !== undefined && status >= 400 && status < 500)
          return refuse(
            400,
            "That code is wrong or has expired. Check it, or send a new one.",
          );
        return refuse(503, UNAVAILABLE);
      }
      await deps.startSession(session);
      return { ok: true };
    },
  };
}

export type EmailSignIn = ReturnType<typeof createEmailSignIn>;
