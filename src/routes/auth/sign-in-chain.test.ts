import {
  type AuthKitConfig,
  AuthOperations,
  sessionEncryption,
} from "@workos/authkit-session";
import { WorkOS } from "@workos-inc/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sign-in a link-following client walks, against AuthKit's real PKCE
// verifier: `getSignInUrl` is faked only where the TanStack glue sits, and
// seals the verifier with `@workos/authkit-session` as production does. That
// is local crypto; no test reaches WorkOS.
const fake = vi.hoisted(() => ({ getSignInUrl: vi.fn() }));
vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuthKitContextOrNull: () => ({ auth: () => ({ user: null }) }),
  authkitMiddleware: () => ({ options: { server: vi.fn() } }),
  getSignInUrl: fake.getSignInUrl,
}));

const { Route: oauth } = await import("./oauth.$provider");
const { returnPath } = await import("~/server/auth");
const { signInHref } = await import("~/components/shell/account");
const { providerHref } = await import("~/components/sign-in/sign-in-view");

const WORKOS = {
  WORKOS_API_KEY: "sk_test_x",
  WORKOS_CLIENT_ID: "client_01M3JB1GCFVE5V835GX15WDRZH",
  WORKOS_COOKIE_PASSWORD: "p".repeat(32),
  WORKOS_REDIRECT_URI: "https://swaggerbot.dev/auth/callback",
};

const operations = new AuthOperations(
  undefined as never,
  new WorkOS(WORKOS.WORKOS_API_KEY, { clientId: WORKOS.WORKOS_CLIENT_ID }),
  {
    clientId: WORKOS.WORKOS_CLIENT_ID,
    apiKey: WORKOS.WORKOS_API_KEY,
    redirectUri: WORKOS.WORKOS_REDIRECT_URI,
    cookiePassword: WORKOS.WORKOS_COOKIE_PASSWORD,
    apiHttps: true,
  } as AuthKitConfig,
  sessionEncryption,
);

beforeEach(() => {
  for (const [name, value] of Object.entries(WORKOS)) vi.stubEnv(name, value);
  fake.getSignInUrl.mockReset();
  // As AuthKit's middleware calls it: the redirect URI from its context.
  fake.getSignInUrl.mockImplementation(
    async ({ data }: { data: { returnPathname: string } }) =>
      (
        await operations.createSignIn({
          returnPathname: data.returnPathname,
          redirectUri: WORKOS.WORKOS_REDIRECT_URI,
        })
      ).url,
  );
});
afterEach(() => vi.unstubAllEnvs());

const ORIGIN = "https://swaggerbot.dev";

type Handler = (ctx: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;
const handler = (oauth.options.server as { handlers: { GET: Handler } })
  .handlers.GET;
const follow = (path: string) =>
  handler({
    request: new Request(`${ORIGIN}${path}`),
    params: { provider: path.split("/")[3]?.split("?")[0] ?? "" },
  });

/**
 * What a client following links from `start` reaches: the top bar's "Sign
 * in" `hops` times, each time from the sign-in page it just landed on (the
 * shell comes back to `pathname + search`), then that page's GitHub button,
 * with the `returnTo` the page's loader read.
 */
function walk(start: string, hops: number): string {
  let page = start;
  for (let hop = 0; hop < hops; hop++) page = signInHref(page);
  const returnTo = returnPath(
    new URL(page, ORIGIN).searchParams.get("returnTo"),
  );
  return providerHref("github", returnTo);
}

/**
 * The same walk on the site as it was, which links already out there were
 * made from: "Sign in" wrapped the sign-in page in itself, and the page kept
 * a `returnTo` of any length.
 */
function oldWalk(start: string, hops: number): string {
  let page = start;
  for (let hop = 0; hop < hops; hop++)
    page = `/auth/sign-in?returnTo=${encodeURIComponent(page)}`;
  const url = new URL(
    new URL(page, ORIGIN).searchParams.get("returnTo") ?? "/",
    ORIGIN,
  );
  return providerHref("github", `${url.pathname}${url.search}`);
}

async function expectOnToWorkOS(path: string) {
  const response = await follow(path);
  expect(response.status).toBe(302);
  expect(new URL(response.headers.get("location") ?? "").host).toBe(
    "api.workos.com",
  );
}

describe("a sign-in reached by following links", () => {
  it('goes on to WorkOS after "Sign in" from the sign-in page 40 times', async () => {
    for (let hops = 1; hops <= 40; hops++) {
      const path = walk("/docs", hops);
      await expectOnToWorkOS(path);
      expect(path.length).toBeLessThan(100);
    }
  });

  // Links the nesting "Sign in" already put out. Production answered the one
  // nested 24 deep with a 500, `PKCEPayloadTooLargeError` (a 4,057-byte
  // verifier); its log shows link-followers walking on to 5,657 bytes.
  it.each([24, 26, 31])(
    "goes on to WorkOS from an old link nested %i deep",
    async (hops) => {
      const path = oldWalk("/docs", hops);
      expect(path.length).toBeGreaterThan(2_500);
      await expectOnToWorkOS(path);
    },
  );

  it("fits AuthKit's verifier cookie with the longest returnTo it keeps", async () => {
    // A backslash stays raw in a query and doubles when the state is sealed.
    const query = `/docs?q=${"\\".repeat(2_000)}`;
    const kept = returnPath(`/docs?q=${"\\".repeat(1_016)}`);
    expect(kept.length).toBe(1_024);
    for (const value of [kept, query, `/${"a".repeat(5_000)}`]) {
      await expectOnToWorkOS(
        `/auth/oauth/github?returnTo=${encodeURIComponent(value)}`,
      );
    }
  });
});
