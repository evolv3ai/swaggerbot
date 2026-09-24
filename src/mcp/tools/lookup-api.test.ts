import { describe, expect, it } from "vitest";
import { outcomeText } from "./lookup-api";

const api = { id: "payco.com/payco-api", vendorId: "payco.com", name: "PayCo" };
const vendor = { id: "payco.com", name: "PayCo Inc", domain: "payco.com" };

describe("outcomeText", () => {
  it("lists an Ambiguous Outcome's candidate names to retry with", () => {
    const text = outcomeText(
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

    expect(text).toBe(
      'Ambiguous: "Jira" could mean several APIs. Next: lookup_api again with one of these names: "Jira Cloud Platform" (Atlassian), "Jira Software".',
    );
  });

  it("offers allowCommunity when a No Spec Outcome has a Community Spec", () => {
    const text = outcomeText(
      { name: "PayCo" },
      { outcome: "NoSpec", api, vendor, communityAvailable: true },
    );

    expect(text).toMatch(/^No Spec: PayCo by PayCo Inc/);
    expect(text).toContain('lookup_api(name: "PayCo", allowCommunity: true)');
  });

  it("says what an Unknown name could try instead", () => {
    expect(
      outcomeText({ name: "nope" }, { outcome: "Unknown", name: "nope" }),
    ).toMatch(/^Unknown: no API called "nope" was found\./);
  });
});
