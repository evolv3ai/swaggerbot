import { describe, expect, it } from "vitest";
import { distinctDomain } from "./vendor-name";

describe("distinctDomain", () => {
  it("is null when the domain only repeats the name", () => {
    expect(distinctDomain("stripe.com", "stripe.com")).toBeNull();
    expect(distinctDomain("Stripe.com ", "stripe.com")).toBeNull();
  });

  it("is the domain when it differs from the name", () => {
    expect(distinctDomain("Stripe", "stripe.com")).toBe("stripe.com");
  });
});
