import type { CliCommand } from "../args";
import { EXIT, type OperationBody, renderOperation } from "../render";
import type { CommandContext } from "./lookup";
import { apiIdOf, getNavigation } from "./navigate";

export type OperationArgs = Extract<CliCommand, { command: "operation" }>;

/**
 * `swaggerbot operation <name | apiId> <method> <path>`:
 * `GET /api/apis/{apiId}/operation?method=&path=[&specId=]`, the operation
 * with every reference it reaches inlined, as `renderOperation` shows it. A
 * name is looked up first, as `spec` does. `--json` prints the server's
 * body unchanged. An operation not in the Spec is the server's 404 and its
 * hint (the outline lists the paths), exit 1, as for any failed request.
 */
export async function runOperation(
  args: OperationArgs,
  context: CommandContext,
): Promise<number> {
  const { globals, io, color } = context;
  const apiId = await apiIdOf(args.target, context);
  if (typeof apiId === "number") return apiId;
  const result = await getNavigation<OperationBody>(
    {
      apiId,
      resource: "operation",
      params: { method: args.method, path: args.path, specId: args.specId },
      what: "The operation",
    },
    context,
  );
  if (typeof result === "number") return result;
  io.stdout.write(
    globals.json ? `${result.text}\n` : renderOperation(result.body, color),
  );
  return EXIT.ok;
}
