import { createFileRoute } from "@tanstack/react-router";
import { DocsView } from "~/components/docs/docs-view";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "The HTTP API and MCP · SwaggerBot" },
      {
        name: "description",
        content:
          "SwaggerBot's HTTP API and MCP server: each route with a curl and its answer, the five MCP tools, the key rules, and how to request a key.",
      },
    ],
  }),
  component: DocsView,
});
