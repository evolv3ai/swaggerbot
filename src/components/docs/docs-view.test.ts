import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NAV } from "~/components/shell/nav";
import { splitRoute } from "~/components/ui/method-badge";
import { MCP_TOOLS, type McpDeps } from "~/mcp/server";
import { DocsView } from "./docs-view";
import {
  BASE_URL,
  EXAMPLES,
  MCP_ADD,
  MCP_TOOL_ROWS,
  ROUTES,
} from "./reference";

const html = renderToStaticMarkup(createElement(DocsView));
/** The page's text, tags dropped and entities read. */
const text = html
  .replace(/<[^>]+>/g, "")
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", '"')
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">");

describe("DocsView", () => {
  it("has the Keys section with the request-a-key mailto (D9)", () => {
    expect(html).toMatch(
      /<section[^>]*aria-labelledby="keys"[^>]*>\s*<div[^>]*>\s*<h2 id="keys"[\s\S]*href="mailto:hello@evolv3\.ai\?subject=swagger\.bot%20API%20key%20request"/,
    );
  });

  it("gives every example a curl against the public origin and its answer", () => {
    for (const example of EXAMPLES) {
      expect(example.curl.startsWith("curl ")).toBe(true);
      expect(example.curl).toContain(`${BASE_URL}/api/`);
      expect(example.answer.length).toBeGreaterThan(0);
    }
    // Each code block (a call, its answer, the three MCP lines) has its own
    // Copy and a polite live region.
    const copies = (html.match(/>Copy<\/button>/g) ?? []).length;
    expect(copies).toBe(EXAMPLES.length * 2 + 3);
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(copies);
  });

  it("lists every route, GET /api/vendors included", () => {
    for (const row of ROUTES) {
      const { method, rest } = splitRoute(row.route);
      expect(method).not.toBeNull();
      expect(html).toContain(`>${method}</span>`);
      expect(text).toContain(rest);
    }
    expect(ROUTES.map((r) => r.route)).toContain(
      "GET /api/vendors[?query=&cursor=&limit=]",
    );
  });

  it("lists exactly the tools /mcp serves, in its order", () => {
    const served: string[] = [];
    const recorder = {
      registerTool: (name: string) => served.push(name),
    } as unknown as McpServer;
    for (const register of MCP_TOOLS)
      register(recorder, {} as unknown as McpDeps);
    expect(MCP_TOOL_ROWS.map((t) => t.name)).toEqual(served);
    expect(text).toContain(MCP_ADD);
  });

  it("never lets a path break inside a word", () => {
    // Code blocks may wrap anywhere; the page's own text and paths don't.
    const outsideCode = html.replace(/<pre[\s\S]*?<\/pre>/g, "");
    expect(outsideCode).not.toContain("overflow-wrap:anywhere");
    expect(html).toContain("<wbr/>");
  });

  it("has every /docs anchor the sidebar links to", () => {
    const anchors = NAV.flatMap((g) => g.links)
      .filter((l) => l.to === "/docs" && l.hash)
      .map((l) => l.hash);
    expect(anchors).toEqual(
      expect.arrayContaining(["lookup", "vendors", "outline", "published"]),
    );
    for (const id of [...anchors, "mcp-add", "tools", "access", "keys"])
      expect(html).toContain(`id="${id}"`);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives each route example its method tag and a curl/Answer tab pair", () => {
    for (const example of EXAMPLES) {
      expect(html).toMatch(
        new RegExp(`<h3 id="${example.id}"[^>]*><span[^>]*>(GET|POST)</span>`),
      );
    }
    expect((html.match(/role="tab"[^>]*>curl</g) ?? []).length).toBe(
      EXAMPLES.length,
    );
    expect((html.match(/role="tab"[^>]*>Answer</g) ?? []).length).toBe(
      EXAMPLES.length,
    );
  });

  it("carries no Darkroom styling", () => {
    expect(html).not.toMatch(
      /font-(caps|pencil|segment)|text-ink-2|border-rule|\bbg-bay|print-/,
    );
  });
});

describe("the landing page", () => {
  it("no longer carries the Claude Code block or the route table", () => {
    const source = readFileSync("src/routes/index.tsx", "utf8");
    expect(source).not.toContain("claude mcp add");
    expect(source).not.toContain("/api/lookup");
    expect(source).toContain('to="/docs"');
  });
});
