import { describe, expect, it, vi } from "vitest";
import { createWindowLimiter } from "~/lookup/rate-limit";
import { createEmailSignIn, type EmailSignInDeps } from "./email-sign-in";

const ada = { id: "user_01", email: "ada@example.com" };
const session = {
  accessToken: "at",
  refreshToken: "rt",
  user: ada,
  impersonator: undefined,
};
const meta = { ip: "203.0.113.7", userAgent: "test" };

/** A WorkOS SDK error: it carries the HTTP status and WorkOS's code. */
const workosError = (status: number, code = "x") =>
  Object.assign(new Error(`workos ${status}`), { status, code });

function setup(over: Partial<EmailSignInDeps> = {}) {
  const deps: EmailSignInDeps = {
    sendCode: vi.fn(async () => {}),
    checkCode: vi.fn(async () => session),
    startSession: vi.fn(async () => {}),
    limits: {
      sendPerEmail: createWindowLimiter({ limit: 5, windowMs: 3_600_000 }),
      sendPerIp: createWindowLimiter({ limit: 20, windowMs: 3_600_000 }),
      checkPerEmail: createWindowLimiter({ limit: 10, windowMs: 600_000 }),
    },
    warn: vi.fn(),
    ...over,
  };
  return { deps, signIn: createEmailSignIn(deps) };
}

describe("sendCode", () => {
  it("asks WorkOS to email a code to the address, trimmed", async () => {
    const { deps, signIn } = setup();
    const result = await signIn.sendCode({
      email: "  ada@example.com ",
      ...meta,
    });
    expect(result).toEqual({ ok: true, email: "ada@example.com" });
    expect(deps.sendCode).toHaveBeenCalledWith("ada@example.com", meta);
  });

  it.each(["", "ada", "ada@", "@example.com", "a b@example.com"])(
    "refuses %j without calling WorkOS",
    async (email) => {
      const { deps, signIn } = setup();
      const result = await signIn.sendCode({ email, ...meta });
      expect(result).toMatchObject({ ok: false, status: 400 });
      expect(deps.sendCode).not.toHaveBeenCalled();
    },
  );

  it("refuses an address longer than 254 characters", async () => {
    const { signIn } = setup();
    const email = `${"a".repeat(250)}@example.com`;
    expect(await signIn.sendCode({ email, ...meta })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("sends at most 5 codes an hour to one address, ignoring case", async () => {
    const { deps, signIn } = setup();
    for (let i = 0; i < 5; i++)
      await signIn.sendCode({ email: "ada@example.com", ...meta });
    const result = await signIn.sendCode({ email: "ADA@example.com", ...meta });
    expect(result).toMatchObject({ ok: false, status: 429 });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(deps.sendCode).toHaveBeenCalledTimes(5);
  });

  it("sends at most 20 codes an hour from one IP", async () => {
    const { signIn } = setup();
    for (let i = 0; i < 20; i++)
      await signIn.sendCode({ email: `u${i}@example.com`, ...meta });
    expect(
      await signIn.sendCode({ email: "u20@example.com", ...meta }),
    ).toMatchObject({ ok: false, status: 429 });
  });

  it("says the address was refused when WorkOS refuses it, and logs WorkOS's reason", async () => {
    const { deps, signIn } = setup({
      sendCode: vi.fn(async () => {
        // The SDK's OauthException names the reason in `error`.
        throw Object.assign(new Error("Magic Auth is disabled."), {
          status: 400,
          error: "authentication_method_not_allowed",
        });
      }),
    });
    expect(
      await signIn.sendCode({ email: "ada@example.com", ...meta }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(deps.warn).toHaveBeenCalledWith(
      "sign-in: sending a code failed (authentication_method_not_allowed: Magic Auth is disabled.)",
    );
  });

  it("is a 503 when WorkOS can't be reached, and logs why", async () => {
    const { deps, signIn } = setup({
      sendCode: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    expect(
      await signIn.sendCode({ email: "ada@example.com", ...meta }),
    ).toMatchObject({ ok: false, status: 503 });
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("fetch failed"),
    );
  });
});

describe("checkCode", () => {
  it("signs in with the code: WorkOS checks it, the session is started", async () => {
    const { deps, signIn } = setup();
    const result = await signIn.checkCode({
      email: "ada@example.com",
      code: " 123 456 ",
      ...meta,
    });
    expect(result).toEqual({ ok: true });
    expect(deps.checkCode).toHaveBeenCalledWith(
      "ada@example.com",
      "123456",
      meta,
    );
    expect(deps.startSession).toHaveBeenCalledWith(session);
  });

  it.each(["", "12345", "1234567", "abcdef"])(
    "refuses the code %j without calling WorkOS",
    async (code) => {
      const { deps, signIn } = setup();
      const result = await signIn.checkCode({
        email: "ada@example.com",
        code,
        ...meta,
      });
      expect(result).toMatchObject({ ok: false, status: 400 });
      expect(deps.checkCode).not.toHaveBeenCalled();
    },
  );

  it("says the code is wrong or expired when WorkOS refuses it, and starts no session", async () => {
    const { deps, signIn } = setup({
      checkCode: vi.fn(async () => {
        throw workosError(400, "invalid_one_time_code");
      }),
    });
    const result = await signIn.checkCode({
      email: "ada@example.com",
      code: "123456",
      ...meta,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toMatch(/wrong or has expired/);
    expect(deps.startSession).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("invalid_one_time_code"),
    );
  });

  it("allows 10 tries in 10 minutes for one address", async () => {
    const { deps, signIn } = setup({
      checkCode: vi.fn(async () => {
        throw workosError(400);
      }),
    });
    for (let i = 0; i < 10; i++)
      await signIn.checkCode({
        email: "ada@example.com",
        code: "000000",
        ...meta,
      });
    expect(
      await signIn.checkCode({
        email: "ada@example.com",
        code: "123456",
        ...meta,
      }),
    ).toMatchObject({ ok: false, status: 429 });
    expect(deps.checkCode).toHaveBeenCalledTimes(10);
  });

  it("is a 503 when WorkOS can't be reached", async () => {
    const { signIn } = setup({
      checkCode: vi.fn(async () => {
        throw workosError(500);
      }),
    });
    expect(
      await signIn.checkCode({
        email: "ada@example.com",
        code: "123456",
        ...meta,
      }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("passes on WorkOS's own rate limit as a 429", async () => {
    const { signIn } = setup({
      checkCode: vi.fn(async () => {
        throw workosError(429);
      }),
    });
    expect(
      await signIn.checkCode({
        email: "ada@example.com",
        code: "123456",
        ...meta,
      }),
    ).toMatchObject({ ok: false, status: 429 });
  });
});
