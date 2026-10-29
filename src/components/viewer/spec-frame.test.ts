import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sizeOf } from "./size";
import { frameSrc, SpecFrame, showOperation } from "./spec-frame";

describe("SpecFrame", () => {
  it("sandboxes the frame to scripts alone: no same origin, no popups, no forms", () => {
    const html = renderToStaticMarkup(
      createElement(SpecFrame, {
        specId: "a".repeat(64),
        form: "normalized",
        apiName: 'PayCo "<script>"',
      }),
    );

    const sandbox = html.match(/ sandbox="([^"]*)"/)?.[1];
    expect(sandbox).toBe("allow-scripts");
    expect(html).toContain(
      `src="/embed/specs/${"a".repeat(64)}?form=normalized&amp;theme=dark"`,
    );
    // The API's name is text in an attribute, escaped by React.
    expect(html).toContain(
      'title="API reference for PayCo &quot;&lt;script&gt;&quot;"',
    );
  });
});

describe("frameSrc", () => {
  it("passes the form and the site's theme, for Scalar to match", () => {
    expect(frameSrc("b".repeat(64), "published", "light")).toBe(
      `/embed/specs/${"b".repeat(64)}?form=published&theme=light`,
    );
  });
});

describe("showOperation", () => {
  /** A page with the viewer's frame, recording what is asked of it. */
  function page(withFrame = true) {
    const calls: unknown[] = [];
    const frame = {
      contentWindow: {
        postMessage: (message: unknown, target: string) =>
          calls.push(["postMessage", message, target]),
      },
      scrollIntoView: (options: unknown) =>
        calls.push(["scrollIntoView", options]),
    };
    const selectors: string[] = [];
    const root = {
      querySelector: (selector: string) => {
        selectors.push(selector);
        return withFrame ? frame : null;
      },
    } as unknown as ParentNode;
    return { root, calls, selectors };
  }

  it("scrolls the page to the frame and sends it the chip's method and path", () => {
    const { root, calls, selectors } = page();

    expect(showOperation("delete", "/v1/customers/{id}", root)).toBe(true);
    expect(selectors).toEqual(["iframe[data-spec-frame]"]);
    expect(calls).toEqual([
      ["scrollIntoView", { block: "start" }],
      [
        "postMessage",
        { type: "sb-anchor", method: "delete", path: "/v1/customers/{id}" },
        "*",
      ],
    ]);
  });

  it("does nothing, and says so, without a frame on the page", () => {
    const { root, calls } = page(false);
    expect(showOperation("get", "/things", root)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("sizeOf", () => {
  it.each([
    [26_097_487, "26.1", "MB"],
    [6_628_667, "6.6", "MB"],
    [812_345, "812", "kB"],
    [320, "320", "B"],
  ])("%d bytes → %s %s", (bytes, value, unit) => {
    expect(sizeOf(bytes)).toEqual({ value, unit });
  });
});
