import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuthKit, faked: the session its middleware read, and the calls that would
// reach WorkOS. No test reaches WorkOS.
const fake = vi.hoisted(() => ({
  context: null as null | { auth: () => unknown },
  getSignInUrl: vi.fn(),
  signOut: vi.fn(),
  clearSession: vi.fn(),
  callback: vi.fn(),
}));
vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuthKitContextOrNull: () => fake.context,
  authkitMiddleware: () => ({ options: { server: vi.fn() } }),
  getSignInUrl: fake.getSignInUrl,
  getAuthkit: async () => ({
    signOut: fake.signOut,
    clearSession: fake.clearSession,
  }),
  handleCallbackRoute: () => fake.callback,
}));

const { Route: signIn } = await import("./sign-in");
const { Route: callback, onPublicOrigin } = await import("./callback");
const { Route: signOut } = await import("./sign-out");

const WORKOS = {
  WORKOS_API_KEY: "sk_test_x",
  WORKOS_CLIENT_ID: "client_x",
  WORKOS_COOKIE_PASSWORD: "p".repeat(32),
  WORKOS_REDIRECT_URI: "http://localhost:3000/auth/callback",
};

const ada = { id: "user_01", email: "ada@example.com" };

type Handler = (ctx: { request: Request }) => Promise<Response> | Response;

function get(route: { options: { server?: unknown } }): Handler {
  const handlers = (route.options.server as { handlers?: { GET?: unknown } })
    ?.handlers;
  if (typeof handlers?.GET !== "function") throw new Error("no GET handler");
  return handlers.GET as Handler;
}

const call = (route: { options: { server?: unknown } }, path: string) =>
  get(route)({ request: new Request(`http://localhost:3000${path}`) });

beforeEach(() => {
  fake.context = { auth: () => ({ user: null }) };
  for (const f of [fake.getSignInUrl, fake.signOut, fake.clearSession]) {
    f.mockReset();
  }
  fake.callback.mockReset();
  for (const name of Object.keys(WORKOS)) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

function stubWorkOS() {
  for (const [name, value] of Object.entries(WORKOS)) vi.stubEnv(name, value);
}

describe("/auth/* without the WorkOS env", () => {
  it.each([
    ["sign-in", signIn, "/auth/sign-in?returnTo=/keys"],
    ["callback", callback, "/auth/callback?code=c&state=s"],
    ["sign-out", signOut, "/auth/sign-out"],
  ])("/auth/%s is 404 and calls nothing", async (_, route, path) => {
    const response = await call(route, path);
    expect(response.status).toBe(404);
    expect(fake.getSignInUrl).not.toHaveBeenCalled();
    expect(fake.signOut).not.toHaveBeenCalled();
    expect(fake.callback).not.toHaveBeenCalled();
  });
});

describe("GET /auth/sign-in", () => {
  it("goes to AuthKit's sign-in, to come back to returnTo", async () => {
    stubWorkOS();
    fake.getSignInUrl.mockResolvedValue("https://auth.example/authorize?x");
    const response = await call(signIn, "/auth/sign-in?returnTo=%2Fkeys");
    expect(fake.getSignInUrl).toHaveBeenCalledWith({
      data: { returnPathname: "/keys" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://auth.example/authorize?x",
    );
  });

  it("comes back home, never to another origin", async () => {
    stubWorkOS();
    fake.getSignInUrl.mockResolvedValue("https://auth.example/authorize");
    await call(signIn, "/auth/sign-in?returnTo=%2F%2Fevil.example");
    expect(fake.getSignInUrl).toHaveBeenCalledWith({
      data: { returnPathname: "/" },
    });
  });

  it("sends someone already signed in straight to returnTo", async () => {
    stubWorkOS();
    fake.context = { auth: () => ({ user: ada, sessionId: "session_01" }) };
    const response = await call(signIn, "/auth/sign-in?returnTo=%2Fkeys");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/keys");
    expect(fake.getSignInUrl).not.toHaveBeenCalled();
  });
});

describe("GET /auth/callback", () => {
  it("is AuthKit's callback", async () => {
    stubWorkOS();
    fake.callback.mockResolvedValue(new Response(null, { status: 307 }));
    const response = await call(callback, "/auth/callback?code=c&state=s");
    expect(response.status).toBe(307);
    expect(fake.callback).toHaveBeenCalledOnce();
  });

  it("hands AuthKit the request on the public origin, so its redirects stay on https", async () => {
    stubWorkOS();
    vi.stubEnv("WORKOS_REDIRECT_URI", "https://swaggerbot.dev/auth/callback");
    fake.callback.mockResolvedValue(new Response(null, { status: 307 }));
    await get(callback)({
      request: new Request(
        "http://swaggerbot.dev/auth/callback?code=c&state=s",
        {
          headers: { cookie: "wos-auth-verifier=v" },
        },
      ),
    });
    const [[{ request: seen }]] = fake.callback.mock.calls as [
      [{ request: Request }],
    ];
    expect(seen.url).toBe(
      "https://swaggerbot.dev/auth/callback?code=c&state=s",
    );
    expect(seen.headers.get("cookie")).toBe("wos-auth-verifier=v");
  });
});

describe("onPublicOrigin", () => {
  it("keeps the request as it is without a redirect URI", () => {
    const request = new Request("http://localhost:3000/auth/callback?code=c");
    expect(onPublicOrigin(request, undefined)).toBe(request);
  });

  it("moves only the scheme and host", () => {
    const moved = onPublicOrigin(
      new Request("http://10.0.0.5:3000/auth/callback?code=c"),
      "https://swaggerbot.dev/auth/callback",
    );
    expect(moved.url).toBe("https://swaggerbot.dev/auth/callback?code=c");
  });
});

describe("GET /auth/sign-out", () => {
  it("ends the session at WorkOS and goes to its logout URL", async () => {
    stubWorkOS();
    fake.context = { auth: () => ({ user: ada, sessionId: "session_01" }) };
    fake.signOut.mockResolvedValue({
      logoutUrl: "https://api.workos.com/user_management/sessions/logout",
    });
    const response = await call(signOut, "/auth/sign-out");
    expect(fake.signOut).toHaveBeenCalledWith("session_01");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://api.workos.com/user_management/sessions/logout",
    );
  });

  it("clears any cookie and goes home when no one is signed in", async () => {
    stubWorkOS();
    const response = await call(signOut, "/auth/sign-out");
    expect(fake.clearSession).toHaveBeenCalledOnce();
    expect(fake.signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/");
  });
});
