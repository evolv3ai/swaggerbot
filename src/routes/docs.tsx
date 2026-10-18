import { createFileRoute } from "@tanstack/react-router";
import { DocsView } from "~/components/docs/docs-view";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "The HTTP API, MCP and CLI · SwaggerBot" },
      {
        name: "description",
        content:
          "SwaggerBot's HTTP API, MCP server and CLI: each route with a curl and its answer, the five MCP tools, the swaggerbot commands, the key rules, and how to get a key.",
      },
    ],
  }),
  component: DocsView,
});
