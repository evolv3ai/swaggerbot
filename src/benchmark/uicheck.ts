import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, chromium, type Page } from "playwright";

/** The routes checked when `--routes` isn't given. */
export const DEFAULT_ROUTES = ["/"];
/** Where screenshots go when `--out` isn't given (git-ignored). */
export const DEFAULT_OUT = "uicheck-out";
/** axe-core's rule tags for WCAG 2.2 AA (backlog D8). */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

export type ColorScheme = "light" | "dark";
export type Viewport = { width: number; height: number; scheme: ColorScheme };

/** Every route is checked at a phone and a desktop width, light and dark. */
export const VIEWPORTS: Viewport[] = [
  { width: 390, height: 844, scheme: "light" },
  { width: 390, height: 844, scheme: "dark" },
  { width: 1280, height: 800, scheme: "light" },
  { width: 1280, height: 800, scheme: "dark" },
];

/** Tab presses allowed before a walk that never comes back counts as trapped. */
export const MAX_TABS = 1_000;

export const UICHECK_USAGE = `usage: pnpm tsx scripts/uicheck.ts <baseUrl> [--routes ${DEFAULT_ROUTES.join(",")}] [--json] [--out ${DEFAULT_OUT}]

Checks each route of the Web UI in Chromium (Playwright) at ${[...new Set(VIEWPORTS.map((v) => v.width))].join(" and ")} wide, in
light and in dark:
- axe-core with the tags ${AXE_TAGS.join(" ")}: any violation fails;
- the keyboard: Tab from the top of the page until focus comes back to
  where it started. Fails when an interactive element is never reached,
  when focus is trapped, or when a focused element has no visible focus
  indicator (its outline and box-shadow are the same as unfocused);
- the console: any Content Security Policy violation fails, as does a
  page that doesn't load (HTTP 400 or more).

Saves a full-page screenshot of each run under --out.

  --routes /,/docs  the routes to check, relative to <baseUrl> (default ${DEFAULT_ROUTES.join(",")})
  --json            print the whole report as JSON
  --out dir         where the screenshots go (default ${DEFAULT_OUT}/)

Chromium must be installed: pnpm exec playwright install chromium.
Exits 1 when a check fails, 2 on bad arguments.`;

/** The options of `scripts/uicheck.ts`, once validated. */
export type UicheckOptions = {
  /** The server, without a trailing slash. */
  baseUrl: string;
  /** Paths (with any query) relative to `baseUrl`, each starting with `/`. */
  routes: string[];
  json: boolean;
  /** The screenshot directory. */
  out: string;
  /** The runs per route; `VIEWPORTS` unless a test narrows them. */
  viewports: Viewport[];
};

export type ParsedUicheckArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; options: UicheckOptions }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedUicheckArgs {
  return { ok: false, error, exitCode: 2 };
}

/** Parses and validates the `scripts/uicheck.ts` arguments without running anything. */
export function parseUicheckArgs(args: string[]): ParsedUicheckArgs {
  let values: { routes?: string; json?: boolean; out?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        routes: { type: "string" },
        json: { type: "boolean", default: false },
        out: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (err) {
    return fail((err as Error).message);
  }
  if (values.help) return { ok: true, help: true };

  const [base, ...extra] = positionals;
  if (!base) return fail("missing <baseUrl>");
  if (extra.length > 0) return fail(`unexpected argument: ${extra[0]}`);
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return fail(`<baseUrl> must be an http(s) URL (got "${base}")`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return fail(`<baseUrl> must be an http(s) URL (got "${base}")`);

  const routes =
    values.routes === undefined
      ? DEFAULT_ROUTES
      : values.routes
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r.length > 0);
  if (routes.length === 0)
    return fail(
      `--routes must name at least one route (got "${values.routes}")`,
    );
  const bad = routes.find((r) => !r.startsWith("/"));
  if (bad) return fail(`each route must start with "/" (got "${bad}")`);

  const out = values.out?.trim();
  if (values.out !== undefined && !out)
    return fail("--out must name a directory");

  return {
    ok: true,
    help: false,
    options: {
      baseUrl: url.href.replace(/\/+$/, ""),
      routes,
      json: values.json ?? false,
      out: out || DEFAULT_OUT,
      viewports: VIEWPORTS,
    },
  };
}

/** An element as the report names it, e.g. `a "Docs"`. */
export type Described = string;

/** One axe-core violation: its rule and the elements that break it. */
export type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  targets: string[];
};

