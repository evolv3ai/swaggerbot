import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createSpecForms } from "~/index-store/spec-forms";
import { nearestOperations } from "~/spec-forms/nearest";
import {
  type OperationAnswer,
  operationAnswer,
} from "~/spec-forms/operation-http";
import type { McpTool } from "../server";
import {
  ApiIdInput,
  JsonObject,
  MCP_EXPANDED_MAX_BYTES,
  openForTool,
  referencesText,
  SpecIdInput,
  toolError,
} from "./expanded";

const DESCRIPTION = `One operation of an API's Spec, ready to call: its parameters (the Path Item's merged in), request body, responses and effective security, with the references they reach inlined, and the security schemes it names.

To keep the result small (about 24 kB), inlining is breadth-first and stops at the deepest detail: a reference left is { $ref, "x-truncated": true }, and get_schema(apiId, name) returns that schema. A schema that recurs within itself is { $ref, "x-circular": true } where it recurs, and listed once in circular.

path is a path of the Spec exactly as get_spec_outline lists it, with its {parameters}, not filled in. A path that isn't in the Spec gets the nearest operations to retry with.`;

const GetOperationInput = z.object({
  apiId: ApiIdInput,
  method: z
    .string()
    .min(1)
    .describe('The HTTP method, in any case, e.g. "get".'),
  path: z
    .string()
    .min(1)
    .describe(
      'The path as the Spec has it, with its parameters as templates, e.g. "/v1/customers/{customer}".',
    ),
  specId: SpecIdInput,
});

const GetOperationOutput = z.object({
  apiId: z.string(),
  specId: z.string(),
  method: z.string(),
  path: z.string(),
  operation: JsonObject,
  circular: JsonObject,
  securitySchemes: JsonObject,
  truncated: z.boolean(),
});

/**
 * `get_operation`: the answer of `GET /api/apis/{apiId}/operation`, expanded
 * to `MCP_EXPANDED_MAX_BYTES`. An operation not in the Spec is a tool error
 * with the nearest operations of the Spec Outline.
 */
export const registerGetOperation: McpTool = (server, deps) => {
  server.registerTool(
    "get_operation",
    {
      title: "Get one operation of a Spec",
      description: DESCRIPTION,
      inputSchema: GetOperationInput,
      outputSchema: GetOperationOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ apiId, method, path, specId }): Promise<CallToolResult> => {
      const opened = await openForTool(deps, apiId, specId);
      if ("error" in opened) return opened.error;
      const answer = operationAnswer(
        apiId,
        opened.specId,
        opened.doc,
        method,
        path,
        MCP_EXPANDED_MAX_BYTES,
      );
      if (!answer) {
        const outline = createSpecForms(opened.db).getOutline(opened.specId);
        return toolError(
          missingOperationText(
            apiId,
            specId,
            method,
            path,
            outline.status === "ready"
              ? nearestOperations(outline.outline.operations, method, path)
              : [],
          ),
        );
      }
      return {
        content: [{ type: "text", text: operationText(answer, specId) }],
        structuredContent: answer,
      };
    },
  );
};

/** The sentence an agent reads first: which operation this is, and what was left. */
export function operationText(
  answer: OperationAnswer,
  specId: string | undefined,
): string {
  const { operationId, summary } = answer.operation;
  const named = [
    typeof operationId === "string" ? `operationId "${operationId}"` : "",
    typeof summary === "string" ? `"${summary}"` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `${answer.method.toUpperCase()} ${answer.path} of ${answer.apiId}${named ? ` (${named})` : ""}. ${referencesText(answer, answer.apiId, specId)}`;
}

/** Why the operation isn't there, and the nearest ones to call instead. */
export function missingOperationText(
  apiId: string,
  specId: string | undefined,
  method: string,
  path: string,
  nearest: readonly { method: string; path: string }[],
): string {
  const asked = `This Spec has no operation ${method.toUpperCase()} ${path}.`;
  const outline = `get_spec_outline(apiId: "${apiId}"${specId ? `, specId: "${specId}"` : ""})`;
  if (nearest.length === 0)
    return `${asked} Next: ${outline} lists its operations; path must equal one of them exactly.`;
  const [first] = nearest as [{ method: string; path: string }];
  return `${asked} The nearest: ${nearest
    .map((o) => `${o.method.toUpperCase()} ${o.path}`)
    .join(
      ", ",
    )}. Next: get_operation(apiId: "${apiId}", method: "${first.method}", path: "${first.path}"${specId ? `, specId: "${specId}"` : ""}), with path exactly as listed, its {parameters} not filled in; or ${outline} to search.`;
}
