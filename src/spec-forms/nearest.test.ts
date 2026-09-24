import { describe, expect, it } from "vitest";
import { nearestNames, nearestOperations } from "./nearest";

const operations = [
  { method: "get", path: "/v1/account" },
  { method: "post", path: "/v1/account" },
  { method: "get", path: "/v1/customers" },
  { method: "post", path: "/v1/customers" },
  { method: "get", path: "/v1/customers/search" },
  { method: "get", path: "/v1/customers/{customer}" },
  { method: "post", path: "/v1/customers/{customer}" },
  { method: "delete", path: "/v1/customers/{customer}" },
  { method: "get", path: "/v1/customers/{customer}/sources/{id}" },
];
const listed = (method: string, path: string, limit?: number) =>
  nearestOperations(operations, method, path, limit).map(
    (o) => `${o.method} ${o.path}`,
  );

describe("nearestOperations", () => {
  it("puts a template first for a path with its parameter filled in", () => {
    expect(listed("get", "/v1/customers/cus_123", 2)).toEqual([
      "get /v1/customers/{customer}",
      "post /v1/customers/{customer}",
    ]);
    expect(listed("delete", "/v1/customers/cus_123", 1)).toEqual([
      "delete /v1/customers/{customer}",
    ]);
  });

  it("finds a path with a typo, ignoring case, a query and a trailing slash", () => {
    expect(listed("get", "/v1/Custmers/{customer}/?expand=x", 1)).toEqual([
      "get /v1/customers/{customer}",
    ]);
  });

  it("puts the asked path under another method before another path", () => {
    expect(listed("delete", "/v1/account", 2)).toEqual([
      "get /v1/account",
      "post /v1/account",
    ]);
  });

  it("gives at most 5", () => {
    expect(listed("get", "/nothing/like/it")).toHaveLength(5);
  });
});

describe("nearestNames", () => {
  it("puts names containing the asked one first, then spelling", () => {
    expect(
      nearestNames(
        ["account", "customer", "customer_balance", "coupon", "charge"],
        "Customer",
        2,
      ),
    ).toEqual(["customer", "customer_balance"]);
    expect(nearestNames(["account", "coupon"], "acount", 1)).toEqual([
      "account",
    ]);
  });
});
