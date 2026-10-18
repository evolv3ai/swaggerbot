import { describe, expect, it } from "vitest";
import type { SpecOutline } from "~/domain/spec-forms";
import {
  type AskViewDeps,
  askViewOf,
  schemaNamesOf,
  suggestedQuestions,
} from "./ask-view";

const OUTLINE: SpecOutline = {
  title: "Stripe API",
  apiVersion: "2024-06-20",
  servers: ["https://api.stripe.com"],
  securitySchemes: [{ name: "basicAuth", type: "http", scheme: "basic" }],
  tags: [
    { name: "Charges", operationCount: 4 },
    { name: "Customers", operationCount: 9 },
    { name: "Empty", operationCount: 0 },
  ],
  operations: [],
};

const deps = (over: Partial<AskViewDeps> = {}): AskViewDeps => ({
  chatOn: true,
  signInOn: true,
  user: { id: "user_1", email: "a@example.com" },
  normalized: "ready",
  meter: () => ({ used: 3, limit: 30, resetsAt: "2026-10-19T00:00:00.000Z" }),
  outline: () => OUTLINE,
  schemaNames: async () => ["account", "customer"],
  ...over,
});

describe("askViewOf", () => {
  it("is off without the model or without sign-in", async () => {
    expect(await askViewOf(deps({ chatOn: false }))).toEqual({ state: "off" });
    expect(await askViewOf(deps({ signInOn: false }))).toEqual({
      state: "off",
    });
  });

  it("is signed-out without a person, whatever the forms", async () => {
    expect(
      await askViewOf(deps({ user: null, normalized: "pending" })),
    ).toEqual({ state: "signed-out" });
  });

  it("follows the Normalized Form while it is pending or failed", async () => {
    expect(await askViewOf(deps({ normalized: "pending" }))).toEqual({
      state: "pending",
    });
    expect(await askViewOf(deps({ normalized: "failed" }))).toEqual({
      state: "failed",
    });
    expect(await askViewOf(deps({ outline: () => undefined }))).toEqual({
      state: "pending",
    });
  });

  it("is ready with the person's meter and the suggestions", async () => {
    const seen: string[] = [];
    expect(
      await askViewOf(
        deps({
          meter: (id) => {
            seen.push(id);
            return { used: 3, limit: 30, resetsAt: "" };
          },
        }),
      ),
    ).toEqual({
      state: "ready",
      meter: { used: 3, limit: 30 },
      suggestions: [
        "How do I authenticate?",
        "List the Customers operations",
        "What does customer look like?",
      ],
    });
    expect(seen).toEqual(["user_1"]);
  });
});

describe("suggestedQuestions", () => {
  it("takes the schema named like the largest tag, else the first", () => {
    expect(suggestedQuestions(OUTLINE, ["account", "charge"])).toContain(
      "What does account look like?",
    );
  });

  it("leaves out what the Spec can't support", () => {
    expect(suggestedQuestions({ securitySchemes: [], tags: [] }, [])).toEqual(
      [],
    );
    expect(
      suggestedQuestions(
        {
          securitySchemes: [],
          tags: [{ name: "x".repeat(41), operationCount: 3 }],
        },
        ["y".repeat(41), "Pet"],
      ),
    ).toEqual(["What does Pet look like?"]);
  });
});

describe("schemaNamesOf", () => {
  it("reads components.schemas' names, in order", () => {
    expect(
      schemaNamesOf({ components: { schemas: { b: {}, a: {} } } }),
    ).toEqual(["b", "a"]);
    expect(schemaNamesOf({})).toEqual([]);
    expect(schemaNamesOf(null)).toEqual([]);
    expect(schemaNamesOf({ components: { schemas: [] } })).toEqual([]);
  });
});
