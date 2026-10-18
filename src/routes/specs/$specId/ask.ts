import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "~/server/api-fallbacks";
import { chatDeps } from "~/server/app-instance";
import { handleAsk } from "~/server/chat";

/**
 * `POST /specs/{specId}/ask`: one Ask this Spec turn, streamed
 * (`src/server/chat.ts`). Outside `/api/` because it needs the person's
 * session, which AuthKit's middleware reads only there.
 */
export const Route = createFileRoute("/specs/$specId/ask")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleAsk(request, params.specId, chatDeps()),
      ANY: methodNotAllowed("POST"),
    },
  },
});
