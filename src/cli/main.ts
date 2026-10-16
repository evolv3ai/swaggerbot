import pkg from "../../cli/package.json";
import { CLI_USAGE, type CliCommand, parseCliArgs } from "./args";
import { type CommandContext, runLookup } from "./commands/lookup";
import { baseUrlOf, keyOf } from "./http";
import { colorEnabled, type Io, renderUsageError } from "./render";

/** The CLI's version, from `cli/package.json`, bundled in. */
export const CLI_VERSION: string = pkg.version;

/** A command's runner: its validated arguments and the context, to an exit code. */
type Runner<K extends CliCommand["command"]> = (
  args: Extract<CliCommand, { command: K }>,
  context: CommandContext,
) => Promise<number>;

/** The command table. Issues 2 to 5 add one line each. */
const COMMANDS: { [K in CliCommand["command"]]?: Runner<K> } = {
  lookup: runLookup,
};

/**
 * Runs `swaggerbot` for `argv` (without node and the script) and answers
 * with the exit code: 0 for Resolved, 1 for any other Outcome, 2 for a
 * usage error, 3 when the request failed. Nothing is written but to `io`.
 */
export async function runCli(argv: string[], io: Io): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    io.stderr.write(renderUsageError(parsed.error, colorEnabled(io, false)));
    return parsed.exitCode;
  }
  const { command, globals } = parsed;
  const color = colorEnabled(io, globals.noColor);

  switch (command.command) {
    case "version":
      io.stdout.write(`${CLI_VERSION}\n`);
      return 0;
    case "help":
      io.stdout.write(`${CLI_USAGE}\n`);
      return 0;
    default: {
      const run = COMMANDS[command.command] as Runner<typeof command.command>;
      return run(command, {
        http: {
          baseUrl: baseUrlOf(globals.url, io.env),
          key: keyOf(globals.key, io.env),
          version: CLI_VERSION,
        },
        globals,
        io,
        color,
      });
    }
  }
}

/** `runCli` over the process: its arguments, streams and environment. */
export async function main(): Promise<void> {
  const io: Io = {
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: process.stdout.isTTY === true,
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
