import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  answerVendorApis,
  type VendorApi,
  VendorApis,
  type VendorApisAnswer,
} from "~/server/vendor-apis";
import { type Guidance, toolResult, withGuidance } from "../result";
import type { McpTool } from "../server";
import { downloadsText } from "./lookup-api";

const DESCRIPTION = `List the APIs a Vendor (the company behind them, e.g. "Stripe", "Atlassian", "stripe.com") has in swagger.bot's Index, each with its Current Spec's id, Provenance (Official, Endorsed or Mirror) and download URLs.

\`vendor\` may be the Vendor's id or domain ("stripe.com"), its name ("Stripe"), or the name of one of its APIs ("Jira"). Only APIs already in the Index are listed: to find an API that isn't, call lookup_api with its name. No API key needed.

The Spec itself is never returned inline: each API gives its download URLs. The result starts with summary (the APIs, one line each) and next (the calls to make next).

Next: get_spec_outline(apiId) for the API you need, to find its operations.`;

/** `list_vendor_apis`'s input: the Vendor, however the Caller names it. */
export const ListVendorApisInput = z.object({
  vendor: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'The Vendor\'s id or domain ("stripe.com"), its name ("Stripe"), or the name of one of its APIs ("Jira").',
    ),
});

/** `list_vendor_apis`'s answer: the Vendor and its APIs, after `summary` and `next`. */
export const ListVendorApisOutput = withGuidance(VendorApis);

/**
 * `list_vendor_apis`: the Vendor's APIs under the same rules as
 * `GET /api/vendors/{vendor}/apis` (`answerVendorApis`), from the Index
 * alone. Several Vendors, or none, is a tool error saying what to call.
 */
export const registerListVendorApis: McpTool = (server, { getApp }) => {
  server.registerTool(
    "list_vendor_apis",
    {
      title: "List a Vendor's APIs",
      description: DESCRIPTION,
      inputSchema: ListVendorApisInput,
      outputSchema: ListVendorApisOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ vendor }) => vendorApisResult(answerVendorApis(vendor, getApp())),
  );
};

/** The listing's answer as a tool result: the Vendor and its APIs, or an error. */
export function vendorApisResult(answer: VendorApisAnswer): CallToolResult {
  switch (answer.status) {
    case 200:
      return toolResult({
        ...vendorApisGuidance(answer.body),
        data: answer.body,
      });
    case 300: {
      const vendors = answer.body.vendors
        .map(({ id, name }) => (id === name ? `"${id}"` : `"${id}" (${name})`))
        .join(", ");
      return errorOf(
        `Several Vendors match: ${vendors}. Next: list_vendor_apis again with one of these ids as vendor.`,
      );
    }
    case 404:
      return errorOf(
        `${answer.body.error} Only APIs already in the Index are listed. Next: lookup_api(name) with the name of the API you want, which finds it and adds it, with its Vendor, to the Index.`,
      );
  }
}

/** One line for the Vendor and one per API, and the call to make next. */
export function vendorApisGuidance({ vendor, apis }: VendorApis): Guidance {
  const head = `${vendor.name}${vendor.name === vendor.id ? "" : ` (${vendor.id})`} has ${apis.length} API${apis.length === 1 ? "" : "s"} in the Index${apis.length > 0 ? ":" : "."}`;
  const next = apis.find((a) => a.currentSpec) ?? apis[0];
  return {
    summary: [head, ...apis.map(apiLine)].join("\n"),
    next: next
      ? [`get_spec_outline(apiId: "${next.api.id}")`]
      : ["lookup_api(name)"],
  };
}

function apiLine({ api, currentSpec: spec, provenance }: VendorApi): string {
  if (!spec)
    return `- ${api.name}, apiId "${api.id}": no confirmed Spec in the Index yet.`;
  const version = spec.apiVersion ? `, API Version ${spec.apiVersion}` : "";
  return `- ${api.name}, apiId "${api.id}": Current Spec ${spec.id}${version}, ${provenance} Provenance. ${downloadsText(spec)}`;
}

function errorOf(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}
