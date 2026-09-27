import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuthKit's session reader: what its middleware read from the sealed cookie
// on this request. No test reaches WorkOS.
const reader = vi.hoisted(() => ({
  context: null as null | { auth: () => unknown },
  server: vi.fn(),
}));
vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuthKitContextOrNull: () => reader.context,
  authkitMiddleware: () => ({ options: { server: reader.server } }),
}));

const { auth, currentUser, returnPath, signInConfigured } = await import(
  "./auth"
);

const WORKOS = {
  WORKOS_API_KEY: "sk_test_x",
  WORKOS_CLIENT_ID: "client_x",
  WORKOS_COOKIE_PASSWORD: "p".repeat(32),
  WORKOS_REDIRECT_URI: "http://localhost:3000/auth/callback",
};

const ada = {
  id: "user_01",
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
};

/** The session the middleware read: a user and their session, or none. */
function session(result: unknown) {
  reader.context = { auth: () => result };
}

function stubWorkOS(env: Record<string, string> = WORKOS) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

beforeEach(() => {
  reader.context = null;
  reader.server.mockReset();
  for (const name of Object.keys(WORKOS)) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("signInConfigured", () => {
  it("is on with every WorkOS variable set", () => {
    expect(signInConfigured(WORKOS)).toBe(true);
  });

  it("is off when any is missing", () => {
    for (const name of Object.keys(WORKOS)) {
      expect(signInConfigured({ ...WORKOS, [name]: "" })).toBe(false);
    }
  });

  it("is off, with a warning, when the cookie password is under 32 characters", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      signInConfigured({ ...WORKOS, WORKOS_COOKIE_PASSWORD: "p".repeat(31) }),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sign-in: off"));
    warn.mockRestore();
  });
});

describe("currentUser", () => {
  it("is the signed-in person for a valid sealed session", () => {
    stubWorkOS();
    session({ user: ada, sessionId: "session_01", accessToken: "at" });
    expect(currentUser()).toEqual({
      id: "user_01",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
  });

  it("leaves out the name when WorkOS has none", () => {
    stubWorkOS();
    session({
      user: { ...ada, firstName: null, lastName: null },
      sessionId: "session_01",
    });
    expect(currentUser()).toEqual({ id: "user_01", email: "ada@example.com" });
  });

  it("is null for an expired session AuthKit could not refresh", () => {
    // AuthKit's reader answers an expired, unrefreshable session as no user.
    stubWorkOS();
    session({ user: null });
    expect(currentUser()).toBeNull();
  });

  it("is null with no session", () => {
    stubWorkOS();
    session({ user: null });
    expect(currentUser()).toBeNull();
    reader.context = null;
    expect(currentUser()).toBeNull();
  });

  it("is null without the WorkOS env, whatever the request carries", () => {
    session({ user: ada, sessionId: "session_01" });
    expect(currentUser()).toBeNull();
  });
});

describe("the auth middleware", () => {
  const server = auth.options.server;
  if (!server) throw new Error("no server middleware");
  const args = () => ({ next: vi.fn(async () => "next") }) as never;

  it("passes the request on, never reading a session, without the WorkOS env", async () => {
    const a = args();
    await server(a);
    expect((a as { next: () => void }).next).toHaveBeenCalledOnce();
    expect(reader.server).not.toHaveBeenCalled();
  });

  it("is AuthKit's middleware with it", async () => {
    stubWorkOS();
    const a = args();
    await server(a);
    expect(reader.server).toHaveBeenCalledWith(a);
  });
});

describe("returnPath", () => {
  it("keeps a path on this site", () => {
    expect(returnPath("/keys")).toBe("/keys");
    expect(returnPath("/docs?x=1#keys")).toBe("/docs?x=1#keys");
  });

  it("is / for anything else", () => {
    for (const value of [
      null,
      undefined,
      "",
      "keys",
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example/",
    ]) {
      expect(returnPath(value)).toBe("/");
    }
  });
});
