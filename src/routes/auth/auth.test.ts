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

const { Route: oauth, withProvider } = await import("./oauth.$provider");
const {
  Route: callback,
  logRefusal,
  onPublicOrigin,
} = await import("./callback");
const { Route: signOut } = await import("./sign-out");

const WORKOS = {
  WORKOS_API_KEY: "sk_test_x",
  WORKOS_CLIENT_ID: "client_x",
  WORKOS_COOKIE_PASSWORD: "p".repeat(32),
  WORKOS_REDIRECT_URI: "http://localhost:3000/auth/callback",
};

const ada = { id: "user_01", email: "ada@example.com" };

type Handler = (ctx: {
  request: Request;
  params?: Record<string, string>;
}) => Promise<Response> | Response;

function get(route: { options: { server?: unknown } }): Handler {
  const handlers = (route.options.server as { handlers?: { GET?: unknown } })
    ?.handlers;
  if (typeof handlers?.GET !== "function") throw new Error("no GET handler");
  return handlers.GET as Handler;
}

const call = (
  route: { options: { server?: unknown } },
  path: string,
  params: Record<string, string> = {},
) =>
  get(route)({ request: new Request(`http://localhost:3000${path}`), params });

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
    ["oauth/github", oauth, "/auth/oauth/github?returnTo=/keys"],
    ["callback", callback, "/auth/callback?code=c&state=s"],
    ["sign-out", signOut, "/auth/sign-out"],
  ])("/auth/%s is 404 and calls nothing", async (_, route, path) => {
    const response = await call(route, path, { provider: "github" });
    expect(response.status).toBe(404);
    expect(fake.getSignInUrl).not.toHaveBeenCalled();
    expect(fake.signOut).not.toHaveBeenCalled();
    expect(fake.callback).not.toHaveBeenCalled();
  });
});

describe("GET /auth/oauth/:provider", () => {
  const AUTHORIZE =
    "https://api.workos.com/user_management/authorize?client_id=client_x&provider=authkit&screen_hint=sign-in&state=s&code_challenge=c";

  it.each([
    ["github", "GitHubOAuth"],
    ["google", "GoogleOAuth"],
  ])(
    "goes straight to %s, skipping AuthKit's hosted page",
    async (provider, workos) => {
      stubWorkOS();
      fake.getSignInUrl.mockResolvedValue(AUTHORIZE);
      const response = await call(
        oauth,
        `/auth/oauth/${provider}?returnTo=%2Fkeys`,
        { provider },
      );
      expect(fake.getSignInUrl).toHaveBeenCalledWith({
        data: { returnPathname: "/keys" },
      });
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.searchParams.get("provider")).toBe(workos);
      expect(location.searchParams.get("screen_hint")).toBeNull();
      expect(location.searchParams.get("state")).toBe("s");
      expect(location.searchParams.get("code_challenge")).toBe("c");
    },
  );

  it.each(["apple", "toString", "__proto__"])(
    "is 404 for the provider %j",
    async (provider) => {
      stubWorkOS();
      const response = await call(oauth, `/auth/oauth/${provider}`, {
        provider,
      });
      expect(response.status).toBe(404);
      expect(fake.getSignInUrl).not.toHaveBeenCalled();
    },
  );

  it("comes back home, never to another origin", async () => {
    stubWorkOS();
    fake.getSignInUrl.mockResolvedValue(AUTHORIZE);
    await call(oauth, "/auth/oauth/github?returnTo=%2F%2Fevil.example", {
      provider: "github",
    });
    expect(fake.getSignInUrl).toHaveBeenCalledWith({
      data: { returnPathname: "/" },
    });
  });

  it("sends someone already signed in straight to returnTo", async () => {
    stubWorkOS();
    fake.context = { auth: () => ({ user: ada, sessionId: "session_01" }) };
    const response = await call(oauth, "/auth/oauth/github?returnTo=%2Fkeys", {
      provider: "github",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/keys");
    expect(fake.getSignInUrl).not.toHaveBeenCalled();
  });
});

describe("withProvider", () => {
  it("changes only the provider (and drops the hosted page's screen hint)", () => {
    expect(
      withProvider(
        "https://api.workos.com/user_management/authorize?provider=authkit&redirect_uri=https%3A%2F%2Fswaggerbot.dev%2Fauth%2Fcallback&screen_hint=sign-in",
        "github",
      ),
    ).toBe(
      "https://api.workos.com/user_management/authorize?provider=GitHubOAuth&redirect_uri=https%3A%2F%2Fswaggerbot.dev%2Fauth%2Fcallback",
    );
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

describe("logRefusal", () => {
  it("logs WorkOS's error when it comes back without a code", () => {
    const warn = vi.fn();
    logRefusal(
      new Request(
        "https://swaggerbot.dev/auth/callback?error=access_denied&error_description=Sign-ups+are+disabled&state=s",
      ),
      warn,
    );
    expect(warn.mock.calls).toEqual([
      [
        "sign-in: WorkOS returned no code (error=access_denied: Sign-ups are disabled)",
      ],
    ]);
  });

  it("says nothing when there is a code", () => {
    const warn = vi.fn();
    logRefusal(
      new Request("https://swaggerbot.dev/auth/callback?code=c&state=s"),
      warn,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
