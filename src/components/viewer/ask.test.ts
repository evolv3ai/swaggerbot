import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AskView } from "~/server/ask-view";
import { AskThisSpec, Conversation } from "./ask";
import type { AskTurn } from "./ask-stream";

const SPEC_ID = "c".repeat(64);
const API_ID = "stripe.com/stripe-api";
const never = () => new Promise<never>(() => {});

const view = (ask: AskView) =>
  renderToStaticMarkup(
    createElement(AskThisSpec, {
      ask,
      apiId: API_ID,
      specId: SPEC_ID,
      headingClassName: "h2",
      start: never,
    }),
  );

const conversation = (turns: AskTurn[], used = 3) =>
  renderToStaticMarkup(
    createElement(Conversation, {
      apiId: API_ID,
      specId: SPEC_ID,
      meter: { used, limit: 30 },
      suggestions: [],
      start: never,
      initialTurns: turns,
    }),
  );

const READY: AskView = {
  state: "ready",
  meter: { used: 3, limit: 30 },
  suggestions: [
    "How do I authenticate?",
    "List the Customers operations",
    "What does customer look like?",
  ],
};

describe("AskThisSpec", () => {
  it("off: not rendered at all", () => {
    expect(view({ state: "off" })).toBe("");
  });

  it("signed out: what it does, and sign-in back to #ask", () => {
    const html = view({ state: "signed-out" });
    expect(html).toContain('<h2 id="ask" class="h2">Ask this Spec</h2>');
    expect(html).toContain(
      "Ask a question about this Spec; answers cite the operations and schemas they come from.",
    );
    expect(html).toMatch(
      new RegExp(
        `href="/auth/sign-in\\?returnTo=%2Fspecs%2F${SPEC_ID}%23ask"[^>]*>Sign in to ask</a>`,
      ),
    );
    expect(html).not.toContain("<textarea");
  });

  it("pending and failed forms: why it can't be used yet, matching the frame notes", () => {
    expect(view({ state: "pending" })).toContain(
      "Ask this Spec is ready once the Normalized Form is built.",
    );
    expect(view({ state: "failed" })).toContain(
      "Ask this Spec can&#x27;t be used: the Normalized Form couldn&#x27;t be built.",
    );
    expect(view({ state: "pending" })).toContain('role="status"');
  });

  it("ready: a labelled field, three suggestions, Ask as the one primary button, and the meter", () => {
    const html = view(READY);
    const field = html.match(/<textarea[^>]*>/)?.[0] ?? "";
    const id = field.match(/ id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}">Your question</label>`);
    expect(field).toContain('rows="3"');
    expect(field).toContain('maxLength="2000"');
    for (const s of READY.suggestions) expect(html).toContain(`>${s}</button>`);
    expect(html).toContain("3 of 30 questions today");
    const primaries = html.match(/bg-sb-accent text-sb-text-on-accent/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(html).toMatch(/<button type="submit"[^>]*>Ask<\/button>/);
  });

  it("without script: the form is disabled, and says it needs script", () => {
    const html = view(READY);
    expect(html.match(/<textarea[^>]*>/)?.[0]).toContain("disabled");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Ask</);
    expect(html).toContain("<noscript><p");
    expect(html).toContain("Asking needs script");
  });

  it("with the day's questions used: says when the count resets", () => {
    const html = view({ ...READY, meter: { used: 30, limit: 30 } });
    expect(html).toContain("30 of 30 questions today");
    expect(html).toContain("the count resets at 00:00 UTC");
  });

  it("renders a Spec string with <script> in it as text", () => {
    const html = view({
      ...READY,
      suggestions: ["What does <script>alert(1)</script> look like?"],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("Conversation", () => {
  const answered: AskTurn = {
    question: "How do I create a customer?",
    answer:
      "Send POST /v1/customers with the customer's details.\nSee https://evil.example/x for more.",
    citations: [
      { kind: "operation", method: "post", path: "/v1/customers", cited: "" },
      { kind: "schema", name: "customer", cited: "" },
      { kind: "operation", method: "post", path: "/v1/customers", cited: "" },
    ],
    status: "answered",
  };

  it("answered: the question echoed, the answer as plain text, the chips in order, then Ask another", () => {
    const html = conversation([answered]);
    expect(html).toContain("How do I create a customer?");
    expect(html).toContain(
      "Send POST /v1/customers with the customer&#x27;s details.\nSee https://evil.example/x for more.",
    );
    // A URL in an answer is text: the only links are the chips.
    expect(html).not.toContain('href="https://evil.example');
    const links = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(links).toEqual([
      [
        `/api/apis/${API_ID}/operation?specId=${SPEC_ID}&amp;method=post&amp;path=%2Fv1%2Fcustomers`,
        "POST /v1/customers",
      ],
      [
        `/api/apis/${API_ID}/schema?specId=${SPEC_ID}&amp;name=customer`,
        "customer",
      ],
    ]);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toMatch(/<button[^>]*>Ask another<\/button>/);
    expect(html).not.toContain(">Stop</button>");
    expect(html).not.toContain("<textarea");
    expect(html).toContain('aria-live="polite"');
  });

  it("streaming: the answer so far, and Stop", () => {
    const html = conversation([
      { ...answered, answer: "Send POST", citations: [], status: "streaming" },
    ]);
    expect(html).toContain("Send POST");
    expect(html).toMatch(/<button[^>]*>Stop<\/button>/);
    expect(html).not.toContain("Ask another");
  });

  it("declined, failed or over quota: one neutral line in the answer's place, with the server's words", () => {
    const declined = conversation([
      {
        question: "Call the API for me",
        answer: "partial",
        citations: [{ kind: "schema", name: "customer", cited: "" }],
        status: "declined",
        message: "I can't answer that one.",
      },
    ]);
    expect(declined).toContain("I can&#x27;t answer that one.");
    expect(declined).not.toContain("partial");
    expect(declined).not.toContain("<a ");

    const quota =
      "You've asked 30 questions today; the count resets at 00:00 UTC, in 5 h.";
    const failed = conversation([
      {
        question: "One more?",
        answer: "",
        citations: [],
        status: "failed",
        message: quota,
      },
    ]);
    expect(failed).toContain("You&#x27;ve asked 30 questions today");
  });

  it("stopped: what came, and that it was stopped", () => {
    const html = conversation([
      { ...answered, answer: "Send", citations: [], status: "stopped" },
    ]);
    expect(html).toContain(">Send<");
    expect(html).toContain("Stopped.");
  });

  it("renders a question, an answer and a cited name with <script> as text", () => {
    const html = conversation([
      {
        question: "<script>q()</script>",
        answer: "<script>a()</script>",
        citations: [
          { kind: "schema", name: "<script>s()</script>", cited: "" },
        ],
        status: "answered",
      },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;q()&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;a()&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;s()&lt;/script&gt;");
  });
});
