import type { Outcome } from "../domain/outcome";
import type { CliHttpError } from "./http";

/** Where a command writes, and what it may assume about the terminal. */
export type Io = {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  /** Whether stdout is a terminal: colour is only ever used on one. */
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
};

/**
 * Whether to colour the output: only on a terminal, and never with
 * `--no-color` or `NO_COLOR` set in the environment (https://no-color.org).
 */
export function colorEnabled(
  io: Pick<Io, "isTTY" | "env">,
  noColor: boolean,
): boolean {
  if (noColor) return false;
  if (io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== "") return false;
  return io.isTTY;
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

/** The exit code an Outcome earns: 0 for Resolved, 1 for every other. */
export function outcomeExitCode(outcome: Outcome): 0 | 1 {
  return outcome.outcome === "Resolved" ? 0 : 1;
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

/** A failed request, for stderr: what went wrong, then what fixes it. */
export function renderError(error: CliHttpError, color: boolean): string {
  const p = palette(color);
  const lines = [`${p.red(p.bold("error"))}  ${error.error}`];
  if (error.hint) lines.push(`  ${error.hint}`);
  return `${lines.join("\n")}\n`;
}

/** A usage error, for stderr, with where to read the usage. */
export function renderUsageError(message: string, color: boolean): string {
  const p = palette(color);
  return `${p.red(p.bold("usage error"))}  ${message}\n  Run \`swaggerbot --help\` for the usage.\n`;
}
