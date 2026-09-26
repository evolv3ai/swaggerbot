import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Browser, chromium } from "playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SpecFrame } from "~/components/viewer/spec-frame";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { publishedResponse } from "./downloads";
import { SCALAR_SCRIPT_PATH } from "./scalar-script";
import { contentSecurityPolicy, newNonce } from "./security-headers";
import { embedResponse } from "./spec-embed";

/**
 * The Spec viewer end to end in Chromium, on a Spec whose text is hostile:
 * the viewer page (the app's CSP) frames `/embed/specs/{specId}` (the
 * frame's CSP, the real Scalar bundle), which fetches the real download.
 * No script from the Spec may run, and no request may leave localhost.
 *
 * Needs Chromium; skipped without it, except in CI (as uicheck's tests).
 */
const probe = await chromium.launch().catch(() => undefined);
await probe?.close();

const ROOT = join(import.meta.dirname, "..", "..");
const SCALAR = join(
  dirname(createRequire(import.meta.url).resolve("@scalar/api-reference")),
  "browser",
  "standalone.js",
);
const STATIC: Record<string, string> = {
  [SCALAR_SCRIPT_PATH]: SCALAR,
  "/embed/memory-storage.js": join(
    ROOT,
    "public",
    "embed",
    "memory-storage.js",
  ),
  "/embed/frame-viewport.js": join(
    ROOT,
    "public",
    "embed",
    "frame-viewport.js",
  ),
};

