import type { CliCommand } from "../args";
import { EXIT, renderSchema, type SchemaBody } from "../render";
import type { CommandContext } from "./lookup";
import { apiIdOf, getNavigation } from "./navigate";

export type SchemaArgs = Extract<CliCommand, { command: "schema" }>;

/**
 * `swaggerbot schema <name | apiId> <schemaName>`:
 * `GET /api/apis/{apiId}/schema?name=[&specId=]`, one component schema
 * expanded, as `renderSchema` shows it. A name is looked up first, as `spec`
 * does. `--json` prints the server's body unchanged. A schema not in the
 * Spec is the server's 404 with its `nearest` names, exit 1.
 */
export async function runSchema(
  args: SchemaArgs,
  context: CommandContext,
): Promise<number> {
  const { globals, io, color } = context;
  const apiId = await apiIdOf(args.target, context);
  if (typeof apiId === "number") return apiId;
  const result = await getNavigation<SchemaBody>(
    {
      apiId,
      resource: "schema",
      params: { name: args.name, specId: args.specId },
      what: "The schema",
      notFoundHint: nearestHint,
    },
    context,
  );
  if (typeof result === "number") return result;
  io.stdout.write(
    globals.json ? `${result.text}\n` : renderSchema(result.body, color),
  );
  return EXIT.ok;
}

/** A 404's `nearest` schema names, as a hint; none when it gives none. */
function nearestHint(body: unknown): string | undefined {
  const nearest = (body as { nearest?: unknown } | undefined)?.nearest;
  if (!Array.isArray(nearest)) return undefined;
  const names = nearest.filter((n): n is string => typeof n === "string");
  return names.length > 0
    ? `The nearest it has: ${names.join(", ")}.`
    : undefined;
}
