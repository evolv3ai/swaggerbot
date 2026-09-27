import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  KEY_REQUEST_EMAIL,
  KEY_REQUEST_HREF,
} from "~/components/docs/reference";
import { signInHref } from "~/components/shell/account";
import { H2, LEAD, PAGE, PageTitle } from "~/components/shell/page";
import { Button, buttonClass } from "~/components/ui/button";
import { CodeBlock } from "~/components/ui/code-block";
import { dayOf } from "~/lib/dates";
import { cn } from "~/lib/utils";
import type {
  KeyIssued,
  KeyRefusal,
  KeyRevoked,
  KeysPage,
  KeyView,
} from "~/server/keys-page";

/** What the page asks of the server: the signed-in person's own key, never an id. */
export type KeyActions = {
  create: () => Promise<KeyIssued | KeyRefusal>;
  roll: () => Promise<KeyIssued | KeyRefusal>;
  revoke: () => Promise<KeyRevoked | KeyRefusal>;
};

const PROSE = "max-w-[40em] leading-relaxed text-sb-text";
const NOTE = "max-w-[40em] text-sm leading-relaxed text-sb-text-muted";
/** A content card: 12px, a 1px edge. */
const CONTENT_CARD =
  "rounded-[12px] border border-sb-border bg-sb-surface text-sb-text";

/** Inline code in running text: mono on a sunken chip. */
function Code({ children }: { children: string }) {
  return (
    <code className="rounded-[4px] border border-sb-border bg-sb-surface-sunken px-[0.3em] py-px font-mono text-[0.86em] whitespace-nowrap text-sb-text">
      {children}
    </code>
  );
}

/**
 * When a key's credits are next refilled, as the visitor would say it:
 * "resets at midnight UTC, in 5 h" (in minutes under the hour).
 */
export function resetWords(resetsAt: string, asOf: string): string {
  const ms = Date.parse(resetsAt) - Date.parse(asOf);
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const until =
    minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
  return `resets at midnight UTC, in ${until}`;
}

/** Today's credits: "97 of 100 left today". */
export function creditWords(key: Pick<KeyView, "remaining" | "limit">) {
  if (key.remaining === undefined) return undefined;
  return key.limit === undefined
    ? `${key.remaining} left today`
    : `${key.remaining} of ${key.limit} left today`;
}

/** The two lines to use a key with, the key filled in. */
export function usageOf(secret: string, baseUrl: string) {
  return {
    curl: `curl -X POST ${baseUrl}/api/lookup -H "Authorization: Bearer ${secret}" -H "Content-Type: application/json" -d '{"name":"Val Town","fresh":true}'`,
    mcp: `claude mcp add --transport http swaggerbot ${baseUrl}/mcp --header "Authorization: Bearer ${secret}"`,
  };
}

/**
 * `/keys`: get, see, roll and revoke your API key (D6: one per person,
 * created on request). A new secret lives only in this component's state,
 * from the answer that issued it until the visitor hides it or leaves.
 */
