import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

describe("DocsView", () => {
  it("has the Keys section with the request-a-key mailto (D9)", () => {
    expect(html).toMatch(
      /<section[^>]*id="keys"[\s\S]*href="mailto:hello@evolv3\.ai\?subject=swagger\.bot%20API%20key%20request"/,
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
    for (const row of ROUTES)
      expect(html).toContain(row.route.replaceAll("&", "&amp;"));
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
    expect(html).toContain(MCP_ADD);
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
