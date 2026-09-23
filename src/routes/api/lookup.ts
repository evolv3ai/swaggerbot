import { createFileRoute } from "@tanstack/react-router";
import { createApp } from "~/lookup/app";
import { handleLookupRequest } from "~/lookup/http";
import type { Lookup } from "~/lookup/lookup";

// Built on the first valid request, which also starts the background
// Verification worker.
let appLookup: Lookup | undefined;

export const Route = createFileRoute("/api/lookup")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleLookupRequest(request, () => {
          appLookup ??= createApp().lookup;
          return appLookup;
        }),
    },
  },
});