/** Where focus was after one Tab press. */
export type TabStep = {
  /** Which element had focus; `null` when nothing did (the document). */
  key: number | null;
  described: Described;
  /** An `<iframe>`: focus moves inside it while the page sees the frame. */
  frame: boolean;
  /** Its outline and box-shadow while focused. */
  focusedStyle: string;
};

/** What the keyboard walk found. */
export type KeyboardResult = {
  /** Interactive elements expected in the Tab order, and how many were reached. */
  expected: number;
  reached: number;
  unreached: Described[];
  /** Why focus is trapped, when it is. */
  trapped?: string;
  /** Focused elements whose outline and box-shadow didn't change. */
  noFocusIndicator: Described[];
};

/** How a Tab walk ended, so far. */
type Scan = {
  visited: Map<number, TabStep>;
  /** Focus came back to the first element reached, or left for the document. */
  returned: boolean;
  trapped?: string;
};

/**
 * Reads the steps of a Tab walk in order. Focus is trapped when it stays on
 * one element (other than a frame, which moves focus inside itself) or comes
 * back to an element other than the first one reached.
 */
function scanTabWalk(steps: TabStep[]): Scan {
  const visited = new Map<number, TabStep>();
  let start: number | undefined;
  let previous: TabStep | undefined;
  for (const step of steps) {
    const staysInFrame = step.frame && previous?.key === step.key;
    if (step.key === null) {
      if (start !== undefined) return { visited, returned: true };
    } else if (start === undefined) {
      start = step.key;
    } else if (staysInFrame) {
      // Tab moved focus inside the frame.
    } else if (step.key === previous?.key) {
      return {
        visited,
        returned: false,
        trapped: `focus stays on ${step.described}`,
      };
    } else if (step.key === start) {
      return { visited, returned: true };
    } else if (visited.has(step.key)) {
      return {
        visited,
        returned: false,
        trapped: `focus loops back to ${step.described} and never returns to the start`,
      };
    }
    if (step.key !== null) visited.set(step.key, step);
    previous = step;
  }
  return { visited, returned: false };
}

/** Whether a walk needs no more Tab presses: it came back, or is trapped. */
export function tabWalkEnded(steps: TabStep[]): boolean {
  const scan = scanTabWalk(steps);
  return scan.returned || scan.trapped !== undefined;
}

/**
 * Judges a Tab walk: `steps` in order, `expected` the elements that must be
 * reached (by key), `unfocusedStyle` each reached element's outline and
 * box-shadow when it isn't focused. A walk that never came back within
 * `maxTabs` presses is trapped too.
 */
export function judgeTabWalk(
  steps: TabStep[],
  expected: Map<number, Described>,
  unfocusedStyle: Map<number, string>,
  maxTabs = MAX_TABS,
): KeyboardResult {
  const { visited, returned, ...scan } = scanTabWalk(steps);
  let trapped = scan.trapped;
  if (!trapped && !returned && (visited.size > 0 || expected.size > 0)) {
    trapped =
      visited.size === 0
        ? "no element takes focus"
        : `focus didn't return to the start within ${maxTabs} Tab presses`;
  }

  const noFocusIndicator: Described[] = [];
  for (const [key, step] of visited) {
    if (step.frame) continue; // its indicator is inside the frame's document
    if (step.focusedStyle === unfocusedStyle.get(key)) {
      noFocusIndicator.push(step.described);
    }
  }
  const unreached = [...expected]
    .filter(([key]) => !visited.has(key))
    .map(([, described]) => described);
  return {
    expected: expected.size,
    reached: expected.size - unreached.length,
    unreached,
    trapped,
    noFocusIndicator,
  };
}

/** One route at one viewport. */
export type UicheckRun = {
  route: string;
  width: number;
  scheme: ColorScheme;
  status: number | null;
  violations: AxeViolation[];
  keyboard: KeyboardResult;
  cspViolations: string[];
  screenshot: string;
  failures: string[];
};

