import { TypeSafeClient } from "@typesafe-ai/sdk";
import { JevJudge } from "./jev";
import type { Judge } from "./judge";

export { FakeJudge } from "./fake";
export { JevJudge } from "./jev";
export * from "./judge";

/** The Jev judge, keyed from `TYPESAFE_API_KEY`. */
export function createJudge(env: NodeJS.ProcessEnv = process.env): Judge {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY is not set: the Judge needs a TypeSafe API key to call Jev.",
    );
  }
  return new JevJudge(new TypeSafeClient({ apiKey, retry: { maxRetries: 0 } }));
}
