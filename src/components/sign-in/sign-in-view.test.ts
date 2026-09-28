import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { providerHref, type SignInActions, SignInView } from "./sign-in-view";

const never = () => new Promise<never>(() => {});
const actions: SignInActions = { send: never, check: never };
const view = (returnTo: string) =>
  renderToStaticMarkup(createElement(SignInView, { returnTo, actions }));

describe("SignInView", () => {
  it("offers GitHub, Google and an emailed code, each back to returnTo", () => {
    const html = view("/keys");
    expect(html).toContain(">Sign in</h1>");
    expect(html).toMatch(
      /href="\/auth\/oauth\/github\?returnTo=%2Fkeys"[^>]*>.*Continue with GitHub</,
    );
    expect(html).toMatch(
      /href="\/auth\/oauth\/google\?returnTo=%2Fkeys"[^>]*>.*Continue with Google</,
    );
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autoComplete="email"/i);
    expect(html).toContain("Email me a code");
  });

  it("says a new visitor signs up the same way, and what signing in is for", () => {
    const html = view("/keys");
    expect(html).toContain("The same steps make your account.");
    expect(html).toContain("Everything else on SwaggerBot works without it.");
  });
});

describe("providerHref", () => {
  it("carries returnTo, encoded", () => {
    expect(providerHref("google", "/docs?x=1")).toBe(
      "/auth/oauth/google?returnTo=%2Fdocs%3Fx%3D1",
    );
  });
});
