import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_DAILY_TURNS } from "~/chat/prompt";
import { ChatBenchmark } from "./chat-benchmark";

async function load(): Promise<unknown> {
  const path = new URL("../../benchmark/chat.json", import.meta.url);
  return JSON.parse(await readFile(path, "utf8"));
}

describe("benchmark/chat.json", () => {
  it("validates against its schema", async () => {
    expect(ChatBenchmark.safeParse(await load()).error).toBeUndefined();
  });

  it("asks about Val Town, Stripe and the GitHub REST API, 10 questions each, every class in each", async () => {
    const benchmark = ChatBenchmark.parse(await load());
    expect(benchmark.map((s) => s.name)).toEqual([
      "Val Town",
      "Stripe",
      "GitHub REST API",
    ]);
    for (const spec of benchmark) {
      expect(spec.questions.length, spec.name).toBe(10);
      expect(new Set(spec.questions.map((q) => q.class)), spec.name).toEqual(
        new Set(["answerable", "not-in-spec", "off-topic", "action"]),
      );
    }
  });

  it("fits in one person's questions for a day, so one chatcheck run can finish", async () => {
    const benchmark = ChatBenchmark.parse(await load());
    const total = benchmark.reduce((n, s) => n + s.questions.length, 0);
    expect(total).toBeLessThanOrEqual(DEFAULT_CHAT_DAILY_TURNS);
  });

  it("refuses expectations on a question that isn't answerable, and a question asked twice", () => {
    const op = { method: "GET", path: "/v1/balance" };
    expect(
      ChatBenchmark.safeParse([
        {
          name: "Stripe",
          questions: [
            {
              question: "Hi?",
              class: "off-topic",
              expect: { operations: [op] },
            },
          ],
        },
      ]).success,
    ).toBe(false);
    const q = {
      question: "Balance?",
      class: "answerable",
      expect: { operations: [op] },
    };
    expect(
      ChatBenchmark.safeParse([{ name: "Stripe", questions: [q, q] }]).success,
    ).toBe(false);
    expect(
      ChatBenchmark.safeParse([{ name: "Stripe", questions: [q] }]).success,
    ).toBe(true);
    // Methods are written as the Spec viewer shows them: upper case.
    expect(
      ChatBenchmark.safeParse([
        {
          name: "Stripe",
          questions: [
            {
              question: "Balance?",
              class: "answerable",
              expect: { operations: [{ method: "get", path: "/v1/balance" }] },
            },
          ],
        },
      ]).success,
    ).toBe(false);
  });
});
