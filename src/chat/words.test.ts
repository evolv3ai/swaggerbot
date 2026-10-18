import { describe, expect, it } from "vitest";
import { stemOf, tokensOf, wordsOf } from "./words";

describe("tokensOf", () => {
  it("lowercases and splits on anything but letters and digits", () => {
    expect(tokensOf("GET /v1/payment_intents/{intent}?")).toEqual([
      "get",
      "v1",
      "payment",
      "intents",
      "intent",
    ]);
  });

  it("splits camelCase identifiers", () => {
    expect(tokensOf("PostCustomers")).toEqual(["post", "customers"]);
    expect(tokensOf("PaymentIntent")).toEqual(["payment", "intent"]);
    expect(tokensOf("HTTPRequestId")).toEqual(["http", "request", "id"]);
  });
});

describe("wordsOf", () => {
  it("drops stop words, single characters and repeats", () => {
    expect(wordsOf("How do I create a customer, a Customer?")).toEqual([
      "create",
      "customer",
    ]);
    expect(wordsOf("What is x in the API?")).toEqual([]);
  });

  it("keeps words of two characters", () => {
    expect(wordsOf("Where is the id?")).toEqual(["id"]);
  });
});

describe("stemOf", () => {
  it("meets the singular and the plural", () => {
    expect(stemOf("customers")).toBe("customer");
    expect(stemOf("addresses")).toBe("address");
    expect(stemOf("policies")).toBe("policy");
    expect(stemOf("boxes")).toBe("box");
    expect(stemOf("address")).toBe("address");
    expect(stemOf("status")).toBe("status");
    expect(stemOf("customer")).toBe("customer");
  });
});
