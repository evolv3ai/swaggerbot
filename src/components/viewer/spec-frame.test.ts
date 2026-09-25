import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sizeOf } from "./size";
import { SpecFrame } from "./spec-frame";

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
      `src="/embed/specs/${"a".repeat(64)}?form=normalized"`,
    );
    // The API's name is text in an attribute, escaped by React.
    expect(html).toContain(
      'title="API reference for PayCo &quot;&lt;script&gt;&quot;"',
    );
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
