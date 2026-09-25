import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type FixtureServer,
  startFixtureServer,
} from "~/fetch/__fixtures__/server";
import {
  checkRun,
  judgeTabWalk,
  parseUicheckArgs,
  routeSlug,
  runFailures,
  type TabStep,
  tabWalkEnded,
  uicheckLines,
  VIEWPORTS,
} from "./uicheck";

describe("parseUicheckArgs", () => {
  it("reads the defaults", () => {
    expect(parseUicheckArgs(["http://localhost:3000/"])).toEqual({
      ok: true,
      help: false,
      options: {
        baseUrl: "http://localhost:3000",
        routes: ["/"],
        json: false,
        out: "uicheck-out",
        viewports: VIEWPORTS,
      },
    });
  });

  it("reads --routes, --json and --out", () => {
    const parsed = parseUicheckArgs([
      "https://swaggerbot.dev",
      "--routes",
      "/, /docs,/vendors?query=str",
      "--json",
      "--out",
      "shots",
    ]);
    if (!parsed.ok || parsed.help) throw new Error("didn't parse");
    expect(parsed.options.routes).toEqual(["/", "/docs", "/vendors?query=str"]);
    expect(parsed.options.json).toBe(true);
    expect(parsed.options.out).toBe("shots");
  });

  it("answers --help", () => {
    expect(parseUicheckArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it.each([
    [[], "missing <baseUrl>"],
    [["ftp://x"], "<baseUrl> must be an http(s) URL"],
    [["http://x", "extra"], "unexpected argument: extra"],
    [["http://x", "--routes", ","], "--routes must name at least one route"],
    [["http://x", "--routes", "docs"], 'each route must start with "/"'],
    [["http://x", "--nope"], "Unknown option"],
  ])("rejects %j", (args, error) => {
    const parsed = parseUicheckArgs(args);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain(error);
      expect(parsed.exitCode).toBe(2);
    }
  });
});

describe("routeSlug", () => {
  it.each([
    ["/", "root"],
    ["/docs", "docs"],
    ["/vendors?query=str", "vendors_query_str"],
    ["/vendors/stripe.com", "vendors_stripe.com"],
  ])("%s → %s", (route, slug) => {
    expect(routeSlug(route)).toBe(slug);
  });
});

/** A step focused on element `key`, with a ring unless `ring` is false. */
function step(key: number | null, frame = false, ring = true): TabStep {
  return {
    key,
    described: key === null ? "the document" : `button "${key}"`,
    frame,
    focusedStyle: ring ? "outline: solid 2px" : "outline: none",
  };
}

const three = new Map([
  [0, 'button "0"'],
  [1, 'button "1"'],
  [2, 'button "2"'],
]);
const unfocused = new Map([
  [0, "outline: none"],
  [1, "outline: none"],
  [2, "outline: none"],
]);

describe("judgeTabWalk", () => {
  it("passes a walk that reaches everything and leaves for the document", () => {
    const steps = [step(0), step(1), step(2), step(null)];
    expect(tabWalkEnded(steps)).toBe(true);
    expect(judgeTabWalk(steps, three, unfocused)).toEqual({
      expected: 3,
      reached: 3,
      unreached: [],
      trapped: undefined,
      noFocusIndicator: [],
    });
  });

  it("passes a walk that comes back to the start", () => {
    const steps = [step(0), step(1), step(2), step(0)];
    expect(tabWalkEnded(steps)).toBe(true);
    expect(judgeTabWalk(steps, three, unfocused).trapped).toBeUndefined();
  });

  it("finds a loop that never returns to the start", () => {
    const steps = [step(0), step(1), step(2), step(1)];
    expect(tabWalkEnded(steps)).toBe(true);
    const result = judgeTabWalk(steps, three, unfocused);
    expect(result.trapped).toBe(
      'focus loops back to button "1" and never returns to the start',
    );
  });

  it("finds focus that stays put", () => {
    const steps = [step(0), step(0)];
    expect(tabWalkEnded(steps)).toBe(true);
    const result = judgeTabWalk(steps, three, unfocused);
    expect(result.trapped).toBe('focus stays on button "0"');
    expect(result.unreached).toEqual(['button "1"', 'button "2"']);
    expect(result.reached).toBe(1);
  });

  it("lets focus move inside a frame", () => {
    const steps = [step(0), step(1, true), step(1, true), step(2), step(null)];
    expect(tabWalkEnded(steps.slice(0, 3))).toBe(false);
    expect(judgeTabWalk(steps, three, unfocused).trapped).toBeUndefined();
  });

  it("calls a walk that never ends trapped", () => {
    const steps = [step(0), step(1, true), step(1, true)];
    expect(tabWalkEnded(steps)).toBe(false);
    expect(judgeTabWalk(steps, three, unfocused, 3).trapped).toBe(
      "focus didn't return to the start within 3 Tab presses",
    );
  });

  it("finds a focused element whose outline and box-shadow didn't change", () => {
    const steps = [step(0), step(1, false, false), step(2), step(null)];
    expect(judgeTabWalk(steps, three, unfocused).noFocusIndicator).toEqual([
      'button "1"',
    ]);
  });

  it("passes a page with nothing to focus", () => {
    const result = judgeTabWalk([step(null)], new Map(), new Map());
    expect(result.trapped).toBeUndefined();
  });

  it("says when nothing takes focus on a page that has controls", () => {
    const result = judgeTabWalk([step(null)], three, unfocused);
    expect(result.trapped).toBe("no element takes focus");
  });
});

describe("runFailures and uicheckLines", () => {
  const clean = {
    route: "/",
    width: 390,
    scheme: "light" as const,
    status: 200,
    violations: [],
    keyboard: {
      expected: 1,
      reached: 1,
      unreached: [],
      noFocusIndicator: [],
    },
    cspViolations: [],
  };

  it("passes a clean run and fails a page that didn't load", () => {
    expect(runFailures(clean)).toEqual([]);
    expect(runFailures({ ...clean, status: 404 })).toEqual([
      "the page answered HTTP 404",
    ]);
  });

  it("prints a line per run and the verdict", () => {
    const failing = { ...clean, status: 500 };
    const lines = uicheckLines({
      baseUrl: "http://localhost:3000",
      pass: false,
      runs: [
        { ...clean, screenshot: "out/root-390-light.png", failures: [] },
        {
          ...failing,
          scheme: "dark",
          screenshot: "out/root-390-dark.png",
          failures: runFailures(failing),
        },
      ],
    });
    expect(lines).toEqual([
      "UI check: http://localhost:3000",
      "",
      "PASS / 390 light  axe 0 · keyboard 1/1 · CSP 0 · out/root-390-light.png",
      "FAIL / 390 dark   axe 0 · keyboard 1/1 · CSP 0 · out/root-390-dark.png",
      "  the page answered HTTP 500",
      "",
      "FAIL (1 of 2 runs)",
    ]);
  });
});

// These tests drive a real Chromium. Without one (a fresh machine before
// `pnpm exec playwright install chromium`), they are skipped, except in CI,
// where the browser is installed and a missing one is a failure.
const probe = await chromium.launch().catch(() => undefined);
await probe?.close();

describe.skipIf(!probe && !process.env.CI)("checkRun on fixture pages", () => {
  const FIXTURES = join(import.meta.dirname, "__fixtures__", "uicheck");
  let server: FixtureServer;
  let browser: Browser;
  let out: string;

  beforeAll(async () => {
    server = await startFixtureServer();
    for (const name of [
      "ok",
      "missing-label",
      "focus-trap",
      "no-focus-ring",
      "csp",
    ]) {
      const body = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const headers: Record<string, string> = {
        "content-type": "text/html; charset=utf-8",
      };
      if (name === "csp")
        headers["content-security-policy"] = "script-src 'self'";
      server.route("127.0.0.1", `/${name}`, (_req, res) => {
        res.writeHead(200, headers).end(body);
      });
    }
    browser = await chromium.launch();
    out = mkdtempSync(join(tmpdir(), "uicheck-"));
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (out) rmSync(out, { recursive: true, force: true });
  });

  const check = (route: string) =>
    checkRun(browser, { baseUrl: server.origin("127.0.0.1"), out }, route, {
      width: 390,
      height: 844,
      scheme: "light",
    });

  it("passes a page with labels, focus rings and no trap", async () => {
    const run = await check("/ok");
    expect(run.failures).toEqual([]);
    expect(run.keyboard).toMatchObject({ expected: 3, reached: 3 });
    expect(run.screenshot).toBe(join(out, "ok-390-light.png"));
    expect(readFileSync(run.screenshot).subarray(1, 4).toString()).toBe("PNG");
  }, 30_000);

  it("fails a field with no label", async () => {
    const run = await check("/missing-label");
    expect(run.violations.map((v) => v.id)).toContain("label");
    expect(run.failures.some((f) => f.startsWith("axe label"))).toBe(true);
  }, 30_000);

  it("fails a focus trap and the link it keeps focus from", async () => {
    const run = await check("/focus-trap");
    expect(run.keyboard.trapped).toBe(
      'focus loops back to button "First" and never returns to the start',
    );
    expect(run.keyboard.unreached).toEqual(['a "After the trap"']);
    expect(run.failures).toEqual([
      'keyboard: focus loops back to button "First" and never returns to the start',
      'keyboard: never reached a "After the trap"',
    ]);
  }, 30_000);

  it("fails a button with no focus ring", async () => {
    const run = await check("/no-focus-ring");
    expect(run.keyboard.noFocusIndicator).toEqual(['button "Go"']);
  }, 30_000);

  it("fails a CSP violation in the console", async () => {
    const run = await check("/csp");
    expect(run.cspViolations).toHaveLength(1);
    expect(run.failures[0]).toMatch(/^CSP: .*Content Security Policy/);
  }, 30_000);

  it("fails a page that doesn't load", async () => {
    const run = await check("/nowhere");
    expect(run.failures).toContain("the page answered HTTP 404");
  }, 30_000);
});
