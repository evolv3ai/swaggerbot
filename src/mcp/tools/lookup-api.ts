import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Outcome, type SpecAnswer } from "~/domain/outcome";
import { bestProvenance } from "~/domain/provenance";
import {
  answerLookup,
  type LookupAnswer,
  LookupBody,
  secondsToUtcMidnight,
} from "~/lookup/http";
import type { LookupRequest } from "~/lookup/lookup";
import { lookupKeyOf } from "../auth";
import { Guidance, toolResult } from "../result";
import type { McpTool } from "../server";

const DESCRIPTION = `Resolve the name of an API, or of the app or service that offers one (e.g. "Stripe", "Jira Cloud Platform", "GitHub REST API"), to its verified OpenAPI/Swagger Spec and the Spec's Provenance: how strongly the Vendor backs it (Official, Endorsed, Mirror or Community).

The Spec itself is never returned inline: the result gives its download URLs, the Published Form (the Spec as the Vendor serves it) and the Normalized Form (one bundled document in the current OpenAPI version). The result starts with summary (what was found) and next (the calls to make next).

Outcomes: Resolved (one API and its Current Spec), Ambiguous (the name could mean several APIs: call again with one of the candidate names), Unconfirmed (a Spec was found but may not describe the API), NoSpec, Unknown.

Names already in the Index answer without an API key. Any other name needs Discovery on the live web, which needs a key sent as the \`Authorization: Bearer <key>\` header of this MCP server's connection.

Next: get_spec_outline(apiId) to find the operation you need in the Spec, rather than downloading all of it.`;

/** How an agent adds its key to this server, for the refusals that need one. */
const MCP_KEY_HINT =
  "Add the key as a header of this MCP server's connection, e.g. `claude mcp add --transport http swaggerbot <this server's /mcp URL> --header \"Authorization: Bearer <key>\"`. Keys are issued by the operator of this service; ask them for one.";

/** `lookup_api`'s answer: the Outcome, after `summary` and `next`. */
export const LookupApiOutput = z.intersection(Guidance, Outcome);

/**
 * `lookup_api`: a Lookup under the same rules as `POST /api/lookup`
 * (`answerLookup`). A Lookup's refusal (no key for Discovery, a used quota)
 * is a tool error, not a protocol error.
 */
export const registerLookupApi: McpTool = (server, { getApp, gate }) => {
  server.registerTool(
    "lookup_api",
    {
      title: "Look up an API's Spec",
      description: DESCRIPTION,
      inputSchema: LookupBody,
      outputSchema: LookupApiOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (request, ctx) => {
      const answer = await answerLookup(
        request,
        lookupKeyOf(ctx.http?.authInfo),
        getApp(),
        gate,
      );
      return lookupResult(request, answer, gate.now?.() ?? new Date());
    },
  );
};

/** A Lookup's answer as a tool result: the Outcome, or the refusal as an error. */
export function lookupResult(
  request: LookupRequest,
  answer: LookupAnswer,
  now: Date,
): CallToolResult {
  if (answer.status === 200)
    return toolResult({
      ...outcomeGuidance(request, answer.body),
      data: answer.body,
    });
  const { error, limit, used } = answer.body;
  const text =
    answer.status === 401
      ? `${error} ${
          request.fresh
            ? "A fresh Lookup runs Discovery on the live web, which needs an API key."
            : `"${request.name}" isn't in the Index yet, and finding it on the live web needs an API key.`
        } ${MCP_KEY_HINT}`
      : `${error} This key has made ${used} of its ${limit} Discovery Lookups today. The quota resets at 00:00 UTC, in ${durationOf(secondsToUtcMidnight(now))}. Names already in the Index still answer without using any.`;
  return {
    isError: true,
    content: [{ type: "text", text }],
  };
}

/** One sentence (or a few) for the agent: what the Outcome is, and the calls to make next. */
export function outcomeGuidance(
  request: LookupRequest,
  outcome: Outcome,
): Guidance {
  switch (outcome.outcome) {
    case "Resolved": {
      const { api, vendor, currentSpec: spec, provenance } = outcome;
      const alternates = outcome.alternateSpecs.length;
      return {
        summary: [
          `Resolved: ${api.name} by ${vendor.name}, apiId "${api.id}". Its Current Spec${versionOf(spec)} has ${provenance} Provenance.`,
          downloadsText(spec),
          alternates > 0
            ? `${alternates} Alternate Spec${alternates === 1 ? "" : "s"} for other API Versions ${alternates === 1 ? "is" : "are"} in alternateSpecs.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        next: [`get_spec_outline(apiId: "${api.id}")`],
      };
    }
    case "Ambiguous":
      return {
        summary: `Ambiguous: "${request.name}" could mean several APIs: ${outcome.candidates
          .map((c) => `"${c.name}"${c.vendor ? ` (${c.vendor})` : ""}`)
          .join(", ")}.`,
        next: outcome.candidates.map((c) => `lookup_api(name: "${c.name}")`),
      };
    case "Unconfirmed": {
      const { api, vendor, spec } = outcome;
      const provenance = bestProvenance(
        outcome.sources.map((s) => s.provenance),
      );
      return {
        summary: [
          `Unconfirmed: a Spec was found for ${api.name} by ${vendor.name}, apiId "${api.id}"${provenance ? ` (${provenance} Provenance)` : ""}, but it could not be confirmed that it describes that API: ${outcome.reasons.join("; ")}.`,
          downloadsText(spec),
          "Check it before relying on it; get_spec_outline shows what it covers.",
        ].join(" "),
        next: [`get_spec_outline(apiId: "${api.id}")`],
      };
    }
    case "NoSpec":
      return {
        summary: `No Spec: ${outcome.api.name} by ${outcome.vendor.name}, apiId "${outcome.api.id}", has no Spec at an allowed Provenance.${
          outcome.communityAvailable ? " A Community Spec exists." : ""
        }`,
        next: outcome.communityAvailable
          ? [`lookup_api(name: "${request.name}", allowCommunity: true)`]
          : [],
      };
    case "Unknown":
      return {
        summary: `Unknown: no API called "${outcome.name}" was found. Check the name, or try the Vendor's name or the API's full name.`,
        next: [],
      };
  }
}

function versionOf(spec: SpecAnswer): string {
  return spec.apiVersion ? ` (API Version ${spec.apiVersion})` : "";
}

/** Where to download a Spec's two forms, and whether its Normalized Form is built yet. */
export function downloadsText(spec: SpecAnswer): string {
  const pending =
    spec.normalized === "pending"
      ? ", still being built: retry it in a few seconds"
      : spec.normalized === "failed"
        ? ", which could not be built"
        : "";
  return `Download the Spec: ${spec.downloads.published} (Published Form, as the Vendor serves it) or ${spec.downloads.normalized} (Normalized Form${pending}).`;
}

/** `seconds` as hours and minutes, e.g. "3 h 5 min", or "under a minute". */
function durationOf(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return "under a minute";
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
