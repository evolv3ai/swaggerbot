import { type FormEvent, useState } from "react";
import { LEAD, PAGE, PageTitle } from "~/components/shell/page";
import { Button, buttonClass } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import type { SignInRefusal } from "~/server/email-sign-in";

/** What the page asks of the server. */
export type SignInActions = {
  send: (email: string) => Promise<{ ok: true; email: string } | SignInRefusal>;
  check: (email: string, code: string) => Promise<{ ok: true } | SignInRefusal>;
};

const NOTE = "text-sm leading-relaxed text-sb-text-muted";
const COLUMN = "grid w-full max-w-[26rem] gap-6";

/** Where a provider button goes: `/auth/oauth/…`, back to `returnTo` after. */
export function providerHref(provider: "github" | "google", returnTo: string) {
  return `/auth/oauth/${provider}?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * `/auth/sign-in`: our own sign-in page. GitHub or Google go by way of
 * WorkOS; email is a 6-digit code WorkOS sends (Magic Auth), typed in here.
 * A new visitor signs up the same way. Signed in, the visitor is sent on to
 * `returnTo` with a full page load, so every page sees the new session.
 */
export function SignInView({
  returnTo,
  actions,
  onSignedIn = (to) => window.location.assign(to),
}: {
  returnTo: string;
  actions: SignInActions;
  onSignedIn?: (returnTo: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{
    tone: "error" | "done";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run<T extends { ok: true }>(
    action: () => Promise<T | SignInRefusal>,
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

  const send = (to: string, again: boolean) =>
    run(
      () => actions.send(to),
      (result) => {
        setSentTo(result.email);
        setCode("");
        if (again)
          setMessage({ tone: "done", text: `A new code is on its way.` });
      },
    );

  function onEmail(e: FormEvent) {
    e.preventDefault();
    void send(email, false);
  }

  function onCode(e: FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    // Busy until the page has gone: the session is set, the load follows.
    void run(
      () => actions.check(sentTo, code),
      () => {
        setBusy(true);
        onSignedIn(returnTo);
      },
    );
  }

  return (
    <div className={cn(PAGE, "grid gap-8")}>
      <header>
        <PageTitle>Sign in</PageTitle>
        <p className={LEAD}>
          To get and manage your API key. New here? The same steps make your
          account.
        </p>
      </header>
      {sentTo ? (
        <form className={COLUMN} onSubmit={onCode} noValidate>
          <p className="leading-relaxed text-sb-text">
            We sent a 6-digit code to{" "}
            <strong className="font-bold [overflow-wrap:anywhere]">
              {sentTo}
            </strong>
            . It works for 10 minutes.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="sign-in-code">Code</Label>
            <Input
              id="sign-in-code"
              name="code"
              mono
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="max-w-[12rem] tracking-[0.3em]"
            />
          </div>
          <Status message={message} />
          <Button type="submit" size="lg" disabled={busy}>
            Sign in
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void send(sentTo, true)}
            >
              Send a new code
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setSentTo(null);
                setCode("");
                setMessage(null);
              }}
            >
              Use a different email
            </Button>
          </div>
          <p className={NOTE}>
            Not there? Look in your spam folder. The email comes from WorkOS,
            which runs sign-in for SwaggerBot.
          </p>
        </form>
      ) : (
        <div className={COLUMN}>
          <div className="grid gap-3">
            <a
              href={providerHref("github", returnTo)}
              className={buttonClass({ variant: "secondary", size: "lg" })}
            >
              <GitHubMark />
              Continue with GitHub
            </a>
            <a
              href={providerHref("google", returnTo)}
              className={buttonClass({ variant: "secondary", size: "lg" })}
            >
              <GoogleMark />
              Continue with Google
            </a>
          </div>
          <Or />
          <form className="grid gap-4" onSubmit={onEmail} noValidate>
            <div className="grid gap-2">
              <Label htmlFor="sign-in-email">Email</Label>
              <Input
                id="sign-in-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Status message={message} />
            <Button type="submit" size="lg" disabled={busy}>
              Email me a code
            </Button>
          </form>
          <p className={NOTE}>
            Signing in only gets you an API key. Everything else on SwaggerBot
            works without it.
          </p>
        </div>
      )}
    </div>
  );
}

function Status({
  message,
}: {
  message: { tone: "error" | "done"; text: string } | null;
}) {
  return (
    <p
      role={message?.tone === "error" ? "alert" : "status"}
      className={cn(
        "text-sm empty:hidden",
        message?.tone === "error" ? "text-sb-danger-text" : "text-sb-text",
      )}
    >
      {message?.text}
    </p>
  );
}

function Or() {
  return (
    <div className="flex items-center gap-3 text-[13px] text-sb-text-faint">
      <span className="h-px flex-1 bg-sb-border" />
      or
      <span className="h-px flex-1 bg-sb-border" />
    </div>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
