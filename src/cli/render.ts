import type { Outcome } from "../domain/outcome";
import { type CliHttpError, durationWords } from "./http";

/** Where a command reads and writes, and what it may assume about the terminal. */
export type Io = {
  /** Text, and the bytes `spec` downloads; `once("drain")` when a write says to wait. */
  stdout: {
    write(chunk: string | Uint8Array): unknown;
    once?(event: "drain", listener: () => void): unknown;
  };
  stderr: { write(text: string): unknown };
  /** Where `login` reads a key it wasn't given: the terminal, hidden, or a pipe. None when there is no stdin to read. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  /** Whether stdout, and separately stderr, is a terminal: colour is only ever used on one. */
  isTTY: boolean;
  stderrIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  /** The clock, for "in 5 h"; now unless a test says otherwise. */
  now?: () => Date;
  /** Waits `ms`, as `spec` does while a Normalized Form is built; a timer unless a test says otherwise. */
  sleep?: (ms: number) => Promise<void>;
  /** Where `spec` writes the file the server names; the process's unless a test says otherwise. */
  cwd?: string;
};

/**
 * Whether to colour a stream's output: only when it is a terminal, and never
 * with `--no-color` or `NO_COLOR` set in the environment (https://no-color.org).
 */
export function colorEnabled(
  isTTY: boolean,
  env: NodeJS.ProcessEnv,
  noColor: boolean,
): boolean {
  if (noColor) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return isTTY;
}

type Paint = (text: string) => string;

/** The few ANSI colours the views use; identity when colour is off. */
export function palette(color: boolean): {
  green: Paint;
  yellow: Paint;
  red: Paint;
  dim: Paint;
  bold: Paint;
} {
  const wrap =
    (open: number, close: number): Paint =>
    (text) =>
      color ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    red: wrap(31, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

/** The Outcome as a person reads it: `No Spec`, not `NoSpec`. */
export function outcomeWords(outcome: Outcome["outcome"]): string {
  return outcome === "NoSpec" ? "No Spec" : outcome;
}

/**
 * The CLI's exit codes (D4), the one mapping every command uses: 0 for
 * Resolved or success, one code per other Outcome, 1 for a refusal or a
 * failed request (401, 429, 503, no answer), 2 for a usage error. `--json`
 * exits the same.
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  Ambiguous: 3,
  Unconfirmed: 4,
  NoSpec: 5,
  Unknown: 6,
} as const;

/** The exit code an Outcome earns: 0 for Resolved, 3 to 6 for the others. */
export function outcomeExitCode(outcome: Outcome): number {
  return outcome.outcome === "Resolved" ? EXIT.ok : EXIT[outcome.outcome];
}

/**
 * A download URL as the server gives it, made absolute: the server gives a
 * path (`/api/specs/…`) when it has no `PUBLIC_BASE_URL`.
 */
function absolute(url: string, baseUrl: string): string {
  return /^https?:\/\//i.test(url) ? url : `${baseUrl}${url}`;
}

/** `2026-09-24T00:07:16.403Z` → `2026-09-24`. */
function day(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * One line for the Outcome, the Spec's URL (its Published Form) and the
 * Provenance where there is one; Resolved is that one line alone. Dimmer
 * lines follow for what explains the other Outcomes: candidates, reasons,
 * diagnostics.
 */
export function renderOutcome(
  outcome: Outcome,
  { baseUrl, color }: { baseUrl: string; color: boolean },
): string {
  const p = palette(color);
  const lines: string[] = [];
  switch (outcome.outcome) {
    case "Resolved": {
      lines.push(
        [
          p.green(p.bold("Resolved")),
          `${outcome.api.name} (${outcome.api.id})`,
          outcome.provenance,
          absolute(outcome.currentSpec.downloads.published, baseUrl),
          p.dim(`verified ${day(outcome.verifiedAt)}`),
        ].join("  "),
      );
      break;
    }
    case "Ambiguous": {
      lines.push(
        [
          p.yellow(p.bold("Ambiguous")),
          `${outcome.candidates.length} APIs could be meant; say which`,
        ].join("  "),
      );
      for (const c of outcome.candidates)
        lines.push(
          p.dim(
            `  ${c.name}${c.vendor ? ` (${c.vendor})` : ""}${c.apiId ? `  ${c.apiId}` : ""}  ${Math.round(c.probability * 100)}%`,
          ),
        );
      break;
    }
    case "Unconfirmed": {
      let best: string | undefined;
      for (const tier of ["Official", "Endorsed", "Mirror", "Community"])
        if (!best && outcome.sources.some((s) => s.provenance === tier))
          best = tier;
      lines.push(
        [
          p.yellow(p.bold("Unconfirmed")),
          `${outcome.api.name} (${outcome.api.id})`,
          best ?? "",
          absolute(outcome.spec.downloads.published, baseUrl),
          p.dim(`verified ${day(outcome.verifiedAt)}`),
        ]
          .filter(Boolean)
          .join("  "),
      );
      lines.push(
        p.dim(`  not confirmed to describe it: ${outcome.reasons.join("; ")}`),
      );
      break;
    }
    case "NoSpec": {
      lines.push(
        [
          p.red(p.bold("No Spec")),
          `${outcome.api.name} (${outcome.api.id})`,
          outcome.communityAvailable
            ? "a Community Spec exists: add --community to allow it"
            : "no Spec at an allowed Provenance",
        ].join("  "),
      );
      break;
    }
    case "Unknown": {
      lines.push(
        [p.red(p.bold("Unknown")), `no API matches "${outcome.name}"`].join(
          "  ",
        ),
      );
      break;
    }
  }
  if (outcome.diagnostics?.length)
    lines.push(p.dim(`  diagnostics: ${outcome.diagnostics.join(" | ")}`));
  return `${lines.join("\n")}\n`;
}

/** A size as a person reads it: `512 B`, `72.5 kB`, `6.1 MB`. */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** `87 credits left today`; `1 credit`; `no credits left today`. */
export function creditsWords(remaining: number): string {
  if (remaining <= 0) return "no credits left today";
  return `${remaining} credit${remaining === 1 ? "" : "s"} left today`;
}

/** `resets at 00:00 UTC, in 5 h`, from when the credits are next refilled. */
export function resetWords(resetsAt: string, now: Date): string {
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return "";
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  const seconds = Math.ceil((at.getTime() - now.getTime()) / 1000);
  return `resets at ${hh}:${mm} UTC, in ${durationWords(seconds)}`;
}

/** A failed request, for stderr: what went wrong, then what fixes it. */
export function renderError(error: CliHttpError, color: boolean): string {
  const p = palette(color);
  const lines = [`${p.red(p.bold("error"))}  ${error.error}`];
  if (error.hint) lines.push(`  ${error.hint}`);
  return `${lines.join("\n")}\n`;
}

/** A warning, for stderr: something the command went on past. */
export function renderWarning(message: string, color: boolean): string {
  const p = palette(color);
  return `${p.yellow(p.bold("warning"))}  ${message}\n`;
}

/** A usage error, for stderr, with where to read the usage. */
export function renderUsageError(message: string, color: boolean): string {
  const p = palette(color);
  return `${p.red(p.bold("usage error"))}  ${message}\n  Run \`swaggerbot --help\` for the usage.\n`;
}