export function KeysView({
  page,
  actions,
}: {
  page: KeysPage;
  actions: KeyActions;
}) {
  const [key, setKey] = useState<KeyView | null>(
    page.state === "key" ? page.key : null,
  );
  const [secret, setSecret] = useState<{
    value: string;
    rolled: boolean;
  } | null>(null);
  const [message, setMessage] = useState<{
    tone: "error" | "done";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  if (page.state === "by-hand") return <ByHand quota={page.quota} />;
  if (page.state === "signed-out") return <SignedOut quota={page.quota} />;
  if (page.state === "unavailable") return <Unavailable />;
  const { baseUrl, quota } = page;

  async function run<T extends { ok: true }>(
    action: () => Promise<T | KeyRefusal>,
    done: (result: T) => void,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result.ok) done(result);
      else setMessage({ tone: "error", text: result.error });
    } catch {
      setMessage({
        tone: "error",
        text: "That didn't reach the server. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const issued = (rolled: boolean) => (result: KeyIssued) => {
    // From here on the page shows the key as the answer names it: a roll
    // in Unkey issues a new id.
    setKey(result.key);
    setSecret({ value: result.secret, rolled });
  };

  return (
    <div className={cn(PAGE, "grid gap-8")}>
      <header>
        <PageTitle>{key ? "Your API key" : "Get an API key"}</PageTitle>
        <p className={LEAD}>
          {key
            ? "One key per person. It runs Discovery and fresh Lookups over HTTP and MCP."
            : "One key per person, issued at once. It runs Discovery and fresh Lookups over HTTP and MCP."}
        </p>
      </header>
      {secret ? (
        <NewSecret
          secret={secret.value}
          rolled={secret.rolled}
          baseUrl={baseUrl}
          onDone={() => setSecret(null)}
        />
      ) : null}
      <p
        role={message?.tone === "error" ? "alert" : "status"}
        className={cn(
          "max-w-[40em] text-sm empty:hidden",
          message?.tone === "error" ? "text-sb-danger-text" : "text-sb-text",
        )}
      >
        {message?.text}
      </p>
      {key ? (
        <YourKey
          keyView={key}
          busy={busy}
          onRoll={() => run(actions.roll, issued(true))}
          onRevoke={() =>
            run(actions.revoke, () => {
              setKey(null);
              setSecret(null);
              setMessage({
                tone: "done",
                text: "Your key is revoked: it no longer works. You can create a new one.",
              });
            })
          }
        />
      ) : (
        <NoKey
          quota={quota}
          busy={busy}
          onCreate={() => run(actions.create, issued(false))}
        />
      )}
    </div>
  );
}

/** Without Unkey or WorkOS: keys are handed out by hand (D9). */
export function ByHand({ quota }: { quota?: number }) {
  return (
    <div className={cn(PAGE, "grid gap-6")}>
      <header>
        <PageTitle>Get an API key</PageTitle>
        <p className={LEAD}>
          Keys are issued by hand on this site. Ask for one by email, and say
          what you'll use it for.
        </p>
      </header>
      <p>
        <a
          href={KEY_REQUEST_HREF}
          className={buttonClass({ variant: "secondary" })}
        >
          Email {KEY_REQUEST_EMAIL}
        </a>
      </p>
      <KeyRules quota={quota} />
    </div>
  );
}

/** What a key unlocks, and the quota. */
function KeyRules({ quota }: { quota?: number }) {
  return (
    <section aria-labelledby="unlocks">
      <h2 id="unlocks" className={cn(H2, "mt-0")}>
        What a key unlocks
      </h2>
      <ul className={cn(PROSE, "grid list-disc gap-2 pl-5")}>
        <li>
          <strong className="font-semibold">Discovery</strong>: a Lookup of a
          name the Index can't answer yet, searched for on the live web.
        </li>
        <li>
          <Code>fresh: true</Code>, to look again rather than take the Index's
          answer.
        </li>
        <li>
          {quota ? `${quota} a day` : "A daily quota"}, counted per UTC day and
          reset at midnight UTC. Past it the answer is a 429 until then.
        </li>
      </ul>
      <p className={cn(NOTE, "mt-4")}>
        Everything the Index answers needs no key: a name it knows, the outline,
        operations, schemas, Vendors and downloads.
      </p>
    </section>
  );
}

export function SignedOut({ quota }: { quota: number }) {
  return (
    <div className={cn(PAGE, "grid gap-8")}>
      <header>
        <PageTitle>Get an API key</PageTitle>
        <p className={LEAD}>
          A key lets your agents and programs run Discovery. Sign in and it is
          issued at once: one per person, no approval.
        </p>
      </header>
      <div className="grid justify-items-start gap-3">
        <a href={signInHref("/keys")} className={buttonClass({ size: "lg" })}>
          Sign in to get a key
        </a>
        <p className={NOTE}>With GitHub or your email.</p>
      </div>
      <KeyRules quota={quota} />
    </div>
  );
}

export function Unavailable() {
  return (
    <div className={cn(PAGE, "grid gap-6")}>
      <header>
        <PageTitle>Your API key</PageTitle>
        <p className={LEAD}>
          Keys can't be reached right now, so your key can't be shown. It still
          works if the service is answering. Try again shortly.
        </p>
      </header>
      <p>
        <a href="/keys" className={buttonClass({ variant: "secondary" })}>
          Try again
        </a>
      </p>
    </div>
  );
}

export function NoKey({
  quota,
  busy,
  onCreate,
}: {
  quota?: number;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <>
      <div className="grid justify-items-start gap-3">
        <Button size="lg" disabled={busy} onClick={onCreate}>
          {busy ? "Creating your key…" : "Create your key"}
        </Button>
        <p className={NOTE}>
          Its secret is shown once, right here. Store it before you leave the
          page.
        </p>
      </div>
      <KeyRules quota={quota} />
    </>
  );
}

/**
 * A secret just issued, shown this once: the one highlighted box on the
 * page, focused when it appears, with the key filled into the `curl` and
 * `claude mcp add` lines.
 */
export function NewSecret({
  secret,
  rolled,
  baseUrl,
  onDone,
}: {
  secret: string;
  rolled: boolean;
  baseUrl: string;
  onDone: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new secret moves focus to it
  useEffect(() => heading.current?.focus(), [secret]);
  const usage = usageOf(secret, baseUrl);
  return (
    <section
      aria-labelledby="new-secret"
      className="grid gap-4 rounded-[12px] border-2 border-sb-accent bg-sb-surface p-4 shadow-[var(--sb-shadow-box)] sm:p-5"
    >
      <div className="grid gap-1.5">
        <h2
          id="new-secret"
          ref={heading}
          tabIndex={-1}
          className="font-display text-xl font-bold tracking-[-0.01em] text-sb-text"
        >
          {rolled ? "Your rolled key" : "Your new key"}
        </h2>
        <p className="font-semibold text-sb-text">
          Store it now: it won't be shown again.
        </p>
        {rolled ? (
          <p className="text-sm text-sb-text-muted">
            The old secret stopped working. Today's credits carried over.
          </p>
        ) : null}
      </div>
      <CodeBlock code={secret} className="rounded-md" />
      <h3 className="font-display text-base font-bold text-sb-text">Use it</h3>
      <div className="grid gap-2">
        <p className="text-sm text-sb-text-muted">
          A Lookup over HTTP (<Code>fresh</Code> spends one credit):
        </p>
        <CodeBlock code={usage.curl} className="rounded-md" />
      </div>
      <div className="grid gap-2">
        <p className="text-sm text-sb-text-muted">Add it to Claude Code:</p>
        <CodeBlock code={usage.mcp} className="rounded-md" />
      </div>
      <p>
        <Button variant="secondary" size="sm" onClick={onDone}>
          I've stored it: hide the key
        </Button>
      </p>
    </section>
  );
}

/**
 * The person's live key: its start, when it was created, today's credits
 * and when they reset, and Roll and Revoke, each asked to be confirmed.
 */
export function YourKey({
  keyView,
  busy,
  onRoll,
  onRevoke,
}: {
  keyView: KeyView;
  busy: boolean;
  onRoll: () => void;
  onRevoke: () => void;
}) {
  const [asking, setAsking] = useState<"roll" | "revoke" | null>(null);
  const question = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);
  const credits = creditWords(keyView);
  const rows: [string, ReactNode][] = [
    [
      "Key",
      <span key="k" className="font-mono text-[13px]">
        {keyView.start}…
      </span>,
    ],
    ["Created", dayOf(keyView.createdAt)],
  ];
  if (credits)
    rows.push([
      "Today",
      <>
        {credits}
        {keyView.resetsAt ? (
          <span className="block text-sm text-sb-text-muted">
            {capitalised(resetWords(keyView.resetsAt, keyView.asOf))}
          </span>
        ) : null}
      </>,
    ]);
  return (
    <section aria-labelledby="your-key" className="grid gap-3">
      <h2 id="your-key" className={cn(H2, "my-0")}>
        Your key
      </h2>
      <div className={CONTENT_CARD}>
        <dl className="grid gap-3 p-4 sm:grid-cols-[8rem_1fr] sm:gap-x-6 sm:p-5">
          {rows.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-sm font-semibold text-sb-text-muted">
                {term}
              </dt>
              <dd className="-mt-2 text-sb-text sm:mt-0">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-sb-border p-4 sm:px-5">
          {asking ? (
            <div className="grid gap-3">
              <p
                ref={question}
                tabIndex={-1}
                className="max-w-[40em] text-sm leading-relaxed text-sb-text"
              >
                {asking === "roll"
                  ? "Roll your key? You get a new secret, shown once, and the old one stops working at once. Today's credits carry over."
                  : "Revoke your key? It stops working at once. You can create a new one after."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const act = asking === "roll" ? onRoll : onRevoke;
                    setAsking(null);
                    act();
                  }}
                >
                  {asking === "roll" ? "Roll the key" : "Revoke the key"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setAsking("roll")}
              >
                Roll…
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setAsking("revoke")}
              >
                Revoke…
              </Button>
            </div>
          )}
        </div>
      </div>
      <p className={NOTE}>
        Roll if the secret may have leaked: you get a new one and keep today's
        credits. Revoke to stop using a key altogether.
      </p>
    </section>
  );
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
