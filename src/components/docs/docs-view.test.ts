import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLI_USAGE, parseCliArgs } from "~/cli/args";
import { NAV } from "~/components/shell/nav";
import { splitRoute } from "~/components/ui/method-badge";
import { MCP_TOOLS, type McpDeps } from "~/mcp/server";
import {
  CLI_COMMANDS,
  CLI_EXIT_CODES,
  CLI_INSTALL,
  CLI_INSTALL_GLOBAL,
  CLI_LOGIN,
} from "./cli-reference";
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
  it("heads the page with its title alone, no category kicker", () => {
    expect(html.slice(0, html.indexOf("<h1"))).not.toMatch(/>Docs</);
  });

  it("has the Keys section leading to /keys, mailing only for a larger quota", () => {
    expect(html).toMatch(
      /<section[^>]*aria-labelledby="keys"[^>]*>\s*<div[^>]*>\s*<h2 id="keys"[^>]*>Get a key<\/h2>[\s\S]*href="\/keys"[^>]*>Get a key<\/a>/,
    );
    for (const words of [
      "GitHub or by email",
      "One key per person",
      "daily quota of 100",
      "Roll gives the key a new secret",
      "Revoke ends it",
    ])
      expect(text).toContain(words);
    const mailtos = html.match(/href="mailto:[^"]*"/g) ?? [];
    expect(mailtos).toEqual([
      'href="mailto:hello@evolv3.ai?subject=swagger.bot%20larger%20quota"',
    ]);
    expect(text).toMatch(
      /Write to hello@evolv3\.ai to ask for a larger quota\./,
    );
  });

  it("keeps the Authorization: Bearer examples", () => {
    expect(text).toContain("Authorization: Bearer <key>");
    expect(text).toContain('--header "Authorization: Bearer <key>"');
  });

  it("has the top bar's key button and Search's key link lead to /keys, not the mailto", () => {
    for (const file of [
      "src/components/shell/shell.tsx",
      "src/routes/index.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("mailto:");
      expect(source, file).not.toContain("KEY_REQUEST");
      expect(source, file).not.toMatch(/hash="keys"/);
      expect(source, file).toContain('to="/keys"');
    }
    expect(readFileSync("src/components/shell/shell.tsx", "utf8")).toMatch(
      /to="\/keys"[^>]*>\s*<span[^>]*>Get an API key</,
    );
    expect(readFileSync("src/routes/index.tsx", "utf8")).toMatch(
      /to="\/keys"[\s\S]{0,200}Get a key\s*<\/Link>/,
    );
  });

  it("gives every example a curl against the public origin and its answer", () => {
    for (const example of EXAMPLES) {
      expect(example.curl.startsWith("curl ")).toBe(true);
      expect(example.curl).toContain(`${BASE_URL}/api/`);
      expect(example.answer.length).toBeGreaterThan(0);
    }
    // Each code block (a call, its answer, the three MCP lines, the CLI's
    // install, login and command lines) has its own Copy and a polite live
    // region.
    const copies = (html.match(/>Copy<\/button>/g) ?? []).length;
    expect(copies).toBe(EXAMPLES.length * 2 + 3 + 3 + CLI_COMMANDS.length);
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
    expect(anchors).toEqual(
      expect.arrayContaining(["cli-install", "cli-commands"]),
    );
    for (const id of [...anchors, "mcp-add", "tools", "cli", "access", "keys"])
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

  it("has the CLI section after MCP and before the key rules", () => {
    const at = (id: string) => html.indexOf(`<h2 id="${id}"`);
    expect(at("mcp")).toBeLessThan(at("cli"));
    expect(at("cli")).toBeLessThan(at("access"));
    expect(NAV.map((g) => g.title)).toContain("CLI");
  });

  it("teaches the install, login with a key from /keys, --json, the exit codes and --url", () => {
    for (const line of [CLI_INSTALL, CLI_INSTALL_GLOBAL, CLI_LOGIN])
      expect(text).toContain(line);
    const cli = html.slice(
      html.indexOf('<h2 id="cli"'),
      html.indexOf('<h2 id="access"'),
    );
    expect(cli).toContain('href="/keys"');
    expect(text).toContain(
      "it prints the same JSON as the HTTP API, so the answers above apply",
    );
    for (const row of CLI_EXIT_CODES)
      expect(cli).toMatch(
        new RegExp(`<th scope="row"[^>]*>${row.code}</th><td[^>]*>`),
      );
    expect(text).toContain("--url <origin>");
    expect(text).toContain("~/.config/swaggerbot/config.json");
  });

  it("lists every command once, each with its example", () => {
    for (const row of CLI_COMMANDS) {
      const heading = `>swaggerbot ${row.command}</span>`;
      expect(html.split(heading).length - 1, row.command).toBe(1);
      expect(row.example.startsWith(`swaggerbot ${row.command}`)).toBe(true);
      expect(text).toContain(row.example);
    }
  });

  it("documents exactly the commands --help lists, in its order", () => {
    const helpOrder = [...CLI_USAGE.matchAll(/^ {2}([a-z]+)\b/gm)].map(
      (m) => m[1],
    );
    expect(CLI_COMMANDS.map((r) => r.command)).toEqual(helpOrder);
  });

  it("gives examples the CLI parses as their command", () => {
    for (const row of CLI_COMMANDS) {
      const words = (row.example.match(/"[^"]*"|\S+/g) ?? []).map((w) =>
        w.replace(/^"(.*)"$/, "$1"),
      );
      expect(words[0]).toBe("swaggerbot");
      const parsed = parseCliArgs(words.slice(1));
      expect(parsed, row.example).toMatchObject({
        ok: true,
        command: { command: row.command },
      });
    }
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
