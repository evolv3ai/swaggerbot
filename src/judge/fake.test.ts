import { describe, expect, it } from "vitest";
import type { SpecExtract } from "../domain/spec-extract";
import { FakeJudge } from "./fake";

const stripe = {
  id: "stripe.com/stripe-api",
  name: "Stripe API",
  vendor: "Stripe",
};
const jira = { id: "atlassian.com/jira", name: "Jira", vendor: "Atlassian" };
const extract = (title: string): SpecExtract => ({
  title,
  description: "",
  serverHosts: [],
  tags: [],
  samplePaths: [],
  pathCount: 0,
});

describe("FakeJudge", () => {
  const judge = () =>
    new FakeJudge({
      whichApi: {
        stripe: {
          probabilities: { [stripe.id]: 0.9, none: 0.1 },
          confidence: 0.9,
        },
      },
      isSpecLink: {
        "https://stripe.com/openapi.json": {
          probability: 0.9,
          confidence: 0.9,
        },
      },
      specDescribesApi: {
        "Stripe API": { probability: 0.8, confidence: 0.8 },
      },
    });

  it("returns scripted answers keyed by name, url and title", async () => {
    const j = judge();
    expect(await j.whichApi("stripe", [stripe])).toEqual({
      probabilities: { [stripe.id]: 0.9, none: 0.1 },
      confidence: 0.9,
    });
    expect(
      await j.isSpecLink(stripe, {
        url: "https://stripe.com/openapi.json",
        text: "spec",
      }),
    ).toEqual({ probability: 0.9, confidence: 0.9 });
    expect(await j.specDescribesApi(stripe, extract("Stripe API"))).toEqual({
      probability: 0.8,
      confidence: 0.8,
    });
  });

  it("answers none and no by default", async () => {
    const j = judge();
    expect(await j.whichApi("jira", [stripe, jira])).toEqual({
      probabilities: { none: 1, [stripe.id]: 0, [jira.id]: 0 },
      confidence: 1,
    });
    expect(
      await j.isSpecLink(stripe, { url: "https://other.test", text: "x" }),
    ).toEqual({ probability: 0, confidence: 1 });
    expect(await j.specDescribesApi(stripe, extract("Petstore"))).toEqual({
      probability: 0,
      confidence: 1,
    });
  });

  it("uses scripted defaults for anything not scripted", async () => {
    const maybe = { probability: 0.5, confidence: 0.5 };
    const j = new FakeJudge({
      defaults: {
        whichApi: {
          probabilities: { none: 0.5, [jira.id]: 0.5 },
          confidence: 0.5,
        },
        isSpecLink: maybe,
        specDescribesApi: maybe,
      },
    });
    expect((await j.whichApi("jira", [jira])).confidence).toBe(0.5);
    expect(await j.isSpecLink(jira, { url: "https://x.test", text: "" })).toBe(
      maybe,
    );
    expect(await j.specDescribesApi(jira, extract("Jira"))).toBe(maybe);
  });

  it("answers several links in order and records every call", async () => {
    const j = judge();
    const result = await j.areSpecLinks(stripe, [
      { url: "https://other.test", text: "x" },
      { url: "https://stripe.com/openapi.json", text: "spec" },
    ]);
    expect(result.map((r) => r.probability)).toEqual([0, 0.9]);
    expect(j.calls.map((c) => c.judgment)).toEqual([
      "isSpecLink",
      "isSpecLink",
    ]);
  });

  it("answers vendor API links by url, no by default, and records every call", async () => {
    const j = new FakeJudge({
      isVendorApiLink: {
        "https://mailchimp.com/developer/marketing/": {
          probability: 0.9,
          confidence: 0.9,
        },
      },
    });
    const vendor = { id: "mailchimp.com", name: "Mailchimp" };
    const result = await j.areVendorApiLinks(vendor, [
      { url: "https://mailchimp.com/pricing/", text: "Pricing" },
      {
        url: "https://mailchimp.com/developer/marketing/",
        text: "Marketing API",
      },
    ]);
    expect(result.map((r) => r.probability)).toEqual([0, 0.9]);
    expect(j.calls.map((c) => c.judgment)).toEqual([
      "isVendorApiLink",
      "isVendorApiLink",
    ]);
  });
});
