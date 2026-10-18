import { createAnthropicModel } from "~/chat/anthropic";
import { chatConfigOf } from "~/chat/prompt";
import { createChatStore } from "~/index-store/chat";
import { defaultDailyQuota } from "~/index-store/keys";
import { createApp } from "~/lookup/app";
import { type Gate, rateLimited } from "~/lookup/http";
import {
  clientIpHeader,
  createRateLimiter,
  rateLimitPerMinute,
} from "~/lookup/rate-limit";
import { normalizedCache } from "~/spec-forms/operation-http";
import { currentUser } from "./auth";
import type { ChatDeps } from "./chat";
import { createChatGate } from "./chat-gate";

export type App = ReturnType<typeof createApp>;

// Built when the server starts (`src/server/open-index.ts`), which also starts
// the background Verification and forms workers, or, if that failed, on the
// first request that needs it. One per server: every route shares its
// database connection and workers. It lives on `globalThis`, not in a module
// variable, because Nitro bundles this module into both the start-up plugin's
// chunk and the routes' chunk, and each copy would otherwise build its own app
// and start a second pair of workers on the same Index.
const APP = Symbol.for("swaggerbot.app");
const store = globalThis as { [APP]?: App };

/** The server's one app, built on the first call. */
export function getApp(): App {
  store[APP] ??= createApp();
  return store[APP];
}

/**
 * The limits every route enforces. One instance (ADR 0002), so the per-IP
 * limit lives in memory, and it is shared: a Caller has
 * `RATE_LIMIT_PER_MINUTE` requests a minute across all routes, not per route.
 */
export const gate: Gate = {
  rateLimiter: createRateLimiter({ perMinute: rateLimitPerMinute() }),
  clientIpHeader: clientIpHeader(),
  dailyQuota: defaultDailyQuota(),
};

/**
 * Runs an open GET route (no API key, no quota): 429 with `retry-after`
 * when the client IP is over the shared per-IP limit, else `handler`'s
 * response.
 */
export async function openGet(
  request: Request,
  handler: () => Response | Promise<Response>,
): Promise<Response> {
  return rateLimited(request, gate) ?? handler();
}

/** Ask this Spec's model, meter and turn log, when the feature is on. */
export type Chat = NonNullable<ChatDeps["chat"]>;

const CHAT = Symbol.for("swaggerbot.chat");
const chatStore = globalThis as { [CHAT]?: { chat: Chat | undefined } };

/**
 * The server's one chat, built on the first call from `getApp().db` and
 * `chatConfigOf(process.env)`; `undefined` while the feature is off (no
 * `ANTHROPIC_API_KEY`). On `globalThis` for the reason `getApp` is.
 */
export function getChat(): Chat | undefined {
  chatStore[CHAT] ??= { chat: buildChat() };
  return chatStore[CHAT].chat;
}

function buildChat(): Chat | undefined {
  const config = chatConfigOf(process.env);
  if (!config) return undefined;
  const store = createChatStore(getApp().db, { logText: config.logText });
  return {
    config,
    model: createAnthropicModel(config),
    store,
    gate: createChatGate({ store, limit: config.dailyTurns }),
  };
}

/** What `handleAsk` needs, from the server's one app and chat. */
export function chatDeps(): ChatDeps {
  const { db, lookup } = getApp();
  return {
    db,
    lookup,
    cache: normalizedCache,
    rateGate: gate,
    currentUser,
    chat: getChat(),
  };
}
