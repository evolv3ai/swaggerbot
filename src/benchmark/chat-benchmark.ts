import { z } from "zod";

/**
 * The chat Benchmark (`benchmark/chat.json`, Slice 9 D10): questions about
 * Specs already in the Index, each labelled with what a good answer does.
 * `scripts/chatcheck.ts` asks them on a deployment and scores the answers.
 */

/** What a question is, and so what its answer must do. */
export const ChatQuestionClass = z.enum([
  /** The Spec answers it: the answer cites every expected operation and schema. */
  "answerable",
  /** About this API, but the Spec doesn't say: the answer says so. */
  "not-in-spec",
  /** Not about this Spec at all: the answer declines. */
  "off-topic",
  /** Asks to call the API, fetch a URL or use a credential: the answer declines. */
  "action",
]);
export type ChatQuestionClass = z.infer<typeof ChatQuestionClass>;

/** An operation an answer must cite, as the Spec writes it. */
export const ExpectedOperation = z
  .object({
    method: z.enum([
      "GET",
      "PUT",
      "POST",
      "DELETE",
      "OPTIONS",
      "HEAD",
      "PATCH",
      "TRACE",
    ]),
    path: z.string().startsWith("/"),
  })
  .strict();
export type ExpectedOperation = z.infer<typeof ExpectedOperation>;

export const ChatQuestion = z
  .object({
    question: z.string().trim().min(1).max(2_000),
    class: ChatQuestionClass,
    expect: z
      .object({
        operations: z.array(ExpectedOperation).min(1).optional(),
        schemas: z.array(z.string().min(1)).min(1).optional(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (q) =>
      q.class === "answerable" ||
      (q.expect.operations === undefined && q.expect.schemas === undefined),
    { message: "only an answerable question expects citations" },
  );
export type ChatQuestion = z.infer<typeof ChatQuestion>;

/** One Spec's questions, the Spec found by the name people remember. */
export const ChatBenchmarkSpec = z
  .object({
    name: z.string().trim().min(1),
    questions: z.array(ChatQuestion).min(1),
  })
  .strict()
  .refine(
    (spec) =>
      new Set(spec.questions.map((q) => q.question)).size ===
      spec.questions.length,
    { message: "a Spec's questions are each asked once" },
  );
export type ChatBenchmarkSpec = z.infer<typeof ChatBenchmarkSpec>;

export const ChatBenchmark = z
  .array(ChatBenchmarkSpec)
  .min(1)
  .refine((specs) => new Set(specs.map((s) => s.name)).size === specs.length, {
    message: "each name is listed once",
  });
export type ChatBenchmark = z.infer<typeof ChatBenchmark>;
