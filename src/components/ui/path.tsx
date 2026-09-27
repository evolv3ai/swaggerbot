import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  type ReactNode,
} from "react";

/**
 * Where a path or URL may wrap: after a `/` (not inside `//`), before a
 * `?`, `&` or `[`.
 */
const PATH_BREAKS = /(?<=\/)(?!\/)|(?=[?&[])/;

/**
 * A path or URL that may wrap only between its parts: after a `/` (not
 * inside `//`), before a `?`, `&` or `[`, never inside a word (WTR-143). Pair it with
 * `[overflow-wrap:anywhere]` so a single part too long for the line still
 * breaks rather than overflows.
 */
export function Path({ path }: { path: string }) {
  return (
    <>
      {path.split(PATH_BREAKS).map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the split is fixed text
        <span key={i}>
          {i ? <wbr /> : null}
          {part}
        </span>
      ))}
    </>
  );
}

/**
 * `children` (text, or elements holding text) with the path breaks put in
 * every string, for code that holds URLs: a command wraps between a URL's
 * parts, never inside a word. `<wbr>` adds no character, so what is
 * selected and copied is unchanged.
 */
export function pathBreakable(children: ReactNode, key = "b"): ReactNode {
  return Children.map(children, (child, i) => {
    if (typeof child === "string") {
      const parts = child.split(PATH_BREAKS);
      return parts.length === 1
        ? child
        : parts.map((part, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the split is fixed text
            <Fragment key={`${key}${i}-${j}`}>
              {j ? <wbr /> : null}
              {part}
            </Fragment>
          ));
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children)
      return cloneElement(
        child,
        undefined,
        pathBreakable(child.props.children, `${key}${i}-`),
      );
    return child;
  });
}
