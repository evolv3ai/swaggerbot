import {
  type KeyStore,
  type LiveKey,
  nextUtcMidnight,
} from "~/index-store/keys";
import type { Gate } from "~/lookup/http";
import { clientIpOf, type RateLimiter } from "~/lookup/rate-limit";
import type { SignedInUser } from "./auth";

/**
 * `/keys` (Slice 7 #3, D6): one key per signed-in person, created on
 * request, then rolled or revoked. Every call acts on the caller's own live
 * key, found by who is signed in (`liveKeyOf(user.id)`); a key id from the
 * browser is never taken. A secret is in the one answer that issues it and
 * nowhere else: never logged, never stored.
 */

/** Keys created or rolled per person an hour. */
export const KEY_ACTIONS_PER_HOUR = 5;

/** A live key as the page shows it: never its secret. */
export type KeyView = LiveKey & {
  /** When the figures were read, for "resets in 5 h". */
  asOf: string;
};

/** What `/keys` shows, and the status it is served with. */
export type KeysPage =
  /** Unkey or WorkOS isn't configured: keys are issued by hand (D9). */
  | { state: "by-hand"; status: 200; quota: number }
  | { state: "signed-out"; status: 200; quota: number }
  | { state: "no-key"; status: 200; quota: number; baseUrl: string }
  | {
      state: "key";
      status: 200;
      key: KeyView;
      quota: number;
      baseUrl: string;
    }
  /** The key store didn't answer. */
  | { state: "unavailable"; status: 503 };

/** A refusal, in words the page shows as they are. */
export type KeyRefusal = {
  ok: false;
  status: 401 | 404 | 409 | 429 | 503;
  error: string;
  retryAfterSeconds?: number;
};

/** A key issued or rolled: its secret, shown once, and the key as it is now. */
export type KeyIssued = { ok: true; id: string; secret: string; key: KeyView };

export type KeyRevoked = { ok: true };

const OFF: KeyRefusal = {
  ok: false,
  status: 404,
  error: "Keys are issued by hand on this site.",
};
const SIGNED_OUT: KeyRefusal = {
  ok: false,
  status: 401,
  error: "Sign in to manage your key.",
};
const NO_KEY: KeyRefusal = {
  ok: false,
  status: 404,
  error: "You have no live key. Create one.",
};
const HAS_KEY: KeyRefusal = {
  ok: false,
  status: 409,
  error:
    "You already have a live key: one per person. Roll it for a new secret, or revoke it first.",
};
const UNAVAILABLE: KeyRefusal = {
  ok: false,
  status: 503,
  error: "Keys can't be reached right now. Try again shortly.",
};

