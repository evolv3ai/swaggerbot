import type { SpecOutline } from "~/domain/spec-forms";

/**
 * A generated Spec Outline the size of Cloudflare's or larger: `operations`
 * operations spread over `tags` tags (tag `i % tags` gets operation `i`),
 * with summaries and ids as long as real ones.
 */
export function generatedOutline(
  operations: number,
  tags: number,
): SpecOutline {
  const tagName = (i: number) => `zone-settings-and-resources-${i}`;
  return {
    title: "Generated API",
    apiVersion: "4.0.0",
    servers: ["https://api.example.com/client/v4"],
    securitySchemes: [
      { name: "api_token", type: "http", scheme: "bearer" },
      { name: "api_key", type: "apiKey", in: "header" },
    ],
    tags: Array.from({ length: tags }, (_, i) => ({
      name: tagName(i),
      operationCount:
        Math.floor(operations / tags) + (i < operations % tags ? 1 : 0),
    })),
    operations: Array.from({ length: operations }, (_, i) => ({
      method: i % 2 ? "post" : "get",
      path: `/accounts/{account_id}/resources-${i}/{resource_id}/settings`,
      operationId: `resources-${i}-update-the-settings-of-a-resource`,
      summary: `Update the settings of resource ${i} for an account, including its zone and its DNS records`,
      tags: [tagName(i % tags)],
    })),
  };
}
