import { createFileRoute } from "@tanstack/react-router";
import { createAppLookup } from "~/lookup/app";
import { handleLookupRequest } from "~/lookup/http";
import type { Lookup } from "~/lookup/lookup";

let appLookup: Lookup | undefined;

export const Route = createFileRoute("/api/lookup")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleLookupRequest(request, () => {
          appLookup ??= createAppLookup();
          return appLookup;
        }),
    },
  },
});
