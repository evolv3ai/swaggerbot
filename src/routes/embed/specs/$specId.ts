import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "~/server/api-fallbacks";
import { getApp } from "~/server/app-instance";
import { embedResponse } from "~/server/spec-embed";
import { publicBaseUrlOf } from "~/spec-forms/outcome";

/** The Spec viewer's frame: Scalar on one form of a Spec, under its own CSP. */
export const Route = createFileRoute("/embed/specs/$specId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        embedResponse(
          request,
          params.specId,
          () => getApp().db,
          publicBaseUrlOf(process.env),
        ),
      ANY: methodNotAllowed("GET"),
    },
  },
});
