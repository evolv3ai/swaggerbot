import { describe, expect, it } from "vitest";
import {
  apiVersionOf,
  compareApiVersions,
  currentAndAlternates,
  urlNamesApiVersion,
} from "./api-version";

const info = (version: string | null, preview = false) => ({
  version,
  preview,
});

describe("apiVersionOf", () => {
  it("takes info.version when present", () => {
    expect(
      apiVersionOf(info("2024-06-20"), "https://stripe.test/openapi.json"),
    ).toEqual({ apiVersion: "2024-06-20", isPreview: false });
    // A stated version wins over the path's.
    expect(
      apiVersionOf(info("3.1"), "https://acme.test/v2/openapi.json").apiVersion,
    ).toBe("3.1");
  });

  it.each([
    ["https://acme.test/v2/openapi.json", "v2"],
    [
      "https://raw.githubusercontent.com/box/box-openapi/main/openapi/openapi-v2026.0.json",
      "v2026.0",
    ],
    [
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.2022-11-28.json",
      "2022-11-28",
    ],
    ["https://acme.test/release/v2/spec.yaml", "v2"],
    ["https://acme.test/v1/specs/v3/openapi.json", "v3"],
  ])(
    "falls back to the Source path when info.version is absent: %s",
    (url, expected) => {
      expect(apiVersionOf(info(null), url).apiVersion).toBe(expected);
    },
  );

  it("falls back to the path when info.version is a placeholder the path contradicts", () => {
    for (const placeholder of ["1.0.0", "1", "v1.0", "0.0.1"])
      expect(
        apiVersionOf(
          info(placeholder),
          "https://acme.test/openapi/openapi-v2025.0.json",
        ).apiVersion,
      ).toBe("v2025.0");
    // With nothing in the path, the placeholder is all there is.
    expect(
      apiVersionOf(info("1.0.0"), "https://acme.test/openapi.json").apiVersion,
    ).toBe("1.0.0");
  });

  it("is null when neither info.version nor the path says", () => {
    expect(
      apiVersionOf(info(null), "https://acme.test/openapi/spec3.json"),
    ).toEqual({ apiVersion: null, isPreview: false });
    // springdoc's `/v3/api-docs` names the OpenAPI version, not the API's.
    expect(
      apiVersionOf(info(null), "https://acme.test/v3/api-docs").apiVersion,
    ).toBeNull();
    expect(apiVersionOf(info(null), "not a url").apiVersion).toBeNull();
  });

  it.each(["alpha", "beta", "preview", "rc", "experimental"])(
    "is a Preview Version with %s in the API Version or the Source path",
    (word) => {
      expect(
        apiVersionOf(info(`2.0.0-${word}.1`), "https://acme.test/openapi.json")
          .isPreview,
      ).toBe(true);
      expect(
        apiVersionOf(info("2.0.0"), `https://acme.test/${word}/openapi.json`)
          .isPreview,
      ).toBe(true);
    },
  );

  it("is a Preview Version when info.x-preview is true", () => {
    expect(
      apiVersionOf(info("2.0.0", true), "https://acme.test/openapi.json")
        .isPreview,
    ).toBe(true);
  });

  it("counts Preview markers only as whole words", () => {
    expect(
      apiVersionOf(info(null), "https://acme.test/v1beta1/openapi.json"),
    ).toEqual({ apiVersion: "v1beta1", isPreview: true });
    for (const url of [
      "https://acme.test/alphabet/openapi.json",
      "https://acme.test/src/openapi.json",
      "https://acme.test/betamax/openapi.json",
    ])
      expect(apiVersionOf(info("2.0.0"), url).isPreview).toBe(false);
  });
});

describe("urlNamesApiVersion", () => {
  it("is true only for a path that names an API Version", () => {
    expect(urlNamesApiVersion("https://acme.test/openapi-v2025.0.json")).toBe(
      true,
    );
    expect(urlNamesApiVersion("https://acme.test/latest/openapi.json")).toBe(
      false,
    );
  });
});

describe("compareApiVersions", () => {
  const sorted = (versions: string[]) => [...versions].sort(compareApiVersions);

  it("puts newer dates first", () => {
    expect(sorted(["2022-11-28", "2024-06-20", "2023-01-01"])).toEqual([
      "2024-06-20",
      "2023-01-01",
      "2022-11-28",
    ]);
  });

  it("compares dotted numbers segment by segment, as numbers", () => {
    expect(sorted(["v2", "1.10.2", "1.9", "v2026.0", "2025.0", "2"])).toEqual([
      "v2026.0",
      "2025.0",
      "v2",
      "2",
      "1.10.2",
      "1.9",
    ]);
    expect(compareApiVersions("2", "2.0.0")).toBe(0);
  });

  it("puts a release above its pre-releases", () => {
    expect(sorted(["2.0.0-rc.1", "2.0.0", "2.0.0-beta.1"])).toEqual([
      "2.0.0",
      "2.0.0-rc.1",
      "2.0.0-beta.1",
    ]);
  });

  it("puts dates above dotted numbers, and both above anything else", () => {
    expect(sorted(["v3", "latest", "2024-06-20", "2026.0"])).toEqual([
      "2024-06-20",
      "2026.0",
      "v3",
      "latest",
    ]);
    expect(compareApiVersions("2022-11-28", "v2026.0")).toBeLessThan(0);
    expect(compareApiVersions("v2026.0", "2022-11-28")).toBeGreaterThan(0);
  });

  it("falls back to a plain string compare", () => {
    expect(sorted(["alpha", "stable", "gamma"])).toEqual([
      "stable",
      "gamma",
      "alpha",
    ]);
  });
});

describe("currentAndAlternates", () => {
  const v = (apiVersion: string | null, isPreview = false) => ({
    apiVersion,
    isPreview,
  });
  const pick = (specs: ReturnType<typeof v>[]) =>
    currentAndAlternates(specs, (s) => s);

  it("makes the highest non-Preview API Version Current and the rest Alternates", () => {
    const [a, b, c, preview] = [
      v("2024.0"),
      v("2026.0"),
      v("2025.0"),
      v("2027.0-beta", true),
    ];
    expect(pick([a, b, c, preview])).toEqual({
      current: b,
      alternates: [c, a],
    });
  });

  it("keeps one Spec per API Version, the first given, and none without one as an Alternate", () => {
    const first = v("2");
    const second = v("2");
    const bare = v(null);
    const one = v("1");
    const result = pick([bare, first, one, second]);
    expect(result?.current).toBe(first);
    expect(result?.alternates).toEqual([one]);
  });

  it("is null when every Spec is a Preview Version", () => {
    expect(pick([v("2-beta", true)])).toBeNull();
    expect(pick([])).toBeNull();
  });
});
