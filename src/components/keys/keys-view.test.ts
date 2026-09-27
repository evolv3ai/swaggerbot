import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KeysPage, KeyView } from "~/server/keys-page";
import {
  creditWords,
  type KeyActions,
  KeysView,
  NewSecret,
  resetWords,
  usageOf,
} from "./keys-view";

const never = () => new Promise<never>(() => {});
const actions: KeyActions = { create: never, roll: never, revoke: never };
const view = (page: KeysPage) =>
  renderToStaticMarkup(createElement(KeysView, { page, actions }));

const BASE = "https://swaggerbot.dev";
const KEY: KeyView = {
  id: "key_abcdefgh",
  start: "sb_abcd",
  createdAt: "2026-09-20T10:00:00.000Z",
  remaining: 97,
  limit: 100,
  resetsAt: "2026-09-28T00:00:00.000Z",
  asOf: "2026-09-27T19:00:00.000Z",
};

describe("KeysView", () => {
  it("signed out: what a key unlocks, the quota, and sign-in back to /keys", () => {
    const html = view({ state: "signed-out", status: 200, quota: 100 });
    expect(html).toContain(">Get an API key</h1>");
    expect(html).toContain("Discovery");
    expect(html).toContain("fresh: true");
    expect(html).toContain("100 a day");
    expect(html).toContain("needs no key");
    expect(html).toMatch(
      /href="\/auth\/sign-in\?returnTo=%2Fkeys"[^>]*>Sign in to get a key</,
    );
    expect(html).not.toContain("Create your key");
  });

  it("signed in without a key: Create your key", () => {
    const html = view({
      state: "no-key",
      status: 200,
      quota: 100,
      baseUrl: BASE,
    });
    expect(html).toMatch(/<button[^>]*>Create your key<\/button>/);
    expect(html).toContain("shown once");
    expect(html).not.toContain("Sign in to get a key");
    expect(html).not.toContain("sb_");
  });

  it("with a key: its start, created day, today's credits and the reset, Roll and Revoke", () => {
    const html = view({
      state: "key",
      status: 200,
      key: KEY,
      quota: 100,
      baseUrl: BASE,
    });
    expect(html).toContain(">Your API key</h1>");
    expect(html).toContain("sb_abcd…");
    expect(html).toMatch(/20 Sept? 2026/);
    expect(html).toContain("97 of 100 left today");
    expect(html).toContain("Resets at midnight UTC, in 5 h");
    expect(html).toMatch(/<button[^>]*>Roll…<\/button>/);
    expect(html).toMatch(/<button[^>]*>Revoke…<\/button>/);
    expect(html).not.toContain("Create your key");
    // The key's id isn't shown; the page never takes one back.
    expect(html).not.toContain("key_abcdefgh");
  });

  it("without Unkey or WorkOS: issued by hand, with the email", () => {
    const html = view({ state: "by-hand", status: 200, quota: 100 });
    expect(html).toContain("issued by hand");
    expect(html).toContain("100 a day");
    expect(html).toContain('href="mailto:hello@evolv3.ai?subject=');
    expect(html).not.toContain("Sign in");
  });

  it("says when keys can't be reached", () => {
    expect(view({ state: "unavailable", status: 503 })).toContain(
      "can&#x27;t be reached right now",
    );
  });
});

describe("NewSecret", () => {
  const secret = "sb_s3cr3tValue";
  const html = (rolled: boolean) =>
    renderToStaticMarkup(
      createElement(NewSecret, {
        secret,
        rolled,
        baseUrl: BASE,
        onDone: () => {},
      }),
      // A URL in a code block may break after a slash.
    ).replaceAll("<wbr/>", "");

  it("shows the secret once, to copy, with the warning and the lines to use it", () => {
    const shown = html(false);
    expect(shown).toContain(">Your new key</h2>");
    expect(shown).toContain("Store it now: it won&#x27;t be shown again.");
    expect(shown).toContain(`<code>${secret}</code>`);
    expect(shown).toContain(">Copy<");
    expect(shown).toContain(`Authorization: Bearer ${secret}`);
    expect(shown).toContain(
      `mcp add --transport http swaggerbot ${BASE}/mcp --header &quot;Authorization: Bearer ${secret}&quot;`,
    );
  });

  it("says a rolled key kept its credits", () => {
    const shown = html(true);
    expect(shown).toContain(">Your rolled key</h2>");
    expect(shown).toContain("credits carried over");
  });
});

describe("the words", () => {
  it("says when the credits reset", () => {
    expect(resetWords(KEY.resetsAt ?? "", KEY.asOf)).toBe(
      "resets at midnight UTC, in 5 h",
    );
    expect(
      resetWords("2026-09-28T00:00:00.000Z", "2026-09-27T23:20:30.000Z"),
    ).toBe("resets at midnight UTC, in 40 min");
  });

  it("says today's credits, with the limit when it is known", () => {
    expect(creditWords({ remaining: 3, limit: 100 })).toBe(
      "3 of 100 left today",
    );
    expect(creditWords({ remaining: 3 })).toBe("3 left today");
    expect(creditWords({})).toBeUndefined();
  });

  it("fills the key into the curl and MCP lines", () => {
    const { curl, mcp } = usageOf("sb_k", "http://localhost:3000");
    expect(curl).toMatch(
      /^curl -X POST http:\/\/localhost:3000\/api\/lookup -H "Authorization: Bearer sb_k"/,
    );
    expect(mcp).toBe(
      'claude mcp add --transport http swaggerbot http://localhost:3000/mcp --header "Authorization: Bearer sb_k"',
    );
  });
});
