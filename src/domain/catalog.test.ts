import { describe, expect, it } from "vitest";
import { Api, apiId, Spec, Vendor, vendorIdFromDomain } from "./catalog";

describe("ids", () => {
  it("derives a Vendor id from its main domain", () => {
    expect(vendorIdFromDomain("stripe.com")).toBe("stripe.com");
    expect(vendorIdFromDomain("https://www.Stripe.com/docs")).toBe(
      "stripe.com",
    );
  });

  it("derives an API id from the Vendor id and API name", () => {
    expect(apiId("stripe.com", "Stripe API")).toBe("stripe.com/stripe-api");
    expect(apiId("atlassian.com", "Jira Cloud Platform (REST)")).toBe(
      "atlassian.com/jira-cloud-platform-rest",
    );
  });

  it("accepts well-formed ids and rejects others", () => {
    expect(
      Vendor.safeParse({
        id: "stripe.com",
        name: "Stripe",
        domain: "stripe.com",
      }).success,
    ).toBe(true);
    expect(
      Vendor.safeParse({ id: "Stripe", name: "Stripe", domain: "stripe.com" })
        .success,
    ).toBe(false);
    expect(
      Api.safeParse({
        id: "stripe.com/Stripe API",
        vendorId: "stripe.com",
        name: "Stripe API",
      }).success,
    ).toBe(false);
  });

  it("accepts the three Spec version families", () => {
    const spec = {
      id: "a".repeat(64),
      apiId: "stripe.com/stripe-api",
      apiVersion: null,
      isPreview: false,
      supersededAt: null,
      format: "yaml",
      byteLength: 10,
    };
    for (const specVersion of ["2.0", "3.0.3", "3.1.0"])
      expect(Spec.safeParse({ ...spec, specVersion }).success).toBe(true);
    for (const specVersion of ["1.2", "3.2.0", "3.0"])
      expect(Spec.safeParse({ ...spec, specVersion }).success).toBe(false);
  });
});
