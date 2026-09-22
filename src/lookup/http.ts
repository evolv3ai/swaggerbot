import { z } from "zod";
import type { Lookup } from "./lookup";

/** The body of `POST /api/lookup`. */
export const LookupBody = z.object({
  name: z.string().trim().min(1).max(200),
  apiVersion: z.string().trim().min(1).optional(),
  allowCommunity: z.boolean().optional(),
  fresh: z.boolean().optional(),
});

/**
 * Handles `POST /api/lookup`: 400 with the zod issues for a bad body, 200
 * with the Outcome otherwise. `getLookup` is called per request, so the real
 * dependencies are built only once a valid request needs them.
 */
export async function handleLookupRequest(
  request: Request,
  getLookup: () => Lookup,
): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON." }, { status: 400 });
  }
  const body = LookupBody.safeParse(json);
  if (!body.success)
    return Response.json(
      { error: "Invalid lookup request.", issues: body.error.issues },
      { status: 400 },
    );
  return Response.json(await getLookup()(body.data));
}
