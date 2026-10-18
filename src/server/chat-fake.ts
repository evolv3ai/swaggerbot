import { ChatBenchmark } from "~/benchmark/chat-benchmark";
import { createBenchmarkModel } from "~/benchmark/chat-fake";
import type { Model } from "~/chat/model";
import chatBenchmark from "../../benchmark/chat.json";
import { type SignedInUser, signInConfigured } from "./auth";

/**
 * `CHAT_FAKE=1`: Ask this Spec on a local server with no model and no
 * sign-in, for running `scripts/chatcheck.ts` against a built server. Turns
 * are answered by the chat Benchmark's scripted model and asked as one
 * stand-in person; the meter and the turn log are the real ones. It is
 * honoured only while the real feature is off (no `ANTHROPIC_API_KEY`) and
 * sign-in is off (no WorkOS), so it can't stand in for a real person or a
 * real model on a deployment.
 */

/** The person every turn is asked as under `CHAT_FAKE=1`. */
export const FAKE_PERSON: SignedInUser = {
  id: "chat-fake",
  email: "chat-fake@localhost",
  name: "CHAT_FAKE",
};

/** The model name logged for its turns. */
export const FAKE_MODEL_NAME = "chat-fake";

/** Whether `CHAT_FAKE=1` is honoured in `env`. */
export function chatFakeOn(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.CHAT_FAKE?.trim() === "1" &&
    !env.ANTHROPIC_API_KEY?.trim() &&
    !signInConfigured(env)
  );
}

/** The scripted model, over `benchmark/chat.json`. */
export function createFakeChatModel(): Model {
  return createBenchmarkModel(ChatBenchmark.parse(chatBenchmark));
}
