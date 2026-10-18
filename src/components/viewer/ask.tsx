import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { signInHref } from "~/components/shell/account";
import { Button, buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Label, Textarea } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import type { AskView } from "~/server/ask-view";
import {
  ASK_FAILED,
  ASK_HISTORY_TURNS,
  ASK_QUESTION_CHARS,
  type AskTurn,
  askBodyOf,
  citationChips,
  startAsk,
} from "./ask-stream";

/**
 * "Ask this Spec" on the Spec viewer (Slice 9 #6, D5): a question about this
 * one Spec, answered from its Normalized Form with the operations and
 * schemas the answer cites. Signed-in people only, metered a day. The
 * conversation lives in this component and is sent back with each question;
 * it is never stored. Every string from the Spec or the model is text: an
 * answer is never read as Markdown or HTML, and a URL in it is not a link.
 * Without script the card renders with its form disabled.
 */
export function AskThisSpec({
  ask,
  apiId,
  specId,
  headingClassName,
  start = startAsk,
}: {
  ask: AskView;
  apiId: string;
  specId: string;
  headingClassName: string;
  /** Sends a question; tests pass their own. */
  start?: typeof startAsk;
}) {
  if (ask.state === "off") return null;
  return (
    <section aria-labelledby="ask">
      <h2 id="ask" className={headingClassName}>
        Ask this Spec
      </h2>
      {ask.state === "signed-out" ? (
        <SignedOut specId={specId} />
      ) : ask.state === "pending" ? (
        <Note>
          Ask this Spec is ready once the Normalized Form is built. Reload the
          page in a minute.
        </Note>
      ) : ask.state === "failed" ? (
        <Note>
          Ask this Spec can't be used: the Normalized Form couldn't be built.
        </Note>
      ) : (
        <Conversation
          apiId={apiId}
          specId={specId}
          meter={ask.meter}
          suggestions={ask.suggestions}
          start={start}
        />
      )}
    </section>
  );
}

const WHAT_IT_DOES =
  "Ask a question about this Spec; answers cite the operations and schemas they come from.";

function SignedOut({ specId }: { specId: string }) {
  return (
    <Card className="grid justify-items-start gap-3.5 px-4 py-5 sm:px-5">
      <p className="max-w-[40em] text-[15px] text-sb-text-muted">
        {WHAT_IT_DOES}
      </p>
      <a
        href={signInHref(`/specs/${specId}#ask`)}
        className={buttonClass({ variant: "secondary" })}
      >
        Sign in to ask
      </a>
    </Card>
  );
}

function Note({ children }: { children: string }) {
  return (
    <Card
      role="status"
      className="px-4 py-5 text-[15px] text-sb-text-muted sm:px-5"
    >
      <p className="max-w-[40em]">{children}</p>
    </Card>
  );
}

/** The Try chips' look (`src/routes/index.tsx`), as buttons. */
const CHIP =
  "inline-block rounded-full border border-sb-border px-2.5 py-[3px] text-sb-text no-underline transition-colors hover:border-sb-accent hover:text-sb-accent-text pointer-coarse:px-3.5 pointer-coarse:py-[11px]";

const MUTED = "text-[13px] text-sb-text-muted";

/** A turn as the panel holds it, with a key for the list. */
type Shown = AskTurn & { id: number };

