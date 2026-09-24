/**
 * Suggestions for a Caller whose operation or schema isn't in the Spec: the
 * operations of the Spec Outline and the schema names nearest to what it
 * asked for, so a typo or a filled-in path parameter recovers in one call.
 */

/** An operation as the Spec Outline lists it (`method` lowercase). */
export type OutlineOperation = { method: string; path: string };

/**
 * How much further an operation under another method is than one under the
 * asked method on the same path: less than one segment, so the asked path
 * under another method still comes before a different path.
 */
const OTHER_METHOD = 0.5;

/**
 * Up to `limit` operations of `operations` nearest to `method` (any case)
 * on `path`, nearest first and, as near, the same method first. A path
 * template's parameter (`{customer}`) matches any segment, so
 * `/v1/customers/cus_123` is nearest to `/v1/customers/{customer}`.
 */
export function nearestOperations<T extends OutlineOperation>(
  operations: readonly T[],
  method: string,
  path: string,
  limit = 5,
): T[] {
  const verb = method.toLowerCase();
  const asked = segmentsOf(path);
  const byPath = new Map<string, number>();
  return operations
    .map((operation, index) => {
      let distance = byPath.get(operation.path);
      if (distance === undefined) {
        distance = pathDistance(asked, segmentsOf(operation.path));
        byPath.set(operation.path, distance);
      }
      const score =
        distance + (operation.method.toLowerCase() === verb ? 0 : OTHER_METHOD);
      return { operation, score, index };
    })
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ operation }) => operation);
}

/**
 * Up to `limit` of `names` nearest to `name`, ignoring case: a name that
 * contains it, or is contained in it, before one that is merely spelled
 * alike.
 */
export function nearestNames(
  names: readonly string[],
  name: string,
  limit = 5,
): string[] {
  const asked = name.toLowerCase();
  return names
    .map((candidate, index) => {
      const lower = candidate.toLowerCase();
      const distance = editDistance(asked, lower);
      const contains = lower.includes(asked) || asked.includes(lower);
      return { candidate, score: distance - (contains ? 1000 : 0), index };
    })
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** A path's segments, without its query or a trailing slash. */
function segmentsOf(path: string): string[] {
  const bare = path.split(/[?#]/, 1)[0] ?? "";
  return bare.split("/").filter((s) => s !== "");
}

/**
 * The edit distance between two paths, by segment: inserting or dropping a
 * segment costs 1, and replacing one costs its share of characters changed
 * (0 for any segment in place of a template parameter).
 */
function pathDistance(asked: string[], template: string[]): number {
  let previous = template.map((_, j) => j + 1);
  previous.unshift(0);
  for (let i = 1; i <= asked.length; i++) {
    const row = [i];
    for (let j = 1; j <= template.length; j++)
      row[j] = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) +
          segmentCost(asked[i - 1] as string, template[j - 1] as string),
      );
    previous = row;
  }
  return previous[template.length] as number;
}

function segmentCost(asked: string, template: string): number {
  if (/^\{[^}]*\}$/.test(template)) return 0;
  const a = asked.toLowerCase();
  const t = template.toLowerCase();
  if (a === t) return 0;
  return editDistance(a, t) / Math.max(a.length, t.length);
}

/** Levenshtein distance between two strings. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[b.length] as number;
}
