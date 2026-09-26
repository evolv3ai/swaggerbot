/**
 * A path or URL that may wrap only between its parts: after a `/` (not
 * inside `//`), before a `?`, `&` or `[`, never inside a word (WTR-143). Pair it with
 * `[overflow-wrap:anywhere]` so a single part too long for the line still
 * breaks rather than overflows.
 */
export function Path({ path }: { path: string }) {
  return (
    <>
      {path.split(/(?<=\/)(?!\/)|(?=[?&[])/).map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the split is fixed text
        <span key={i}>
          {i ? <wbr /> : null}
          {part}
        </span>
      ))}
    </>
  );
}
