import pkg from "../../cli/package.json";
import { CLI_USAGE, type CliCommand, parseCliArgs } from "./args";
import { runKey } from "./commands/key";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import { type CommandContext, runLookup } from "./commands/lookup";
import { configPathOf } from "./config";
import { baseUrlOf, keyOf } from "./http";
import {
  colorEnabled,
  type Io,
  renderUsageError,
  renderWarning,
} from "./render";

/** The CLI's version, from `cli/package.json`, bundled in. */
export const CLI_VERSION: string = pkg.version;

/** Every command the table runs: all but `help` and `version`, which `runCli` answers itself. */
type RunCommand = Exclude<CliCommand["command"], "help" | "version">;

/** A command's runner: its validated arguments and the context, to an exit code. */
type Runner<K extends RunCommand> = (
  args: Extract<CliCommand, { command: K }>,
  context: CommandContext,
) => Promise<number>;

/** The command table, one line per command; a command missing here is a type error. Issues 3 to 5 add theirs. */
const COMMANDS: { [K in RunCommand]: Runner<K> } = {
  lookup: runLookup,
  login: runLogin,
  logout: runLogout,
  key: runKey,
};

/**
 * Runs `swaggerbot` for `argv` (without node and the script) and answers
 * with the exit code: 0 for Resolved, 1 for any other Outcome, 2 for a
 * usage error, 3 when the request failed. Nothing is written but to `io`.
 */
export async function runCli(argv: string[], io: Io): Promise<number> {
  const parsed = parseCliArgs(argv);
  const noColor = parsed.ok
    ? parsed.globals.noColor
    : argv.includes("--no-color");
  const stderrColor = colorEnabled(io.stderrIsTTY, io.env, noColor);
  if (!parsed.ok) {
    io.stderr.write(renderUsageError(parsed.error, stderrColor));
    return parsed.exitCode;
  }
  const { command, globals } = parsed;
  const color = colorEnabled(io.isTTY, io.env, noColor);

  switch (command.command) {
    case "version":
      io.stdout.write(`${CLI_VERSION}\n`);
      return 0;
    case "help":
      io.stdout.write(`${CLI_USAGE}\n`);
      return 0;
    default: {
      const baseUrl = baseUrlOf(globals.url, io.env);
      const configPath = configPathOf(io.env);
      // Indexing the table by the union's `command` gives the runners'
      // intersection, which takes no command at all; each runner takes
      // exactly the command the switch narrowed to.
      const run = COMMANDS[command.command] as Runner<typeof command.command>;
      return run(command, {
        http: {
          baseUrl,
          key: keyOf(globals.key, io.env),
          version: CLI_VERSION,
        },
        configPath,
        note: (message) => io.stderr.write(renderWarning(message, stderrColor)),
        globals,
        io,
        color,
        stderrColor,
      });
    }
  }
}

/** `runCli` over the process: its arguments, streams and environment. */
export async function main(): Promise<void> {
  const io: Io = {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    isTTY: process.stdout.isTTY === true,
    stderrIsTTY: process.stderr.isTTY === true,
    env: process.env,
  };
  try {
    process.exitCode = await runCli(process.argv.slice(2), io);
  } catch (err) {
    io.stderr.write(
      `error  ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 3;
  }
}
