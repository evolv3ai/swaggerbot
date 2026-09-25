import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { LookupAnswer } from "~/lookup/http";
import { lookupResult, outcomeGuidance } from "./lookup-api";

const api = { id: "payco.com/payco-api", vendorId: "payco.com", name: "PayCo" };
const vendor = { id: "payco.com", name: "PayCo Inc", domain: "payco.com" };

describe("outcomeGuidance", () => {
  it("lists an Ambiguous Outcome's candidate names to retry with", () => {
    const guidance = outcomeGuidance(
      { name: "Jira" },
      {
        outcome: "Ambiguous",
        candidates: [
          {
            name: "Jira Cloud Platform",
            vendor: "Atlassian",
            probability: 0.6,
          },
          { name: "Jira Software", probability: 0.3 },
        ],
      },
    );

    expect(guidance).toEqual({
      summary:
        'Ambiguous: "Jira" could mean several APIs: "Jira Cloud Platform" (Atlassian), "Jira Software".',
      next: [
        'lookup_api(name: "Jira Cloud Platform")',
        'lookup_api(name: "Jira Software")',
      ],
    });
  });

  it("offers allowCommunity when a No Spec Outcome has a Community Spec", () => {
    const { summary, next } = outcomeGuidance(
      { name: "PayCo" },
      { outcome: "NoSpec", api, vendor, communityAvailable: true },
    );

    expect(summary).toMatch(/^No Spec: PayCo by PayCo Inc/);
    expect(next).toEqual(['lookup_api(name: "PayCo", allowCommunity: true)']);
  });

  it("escapes a candidate name that holds a quote in the call to retry with", () => {
    const { next } = outcomeGuidance(
      { name: "Acme" },
      {
        outcome: "Ambiguous",
        candidates: [{ name: 'Acme "Classic" API', probability: 0.5 }],
      },
    );

    expect(next).toEqual(['lookup_api(name: "Acme \\"Classic\\" API")']);
  });

  it("says what an Unknown name could try instead", () => {
    const { summary, next } = outcomeGuidance(
      { name: "nope" },
      { outcome: "Unknown", name: "nope" },
    );

    expect(summary).toMatch(/^Unknown: no API called "nope" was found\./);
    expect(next).toEqual([]);
  });
});

describe("lookupResult", () => {
  const refused: LookupAnswer = {
    status: 401,
    body: { error: "Discovery needs an API key." },
    headers: {},
  };
  const textOf = (result: CallToolResult) =>
    result.content.map((c) => (c.type === "text" ? c.text : "")).join("");

  it("says a name isn't in the Index when its Discovery needs a key", () => {
    const result = lookupResult({ name: "PayCo" }, refused, new Date());

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('"PayCo" isn\'t in the Index yet');
  });

  it("says a fresh Lookup needs a key, not that the name is missing", () => {
    const result = lookupResult(
      { name: "Stripe", fresh: true },
      refused,
      new Date(),
    );

    expect(textOf(result)).toContain("A fresh Lookup runs Discovery");
    expect(textOf(result)).not.toContain("isn't in the Index");
  });
});
