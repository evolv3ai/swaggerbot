import { createFileRoute } from "@tanstack/react-router";
import { handleLookupRequest } from "~/lookup/http";
import { gate, getApp } from "~/server/app-instance";

export const Route = createFileRoute("/api/lookup")({
  server: {
    handlers: {
      POST: ({ request }) => handleLookupRequest(request, getApp, gate),
    },
  },
});
