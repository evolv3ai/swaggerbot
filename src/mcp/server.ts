import {
  createMcpHandler,
  type McpHttpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import type { Gate, LookupApp } from "~/lookup/http";
import type { VendorApisApp } from "~/server/vendor-apis";
import type { OutlineApp } from "~/spec-forms/http";
import { registerGetSpecOutline } from "./tools/get-spec-outline";
import { registerListVendorApis } from "./tools/list-vendor-apis";
import { registerLookupApi } from "./tools/lookup-api";

/** The implementation version the MCP server reports in `serverInfo`. */
export const MCP_SERVER_VERSION = "0.5.0";

/** What the tools run on: the same app and limits as the HTTP API. */
export type McpDeps = {
  getApp: () => LookupApp & OutlineApp & VendorApisApp;
  gate: Pick<Gate, "dailyQuota" | "now">;
  /** The public base URL download links are made absolute with, if any. */
  baseUrl?: string;
};

/** Registers one tool on a fresh server. */
export type McpTool = (server: McpServer, deps: McpDeps) => void;

/** Every tool `/mcp` serves, in the order `tools/list` gives them. */
export const MCP_TOOLS: McpTool[] = [
  registerLookupApi,
  registerListVendorApis,
  registerGetSpecOutline,
];

/**
 * The MCP server behind `/mcp` (ADR 0005): the SDK's stateless handler,
 * which builds a fresh `McpServer` with every tool for each request, so
 * nothing is kept between requests. Authentication happens before it
 * (`handleMcpRequest`), which hands each request its key as `authInfo`.
 */
export function createSwaggerbotMcpHandler(deps: McpDeps): McpHttpHandler {
  return createMcpHandler(() => {
    const server = new McpServer({
      name: "swagger.bot",
      version: MCP_SERVER_VERSION,
    });
    for (const register of MCP_TOOLS) register(server, deps);
    return server;
  });
}
