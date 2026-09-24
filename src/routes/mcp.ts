import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "~/mcp/http";
import { createSwaggerbotMcpHandler } from "~/mcp/server";
import { gate, getApp } from "~/server/app-instance";
import { publicBaseUrlOf } from "~/spec-forms/outcome";

// One handler for the server: it keeps no request state (a fresh McpServer
// per request), so every request can share it.
const handler = createSwaggerbotMcpHandler({
  getApp,
  gate,
  baseUrl: publicBaseUrlOf(process.env),
});

/** The MCP server (ADR 0005): every method, the per-IP limit and the API key checked first. */
export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      ANY: ({ request }) => handleMcpRequest(request, handler, getApp, gate),
    },
  },
});
