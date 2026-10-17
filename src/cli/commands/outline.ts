import type { CliCommand } from "../args";
import {
  EXIT,
  type OutlinePageBody,
  renderOutline,
  renderUsageError,
} from "../render";
import type { CommandContext } from "./lookup";
import { apiIdOf, getNavigation } from "./navigate";

export type OutlineArgs = Extract<CliCommand, { command: "outline" }>;

/** Operations a page unless `--limit` says otherwise: the server's own default. */
export const DEFAULT_OUTLINE_LIMIT = 100;

/** Operations a page when `--all` follows every page and `--limit` isn't given: the most the route allows. */
const ALL_PAGE_LIMIT = 500;

/**
 * `swaggerbot outline <name | apiId>`: `GET /api/apis/{apiId}/outline`, one
 * page of the Spec Outline (`--tag`, `--query`, `--spec-id`, `--limit`, the
 * hidden `--cursor`), as `renderOutline` shows it; `--all` follows every
 * page and lists every tag. A name is looked up first, as `spec` does.
 * `--json` prints the server's body unchanged, one line a page. Exit 1 for
 * a failed request, pending or failed forms included (`EXIT`).
 */
export async function runOutline(
  args: OutlineArgs,
  context: CommandContext,
): Promise<number> {
  const { globals, io, color, stderrColor } = context;
  const apiId = await apiIdOf(args.target, context);
  if (typeof apiId === "number") return apiId;

  const limit =
    args.limit ?? (args.all ? ALL_PAGE_LIMIT : DEFAULT_OUTLINE_LIMIT);
  const seen = new Set<string>();
  let cursor = args.cursor;
  let first: OutlinePageBody | undefined;
  const operations: OutlinePageBody["operations"] = [];
  for (;;) {
    const result = await getNavigation<OutlinePageBody>(
      {
        apiId,
        resource: "outline",
        params: {
          tag: args.tag,
          query: args.query,
          specId: args.specId,
          cursor,
          limit: String(limit),
        },
        what: "The Spec Outline",
      },
      context,
    );
    if (typeof result === "number") return result;
    if (globals.json) io.stdout.write(`${result.text}\n`);
    const page = result.body;
    first ??= page;
    operations.push(...page.operations);
    if (!args.all || page.nextCursor === null) {
      if (!globals.json)
        io.stdout.write(
          renderOutline(
            { ...first, operations, nextCursor: page.nextCursor },
            { allTags: args.all, color },
          ),
        );
      return EXIT.ok;
    }
    // A cursor seen before would page forever: stop and say so.
    if (seen.has(page.nextCursor)) {
      io.stderr.write(
        renderUsageError(
          `the service handed out cursor ${page.nextCursor} twice; stopped paging`,
          stderrColor,
        ),
      );
      return EXIT.failed;
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