/** The form, the turns so far, and the person's questions today. */
export function Conversation({
  apiId,
  specId,
  meter,
  suggestions,
  start,
  initialTurns = [],
}: {
  apiId: string;
  specId: string;
  meter: { used: number; limit: number };
  suggestions: string[];
  start: typeof startAsk;
  /** Turns to start with; for tests. */
  initialTurns?: AskTurn[];
}) {
  const id = useId();
  const [live, setLive] = useState(false);
  const nextId = useRef(initialTurns.length);
  const [turns, setTurns] = useState<Shown[]>(() =>
    initialTurns.map((t, i) => ({ ...t, id: i })),
  );
  const [question, setQuestion] = useState("");
  const [composing, setComposing] = useState(initialTurns.length === 0);
  const [used, setUsed] = useState(meter.used);
  const [announcement, setAnnouncement] = useState("");
  const running = useRef<AbortController | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const stop = useRef<HTMLButtonElement>(null);
  const another = useRef<HTMLButtonElement>(null);
  const streaming = turns.at(-1)?.status === "streaming";
  const spent = used >= meter.limit;

  // The form works once script runs; until then it is shown disabled.
  useEffect(() => setLive(true), []);
  useEffect(() => () => running.current?.abort(), []);
  // Focus follows the one control there is: Stop while an answer streams,
  // then Ask another.
  useEffect(() => {
    if (streaming) stop.current?.focus();
    else if (running.current === null && turns.length > 0 && !composing)
      another.current?.focus();
  }, [streaming, turns.length, composing]);

  async function ask(asked: string) {
    const body = askBodyOf(asked, turns);
    if (!body.question || running.current) return;
    const controller = new AbortController();
    running.current = controller;
    const turn: Shown = {
      id: nextId.current++,
      question: body.question,
      answer: "",
      citations: [],
      status: "streaming",
    };
    const commit = () => setTurns((all) => [...all.slice(0, -1), { ...turn }]);
    setTurns((all) => [...all, { ...turn }].slice(-ASK_HISTORY_TURNS));
    setQuestion("");
    setComposing(false);
    setAnnouncement("Answering…");
    const end = (status: AskTurn["status"], message?: string) => {
      if (turn.status !== "streaming") return;
      turn.status = status;
      if (message) turn.message = message;
    };
    try {
      const started = await start(specId, body, controller.signal);
      if (!started.ok) {
        end("failed", started.message);
      } else {
        setUsed((n) => n + 1);
        for await (const event of started.events) {
          if (event.type === "delta") {
            if (turn.answer === "") setAnnouncement(event.text);
            turn.answer += event.text;
          } else if (event.type === "citation")
            turn.citations = [...turn.citations, event.citation];
          else if (event.type === "refusal") end("declined", event.message);
          else if (event.type === "error") end("failed", event.message);
          else end("answered");
          commit();
        }
        end("failed", ASK_FAILED);
      }
    } catch {
      end(controller.signal.aborted ? "stopped" : "failed", ASK_FAILED);
    } finally {
      running.current = null;
      commit();
      setAnnouncement(
        endWords(turn, citationChips(turn.citations, { apiId, specId }).length),
      );
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <Card className="grid gap-5 px-4 py-5 sm:px-5">
      {turns.length === 0 ? (
        <p className="max-w-[40em] text-[15px] text-sb-text-muted">
          {WHAT_IT_DOES}
        </p>
      ) : (
        <ol className="grid gap-6">
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} apiId={apiId} specId={specId} />
          ))}
        </ol>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {composing ? (
        <form
          onSubmit={submit}
          className="grid gap-3"
          aria-label="Ask this Spec"
        >
          <Label htmlFor={`${id}-q`}>Your question</Label>
          <Textarea
            id={`${id}-q`}
            ref={field}
            name="question"
            value={question}
            maxLength={ASK_QUESTION_CHARS}
            disabled={!live || spent}
            placeholder="How do I create a customer?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
              e.preventDefault();
              void ask(question);
            }}
          />
          {turns.length === 0 && suggestions.length > 0 ? (
            <div className={cn("flex flex-wrap items-center gap-2", MUTED)}>
              <span id={`${id}-try`}>Try</span>
              <ul aria-labelledby={`${id}-try`} className="contents">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={!live || spent}
                      className={cn(CHIP, "disabled:opacity-45")}
                      onClick={() => {
                        setQuestion(s);
                        field.current?.focus();
                      }}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" disabled={!live || spent || !question.trim()}>
              Ask
            </Button>
            <Meter used={used} limit={meter.limit} />
          </div>
          <noscript>
            <p className={MUTED}>
              Asking needs script; the rest of this page works without it.
            </p>
          </noscript>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {streaming ? (
            <Button
              ref={stop}
              variant="secondary"
              size="sm"
              onClick={() => running.current?.abort()}
            >
              Stop
            </Button>
          ) : (
            <Button
              ref={another}
              variant="secondary"
              size="sm"
              onClick={() => {
                setComposing(true);
                requestAnimationFrame(() => field.current?.focus());
              }}
            >
              Ask another
            </Button>
          )}
          <Meter used={used} limit={meter.limit} />
        </div>
      )}
    </Card>
  );
}

function Meter({ used, limit }: { used: number; limit: number }) {
  return (
    <p className={MUTED}>
      {Math.min(used, limit)} of {limit} questions today
      {used >= limit ? "; the count resets at 00:00 UTC" : ""}
    </p>
  );
}

/** What the live region says once a turn ends. */
function endWords(turn: AskTurn, cited: number): string {
  switch (turn.status) {
    case "answered":
      return cited === 0
        ? "Answered."
        : `Answered, with ${cited} citation${cited === 1 ? "" : "s"}.`;
    case "stopped":
      return "Stopped.";
    default:
      return turn.message ?? ASK_FAILED;
  }
}

/**
 * One turn: the question echoed, then the answer as plain text (or one
 * neutral line in its place when it was declined or failed), then the chips
 * of what it cited.
 */
export function TurnView({
  turn,
  apiId,
  specId,
}: {
  turn: AskTurn;
  apiId: string;
  specId: string;
}) {
  const chips = citationChips(turn.citations, { apiId, specId });
  const shown = turn.status !== "declined" && turn.status !== "failed";
  return (
    <li className="grid gap-2.5">
      <p className="font-semibold whitespace-pre-wrap text-sb-text [overflow-wrap:anywhere]">
        <span className="sr-only">You asked: </span>
        {turn.question}
      </p>
      {shown ? (
        <p className="max-w-[44em] text-[15px] whitespace-pre-wrap text-sb-text [overflow-wrap:anywhere]">
          {turn.answer}
          {turn.status === "streaming" ? (
            <span aria-hidden="true" className="text-sb-text-faint">
              {turn.answer ? " …" : "Answering…"}
            </span>
          ) : null}
        </p>
      ) : null}
      {turn.status === "stopped" ? <p className={MUTED}>Stopped.</p> : null}
      {!shown ? (
        <p className="text-[15px] text-sb-text-muted">
          {turn.message ?? ASK_FAILED}
        </p>
      ) : null}
      {shown && chips.length > 0 ? (
        <div className={cn("flex flex-wrap items-center gap-2", MUTED)}>
          <span>Cites</span>
          <ul aria-label="Cited" className="contents">
            {chips.map((chip) => (
              <li key={chip.key}>
                <a
                  href={chip.href}
                  {...(chip.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className={cn(
                    CHIP,
                    chip.label !== "About this Spec" &&
                      "font-mono text-[12px] [overflow-wrap:anywhere]",
                  )}
                >
                  {chip.label}
                  {chip.external ? (
                    <span className="sr-only"> (opens in a new tab)</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
