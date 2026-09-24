import { createFileRoute } from "@tanstack/react-router";
import { noSuchApiRoute } from "~/server/api-fallbacks";

/** Any `/api/…` path no other route serves: a JSON 404, not the app's page. */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: () => noSuchApiRoute(),
    },
  },
});