describe.skipIf(!probe && !process.env.CI)(
  "the Spec viewer on a hostile Spec",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "swaggerbot-viewer-"));
    const db = openDb(join(dir, "index.db"));
    const repo = createRepo(db);
    repo.upsertVendor({
      id: "hostile.example",
      name: "Hostile",
      domain: "hostile.example",
    });
    repo.upsertApi({
      id: "hostile.example/api",
      vendorId: "hostile.example",
      name: "Hostile Co",
    });
    const specId = repo.putSpec(
      "hostile.example/api",
      readFileSync(
        join(import.meta.dirname, "__fixtures__", "hostile-spec.json"),
      ),
      { specVersion: "3.1.0", apiVersion: "1.0.0", format: "json" },
    ).id;

    let origin = "";
    const served: string[] = [];
    const server = createServer((req, res) => {
      served.push(req.url ?? "");
      void answer(req).then((response) => send(response, res));
    });
    async function answer(req: IncomingMessage): Promise<Response> {
      const url = new URL(req.url ?? "/", origin);
      const request = new Request(url);
      const file = STATIC[url.pathname];
      if (file)
        return new Response(readFileSync(file), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      if (url.pathname === "/viewer") {
        const frame = renderToStaticMarkup(
          createElement(SpecFrame, {
            specId,
            form: "published",
            apiName: "Hostile Co",
          }),
        );
        // `?below`: the frame starts well below the fold, as on the viewer
        // page, and is tall enough to hold the first operation.
        const spacer = url.searchParams.has("below")
          ? '<style>iframe{width:1000px;height:1500px}</style><div style="height:3000px"></div>'
          : "";
        return new Response(
          `<!doctype html><title>viewer</title>${spacer}${frame}`,
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": contentSecurityPolicy(newNonce()),
            },
          },
        );
      }
      if (url.pathname === `/embed/specs/${specId}`)
        return embedResponse(request, specId, () => db);
      if (url.pathname === `/api/specs/${specId}/published`)
        return publishedResponse(request, specId, () => db);
      return new Response("not found", { status: 404 });
    }
    async function send(response: Response, res: ServerResponse) {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    }

    let browser: Browser;
    beforeAll(async () => {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      browser = await chromium.launch();
    });
    afterAll(async () => {
      await browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it("renders the Spec with none of its script, remote content or links live", async () => {
      const context = await browser.newContext();
      const logs: string[] = [];
      // A remote URL the page asked for, and what became of it. Chromium
      // reports a request the CSP refused as one that failed.
      const remote: string[] = [];
      context.on("requestfailed", (r) => {
        if (new URL(r.url()).origin !== origin)
          remote.push(`${r.url()} ${r.failure()?.errorText}`);
      });
      context.on("requestfinished", (r) => {
        if (new URL(r.url()).origin !== origin) remote.push(`${r.url()} sent`);
      });
      // Whatever gets past the CSP reaches the network here: stopped, and recorded.
      const left: string[] = [];
      await context.route(
        (url) => url.origin !== origin && url.protocol !== "data:",
        (route) => {
          left.push(route.request().url());
          return route.abort();
        },
      );
      const page = await context.newPage();
      page.on("console", (m) => logs.push(m.text()));
      page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
      page.on("dialog", (d) => {
        logs.push(`dialog: ${d.message()}`);
        void d.dismiss();
      });

      await page.goto(`${origin}/viewer`);
      const frame = page.frameLocator("iframe");
      // Scalar has rendered the Spec, description included.
      await frame
        .getByRole("heading", { name: "Hostile Co" })
        .first()
        .waitFor({ timeout: 60_000 });
      await frame.getByText("A description with traps.").first().waitFor();
      // Follow the links it shows, if any survived.
      for (const link of await frame.getByText(/html link|markdown link/).all())
        await link.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForTimeout(500);

      const embed = page
        .frames()
        .find((f) => f.url().includes("/embed/specs/"));
      if (!embed) throw new Error("no frame");
      const dom = await embed.evaluate(() => ({
        inlineScripts: [...document.scripts]
          .filter((s) => !s.src && s.type !== "application/json")
          .map((s) => s.textContent),
        handlers: [...document.querySelectorAll("*")].flatMap((el) =>
          [...el.attributes]
            .filter((a) => a.name.startsWith("on"))
            .map((a) => `${el.tagName} ${a.name}`),
        ),
        javascriptLinks: [...document.querySelectorAll("a[href]")]
          .map((a) => a.getAttribute("href") ?? "")
          .filter((href) => /^\s*javascript:/i.test(href)),
        loadedRemoteImages: [...document.images]
          .filter((img) => !img.src.startsWith(location.origin))
          .filter((img) => img.complete && img.naturalWidth > 0)
          .map((img) => img.src),
        frames: [...document.querySelectorAll("iframe, object, embed")].length,
      }));
      await context.close();

      expect(logs.filter((l) => l.includes("PWNED"))).toEqual([]);
      expect(logs.filter((l) => l.startsWith("dialog"))).toEqual([]);
      expect(left).toEqual([]);
      // The images Scalar kept from the description were refused by the CSP.
      for (const r of remote) expect(r).toMatch(/ csp$/);
      expect(dom).toEqual({
        inlineScripts: [],
        handlers: [],
        javascriptLinks: [],
        loadedRemoteImages: [],
        frames: 0,
      });
      // It did load: the frame, Scalar, and the Spec from its download URL.
      expect(served).toEqual(
        expect.arrayContaining([
          `/embed/specs/${specId}?form=published&theme=dark`,
          SCALAR_SCRIPT_PATH,
          `/api/specs/${specId}/published`,
        ]),
      );
    });

    it("renders the first operations while the frame is still below the fold", async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await page.goto(`${origin}/viewer?below`);
      const frame = page.frameLocator("iframe");
      await frame
        .getByRole("heading", { name: "Hostile Co" })
        .first()
        .waitFor({ timeout: 60_000 });
      const embed = page
        .frames()
        .find((f) => f.url().includes("/embed/specs/"));
      if (!embed) throw new Error("no frame");
      // Never scrolled into view, yet what is in the frame's own viewport
      // is rendered: Scalar's lazy sections there are no longer placeholders.
      await embed.waitForFunction(
        () => {
          const lazy = [...document.querySelectorAll("[data-placeholder]")];
          return (
            lazy.some((e) => e.getAttribute("data-placeholder") === "false") &&
            !lazy.some(
              (e) =>
                e.getAttribute("data-placeholder") === "true" &&
                e.getBoundingClientRect().top < window.innerHeight,
            )
          );
        },
        undefined,
        { timeout: 4_000 },
      );
      expect(await embed.evaluate(() => document.body.innerText)).toContain(
        "List things",
      );
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await context.close();
    }, 30_000);
  },
);