/** Seconds as the page says them: "40 s", "12 min". */
function waitOf(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

export type KeyPageDeps = {
  keys: KeyStore;
  /** Unkey and WorkOS both configured (D9). */
  configured: boolean;
  /** A new key's daily quota: `DAILY_QUOTA`. */
  quota: number;
  /** Creates and rolls per person (`KEY_ACTIONS_PER_HOUR`). */
  perUser: RateLimiter;
  /** The per-IP limit every route shares. */
  gate: Pick<Gate, "rateLimiter" | "clientIpHeader">;
  now?: () => Date;
  /** Where a store's failure is reported: the error's name, never a secret. */
  warn?: (message: string) => void;
};

/**
 * The key page's reads and actions over `keys`. Actions for one person run
 * one at a time, so two quick clicks on "Create" can't issue two keys.
 */
export function createKeyPage({
  keys,
  configured,
  quota,
  perUser,
  gate,
  now = () => new Date(),
  warn = console.warn,
}: KeyPageDeps) {
  const queues = new Map<string, Promise<unknown>>();

  /** Runs `action` after any earlier action of `userId`'s has settled. */
  function oneAtATime<T>(userId: string, action: () => Promise<T>) {
    const prior = queues.get(userId) ?? Promise.resolve();
    const run = prior.then(action, action);
    const settled = run.catch(() => undefined);
    queues.set(userId, settled);
    void settled.then(() => {
      if (queues.get(userId) === settled) queues.delete(userId);
    });
    return run;
  }

  function viewOf(key: LiveKey): KeyView {
    return { ...key, asOf: now().toISOString() };
  }

  /** The checks every action starts with; a refusal, or who is acting. */
  function admit(
    user: SignedInUser | null,
    request: Request,
  ): KeyRefusal | SignedInUser {
    if (!configured) return OFF;
    if (!user) return SIGNED_OUT;
    const ip = gate.rateLimiter.take(clientIpOf(request, gate.clientIpHeader));
    if (!ip.allowed)
      return {
        ok: false,
        status: 429,
        error: `Too many requests from here. Try again in ${waitOf(ip.retryAfterSeconds)}.`,
        retryAfterSeconds: ip.retryAfterSeconds,
      };
    return user;
  }

  /** A create or roll counted against the person's hourly limit. */
  function takeOne(user: SignedInUser): KeyRefusal | undefined {
    const taken = perUser.take(user.id);
    if (taken.allowed) return undefined;
    return {
      ok: false,
      status: 429,
      error: `You've created or rolled a key ${KEY_ACTIONS_PER_HOUR} times this hour. Try again in ${waitOf(taken.retryAfterSeconds)}.`,
      retryAfterSeconds: taken.retryAfterSeconds,
    };
  }

  function failed(action: string, err: unknown): KeyRefusal {
    const name = err instanceof Error ? err.name : "unknown error";
    warn(`keys page: ${action} failed (${name})`);
    return UNAVAILABLE;
  }

  return {
    /** The page for `user` (null: signed out). */
    async page(user: SignedInUser | null, baseUrl: string): Promise<KeysPage> {
      if (!configured) return { state: "by-hand", status: 200, quota };
      if (!user) return { state: "signed-out", status: 200, quota };
      try {
        const key = await keys.liveKeyOf(user.id);
        return key
          ? { state: "key", status: 200, key: viewOf(key), quota, baseUrl }
          : { state: "no-key", status: 200, quota, baseUrl };
      } catch (err) {
        failed("reading the key", err);
        return { state: "unavailable", status: 503 };
      }
    },

    /** Issues the person's key, unless they have a live one (409). */
    async create(
      user: SignedInUser | null,
      request: Request,
    ): Promise<KeyIssued | KeyRefusal> {
      const who = admit(user, request);
      if ("ok" in who) return who;
      return oneAtATime(who.id, async () => {
        try {
          if (await keys.liveKeyOf(who.id)) return HAS_KEY;
          const limited = takeOne(who);
          if (limited) return limited;
          const { id, secret } = await keys.create(who.id, quota);
          const at = now();
          const key = (await keys.liveKeyOf(who.id)) ?? {
            id,
            start: "sb_",
            createdAt: at.toISOString(),
            remaining: quota,
            limit: quota,
            resetsAt: nextUtcMidnight(at),
          };
          return { ok: true, id, secret, key: viewOf(key) };
        } catch (err) {
          return failed("create", err);
        }
      });
    },

    /**
     * A new secret for the person's live key, its credits kept. The id may
     * change (Unkey's reroll issues a new key): the answer carries it.
     */
    async roll(
      user: SignedInUser | null,
      request: Request,
    ): Promise<KeyIssued | KeyRefusal> {
      const who = admit(user, request);
      if ("ok" in who) return who;
      return oneAtATime(who.id, async () => {
        try {
          const live = await keys.liveKeyOf(who.id);
          if (!live) return NO_KEY;
          const limited = takeOne(who);
          if (limited) return limited;
          const rolled = await keys.roll(live.id);
          if (!rolled) return NO_KEY;
          const current = await keys.liveKeyOf(who.id);
          const key =
            current?.id === rolled.id ? current : { ...live, id: rolled.id };
          return {
            ok: true,
            id: rolled.id,
            secret: rolled.secret,
            key: viewOf(key),
          };
        } catch (err) {
          return failed("roll", err);
        }
      });
    },

    /** Revokes the person's live key; they may create another after. */
    async revoke(
      user: SignedInUser | null,
      request: Request,
    ): Promise<KeyRevoked | KeyRefusal> {
      const who = admit(user, request);
      if ("ok" in who) return who;
      return oneAtATime(who.id, async () => {
        try {
          const live = await keys.liveKeyOf(who.id);
          if (!live) return NO_KEY;
          return (await keys.revoke(live.id)) ? { ok: true } : NO_KEY;
        } catch (err) {
          return failed("revoke", err);
        }
      });
    },
  };
}

export type KeyPage = ReturnType<typeof createKeyPage>;