export type UicheckReport = {
  baseUrl: string;
  runs: UicheckRun[];
  pass: boolean;
};

/** The failures of one run, as lines of the report. */
export function runFailures(
  run: Omit<UicheckRun, "failures" | "screenshot">,
): string[] {
  const failures: string[] = [];
  if (run.status === null || run.status >= 400) {
    failures.push(`the page answered HTTP ${run.status ?? "nothing"}`);
  }
  for (const v of run.violations) {
    failures.push(
      `axe ${v.id} (${v.impact ?? "no impact"}): ${v.help} · ${v.targets.join(", ")}`,
    );
  }
  const k = run.keyboard;
  if (k.trapped) failures.push(`keyboard: ${k.trapped}`);
  for (const u of k.unreached) failures.push(`keyboard: never reached ${u}`);
  for (const n of k.noFocusIndicator) {
    failures.push(`keyboard: no visible focus indicator on ${n}`);
  }
  for (const c of run.cspViolations) failures.push(`CSP: ${c}`);
  return failures;
}

/** A file name for a route's screenshots: `/` is `root`, `/vendors?query=x` is `vendors_query_x`. */
export function routeSlug(route: string): string {
  const slug = route
    .replace(/^\/+/, "")
    .replace(/[^A-Za-z0-9.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "root";
}

/** The report as text: a line per run, its failures under it, then the verdict. */
export function uicheckLines(report: UicheckReport): string[] {
  const lines = [`UI check: ${report.baseUrl}`, ""];
  for (const r of report.runs) {
    const k = r.keyboard;
    lines.push(
      `${r.failures.length ? "FAIL" : "PASS"} ${r.route} ${r.width} ${r.scheme.padEnd(5)}  axe ${r.violations.length} · keyboard ${k.reached}/${k.expected} · CSP ${r.cspViolations.length} · ${r.screenshot}`,
    );
    for (const f of r.failures) lines.push(`  ${f}`);
  }
  lines.push("");
  const failed = report.runs.filter((r) => r.failures.length > 0).length;
  lines.push(
    report.pass ? "PASS" : `FAIL (${failed} of ${report.runs.length} runs)`,
  );
  return lines;
}

/** What `installProbe` leaves in the page for the other page functions. */
type Probe = {
  /** A number for each element seen, so the walk can tell them apart. */
  key(el: Element): number;
  /** An element as the report names it, e.g. `a "Docs"`. */
  describe(el: Element): string;
  /** Its outline and box-shadow, the parts of a focus indicator compared. */
  focusStyle(el: Element): string;
};

declare global {
  interface Window {
    __uicheck?: Probe;
  }
}

/** Runs in the page first: installs the helpers the other page functions use. */
function installProbe(): void {
  const keys = new WeakMap<Element, number>();
  let next = 0;
  window.__uicheck = {
    key(el) {
      let key = keys.get(el);
      if (key === undefined) {
        key = next++;
        keys.set(el, key);
      }
      return key;
    },
    describe(el) {
      const label = (
        el.getAttribute("aria-label") ||
        (el as HTMLElement).innerText ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.getAttribute("href") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);
      const id = el.id ? `#${el.id}` : "";
      return `${el.tagName.toLowerCase()}${id}${label ? ` "${label}"` : ""}`;
    },
    focusStyle(el) {
      const s = getComputedStyle(el);
      const outline =
        s.outlineStyle === "none" || Number.parseFloat(s.outlineWidth) === 0
          ? "none"
          : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`;
      return `outline: ${outline}; box-shadow: ${s.boxShadow}`;
    },
  };
}

/**
 * Runs in the page: every element that should be in the Tab order and is
 * rendered, keyed and described.
 */
function markExpected(): [number, string][] {
  const probe = window.__uicheck as Probe;
  const selector = [
    "a[href]",
    "area[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "iframe",
    "summary",
    "audio[controls]",
    "video[controls]",
    "[contenteditable]:not([contenteditable=false])",
    "[tabindex]",
  ].join(",");
  const out: [number, string][] = [];
  for (const el of document.querySelectorAll(selector)) {
    if ((el as HTMLElement).tabIndex < 0) continue;
    if ((el as HTMLButtonElement).disabled) continue;
    if (el.closest("[inert]")) continue;
    if (el.closest("details:not([open])") && el.tagName !== "SUMMARY") continue;
    if (el.getClientRects().length === 0) continue;
    const { visibility } = getComputedStyle(el);
    if (visibility === "hidden" || visibility === "collapse") continue;
    out.push([probe.key(el), probe.describe(el)]);
  }
  return out;
}

/** Runs in the page: the focused element, keyed, with its focus styles. */
async function readFocus(): Promise<TabStep> {
  const probe = window.__uicheck as Probe;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    return {
      key: null,
      described: "the document",
      frame: false,
      focusedStyle: "",
    };
  }
  // Let a focus transition finish before reading the style.
  await Promise.race([
    Promise.all(el.getAnimations().map((a) => a.finished)).catch(() => {}),
    new Promise((r) => setTimeout(r, 1_000)),
  ]);
  return {
    key: probe.key(el),
    described: probe.describe(el),
    frame: el.tagName === "IFRAME",
    focusedStyle: probe.focusStyle(el),
  };
}

/**
 * Runs in the page: blurs the focused element, then gives each keyed element's
 * unfocused outline and box-shadow.
 */
function readUnfocused(keys: number[]): [number, string][] {
  const probe = window.__uicheck as Probe;
  (document.activeElement as HTMLElement | null)?.blur?.();
  const wanted = new Set(keys);
  const out: [number, string][] = [];
  for (const el of document.querySelectorAll("*")) {
    const key = probe.key(el);
    if (wanted.has(key)) out.push([key, probe.focusStyle(el)]);
  }
  return out;
}

/** Tabs through `page` from the top and judges the walk. */
export async function walkKeyboard(
  page: Page,
  maxTabs = MAX_TABS,
): Promise<KeyboardResult> {
  await page.evaluate(installProbe);
  const expected = new Map(await page.evaluate(markExpected));
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur?.(),
  );
  const steps: TabStep[] = [];
  for (let i = 0; i < maxTabs && !tabWalkEnded(steps); i++) {
    await page.keyboard.press("Tab");
    steps.push(await page.evaluate(readFocus));
  }
  const keys = [...new Set(steps.map((s) => s.key))].filter(
    (k): k is number => k !== null,
  );
  const unfocused = new Map(await page.evaluate(readUnfocused, keys));
  return judgeTabWalk(steps, expected, unfocused, maxTabs);
}

const CSP_MESSAGE = /Content Security Policy/i;

/** Checks one route at one viewport in a fresh context of `browser`. */
export async function checkRun(
  browser: Browser,
  options: Pick<UicheckOptions, "baseUrl" | "out">,
  route: string,
  viewport: Viewport,
): Promise<UicheckRun> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: viewport.scheme,
  });
  const page = await context.newPage();
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (CSP_MESSAGE.test(message.text())) cspViolations.push(message.text());
  });
  const screenshot = join(
    options.out,
    `${routeSlug(route)}-${viewport.width}-${viewport.scheme}.png`,
  );
  try {
    const response = await page.goto(options.baseUrl + route, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const violations: AxeViolation[] = axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      targets: v.nodes.map((n) => n.target.join(" ")),
    }));
    await page.screenshot({ path: screenshot, fullPage: true });
    const keyboard = await walkKeyboard(page);
    const run = {
      route,
      width: viewport.width,
      scheme: viewport.scheme,
      status: response?.status() ?? null,
      violations,
      keyboard,
      cspViolations,
    };
    return { ...run, screenshot, failures: runFailures(run) };
  } finally {
    await context.close();
  }
}

/** Checks every route at every viewport in one headless Chromium. */
export async function runUicheck(
  options: UicheckOptions,
): Promise<UicheckReport> {
  mkdirSync(resolve(options.out), { recursive: true });
  const browser = await chromium.launch();
  try {
    const runs: UicheckRun[] = [];
    for (const route of options.routes) {
      for (const viewport of options.viewports) {
        runs.push(await checkRun(browser, options, route, viewport));
      }
    }
    return {
      baseUrl: options.baseUrl,
      runs,
      pass: runs.every((r) => r.failures.length === 0),
    };
  } finally {
    await browser.close();
  }
}
