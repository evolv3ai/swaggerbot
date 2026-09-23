import { describe, expect, it } from "vitest";
import { crawledNamesCovered } from "./coverage";

/** Plaid's Spec, as checked live on 2026-09-22: one tag, first segments. */
const PLAID = {
  firstSegments: [
    "accounts",
    "auth",
    "credit",
    "identity",
    "investments",
    "liabilities",
    "payment_initiation",
    "transactions",
    "transfer",
    "watchlist_screening",
  ],
  tags: ["plaid"],
};

/** The crawl's product pages: heading and blurb run together. */
const PLAID_NAMES = [
  "The Plaid API",
  "TransferACH, RTP, and FedNow payment processing",
  "BalanceReal-time balance checks",
  "TransactionsUp to 24 months of categorized data",
  "AuthVerified account and routing numbers",
  "LiabilitiesCredit card and mortgage data",
  "IdentityVerify account holder information",
  "InvestmentsHoldings and securities data",
  "Payment InitiationPay by bank in the UK and Europe",
  "Watchlist ScreeningScreen customers against sanctions lists",
];

describe("crawledNamesCovered", () => {
  it("covers a Vendor's product pages with the one Spec they belong to", () => {
    // `the` is left of The Plaid API; balance is under /accounts/balance.
    expect(crawledNamesCovered(PLAID_NAMES, PLAID, "plaid")).toEqual({
      matched: 8,
      counted: 10,
      covered: true,
    });
  });

  it("does not cover separate APIs with one of their Specs", () => {
    const marketing = {
      firstSegments: ["account-exports", "campaigns", "ecommerce", "lists"],
      tags: ["campaigns", "lists", "ping", "reports"],
    };
    const names = [
      "Mailchimp Marketing API",
      "Mailchimp Transactional",
      "Mailchimp Open Commerce",
      "API Reference",
    ];

    expect(crawledNamesCovered(names, marketing, "mailchimp")).toEqual({
      matched: 0,
      counted: 4,
      covered: false,
    });
  });

  it("does not count a name left with no tokens once the Vendor's label and api are dropped", () => {
    const names = ["Plaid API", "APIs", "Plaid", "Auth", "Balance"];

    expect(crawledNamesCovered(names, PLAID, "plaid")).toEqual({
      matched: 1,
      counted: 2,
      covered: false,
    });
    expect(crawledNamesCovered(["Plaid API", "APIs"], PLAID, "plaid")).toEqual({
      matched: 0,
      counted: 0,
      covered: false,
    });
  });

  it("matches a prefix only of 4 characters or more", () => {
    const spec = { firstSegments: ["ach", "auth"], tags: [] };

    expect(
      crawledNamesCovered(["ACHpayments", "AuthVerified"], spec, "payco"),
    ).toEqual({ matched: 1, counted: 2, covered: false });
    // An equal token matches whatever its length.
    expect(crawledNamesCovered(["ACH payments"], spec, "payco")).toMatchObject({
      matched: 1,
    });
  });

  it("matches tag tokens as well as segment tokens", () => {
    const spec = { firstSegments: ["v1"], tags: ["Bank Transfers"] };

    expect(
      crawledNamesCovered(["Bank feeds", "TransfersInstant"], spec, "payco"),
    ).toEqual({ matched: 2, counted: 2, covered: true });
  });
});
