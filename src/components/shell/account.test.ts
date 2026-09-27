import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ShellAccount } from "~/server/account";
import { AccountLinks, AccountMenu, initialOf } from "./account";

const menu = (account: ShellAccount) =>
  renderToStaticMarkup(
    createElement(AccountMenu, { account, returnTo: "/docs?x=1" }),
  );
const links = (account: ShellAccount) =>
  renderToStaticMarkup(
    createElement(AccountLinks, { account, returnTo: "/docs?x=1" }),
  );

const signedIn: ShellAccount = {
  signIn: "signed-in",
  name: "ada Lovelace",
  email: "ada@example.com",
};

describe("the top bar's sign-in", () => {
  it("is nothing without the WorkOS env", () => {
    expect(menu({ signIn: "off" })).toBe("");
    expect(links({ signIn: "off" })).toBe("");
  });

  it('is "Sign in" signed out, coming back to this page', () => {
    for (const html of [
      menu({ signIn: "signed-out" }),
      links({ signIn: "signed-out" }),
    ]) {
      expect(html).toContain(">Sign in</a>");
      expect(html).toContain('href="/auth/sign-in?returnTo=%2Fdocs%3Fx%3D1"');
      expect(html).not.toContain("Sign out");
    }
  });

  it("is the initial and a menu (Your key, Sign out) signed in", () => {
    const html = menu(signedIn);
    expect(html).toMatch(/<summary[^>]*><span aria-hidden="true">A<\/span>/);
    expect(html).toContain("Your account");
    expect(html).toContain("ada@example.com");
    expect(html).toContain('href="/keys"');
    expect(html).toContain(">Your key</a>");
    expect(html).toContain('href="/auth/sign-out"');
    expect(html).toContain(">Sign out</a>");
    expect(html).not.toContain("Sign in<");

    const drawer = links(signedIn);
    expect(drawer).toContain(">Your key</a>");
    expect(drawer).toContain(">Sign out</a>");
  });

  it("takes the initial from the name, or the email", () => {
    expect(initialOf("ada Lovelace")).toBe("A");
    expect(initialOf("  zed@example.com")).toBe("Z");
    expect(initialOf("")).toBe("?");
  });
});
