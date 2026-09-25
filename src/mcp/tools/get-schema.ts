import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { schemaNameOf } from "~/spec-forms/operation";
import { nearestSchemaNames, schemaAnswer } from "~/spec-forms/operation-http";
import { toolResult, withGuidance } from "../result";
import type { McpTool } from "../server";
import {
  ApiIdInput,
  JsonObject,
  MCP_EXPANDED_MAX_BYTES,
  openForTool,
  referencesGuidance,
  SpecIdInput,
  toolError,
} from "./expanded";

const DESCRIPTION = `One schema of an API's Spec (from its components.schemas), with the references it reaches inlined: how to follow a { $ref: "#/components/schemas/<name>", "x-truncated": true } that get_operation or get_schema left.

name is the schema's name or the whole reference, e.g. "customer" or "#/components/schemas/customer". The result is kept small (about 24 kB) the same way as get_operation's: what is left is { $ref, "x-truncated": true }, to follow with get_schema again, and a schema that recurs within itself is { $ref, "x-circular": true } and listed once in circular. A name that isn't in the Spec gets the nearest names.`;

const GetSchemaInput = z.object({
  apiId: ApiIdInput,
  name: z
    .string()
    .min(1)
    .describe(
      'The schema\'s name, or its whole reference, e.g. "customer" or "#/components/schemas/customer".',
    ),
  specId: SpecIdInput,
});

export const GetSchemaOutput = withGuidance(
  z.object({
    apiId: z.string(),
    specId: z.string(),
    name: z.string(),
    schema: z.unknown(),
    circular: JsonObject,
    truncated: z.boolean(),
  }),
);

/**
 * `get_schema`: the answer of `GET /api/apis/{apiId}/schema`, expanded to
 * `MCP_EXPANDED_MAX_BYTES`. A name not in the Spec is a tool error with the
 * nearest names.
 */
export const registerGetSchema: McpTool = (server, deps) => {
  server.registerTool(
    "get_schema",
    {
      title: "Get one schema of a Spec",
      description: DESCRIPTION,
      inputSchema: GetSchemaInput,
      outputSchema: GetSchemaOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ apiId, name, specId }): Promise<CallToolResult> => {
      const opened = await openForTool(deps, apiId, specId);
      if ("error" in opened) return opened.error;
      const answer = schemaAnswer(
        apiId,
        opened.specId,
        opened.doc,
        name,
        MCP_EXPANDED_MAX_BYTES,
      );
      if (!answer)
        return toolError(
          missingSchemaText(
            apiId,
            specId,
            name,
            nearestSchemaNames(opened.doc, name),
          ),
        );
      const references = referencesGuidance(answer, apiId, specId);
      return toolResult({
        summary: `Schema "${answer.name}" of ${apiId}. ${references.summary}`,
        next: references.next,
        data: answer,
      });
    },
  );
};

/** Why the schema isn't there, and the call to make instead. */
export function missingSchemaText(
  apiId: string,
  specId: string | undefined,
  name: string,
  nearest: readonly string[],
): string {
  const asked = `This Spec has no schema "${schemaNameOf(name)}" in components.schemas.`;
  const spec = specId ? `, specId: "${specId}"` : "";
  const [first] = nearest;
  if (first === undefined)
    return `${asked} No name in it is near. Next: get_spec_outline(apiId: "${apiId}"${spec}) to find an operation, then get_operation for it, which inlines the schemas it uses.`;
  return `${asked} The nearest: ${nearest.map((n) => `"${n}"`).join(", ")}. Next: get_schema(apiId: "${apiId}", name: "${first}"${spec}).`;
}
