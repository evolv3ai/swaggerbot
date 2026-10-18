import { describe, expect, it } from "vitest";
import { chatFakeOn, createFakeChatModel } from "./chat-fake";

const WORKOS = {
  WORKOS_API_KEY: "sk_test",
  WORKOS_CLIENT_ID: "client_test",
  WORKOS_COOKIE_PASSWORD: "x".repeat(32),
  WORKOS_REDIRECT_URI: "http://localhost:3000/auth/callback",
};

describe("chatFakeOn", () => {
  it("is on with CHAT_FAKE=1 alone", () => {
    expect(chatFakeOn({ CHAT_FAKE: "1" })).toBe(true);
    expect(chatFakeOn({ CHAT_FAKE: " 1 " })).toBe(true);
  });

  it("is off without it, or with anything else", () => {
    for (const value of [undefined, "", "0", "true", "yes"])
      expect(chatFakeOn({ CHAT_FAKE: value }), String(value)).toBe(false);
  });

  it("never stands in for the real model or real sign-in", () => {
    expect(chatFakeOn({ CHAT_FAKE: "1", ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(
      false,
    );
    expect(chatFakeOn({ CHAT_FAKE: "1", ...WORKOS })).toBe(false);
  });
});

describe("createFakeChatModel", () => {
  it("answers benchmark/chat.json's questions without a real model", async () => {
    const texts: string[] = [];
    for await (const event of createFakeChatModel().stream({
      system: "",
      documents: [
        { kind: "facts", title: "About this Spec", ref: null, text: "{}" },
      ],
      history: [],
      question: "What uptime does Stripe guarantee?",
      maxTokens: 1500,
    }))
      if (event.type === "text") texts.push(event.text);
    expect(texts.join("")).toBe("The Spec doesn't say.");
  });
});
