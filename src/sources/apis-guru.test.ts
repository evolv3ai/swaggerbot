import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIS_GURU_LIST_URL, createApisGuru } from "./apis-guru";

const fixture: unknown = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__/apis-guru-list.json"), "utf8"),
);

const offline = () => Promise.reject(new Error("network down"));

describe("createApisGuru", () => {
  let dir: string;
  let cachePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-apis-guru-"));
    cachePath = join(dir, "nested", "apis-guru-list.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const withFixture = () =>
    createApisGuru({ fetchJson: async () => fixture, cachePath });

  describe("findCandidates", () => {
    it("ranks an exact match first", async () => {
      const [first] = await withFixture().findCandidates("Stripe");
      expect(first).toEqual({
        apiId: "stripe.com/stripe-api",
        name: "Stripe API",
        vendor: { id: "stripe.com", name: "stripe.com", domain: "stripe.com" },
        description:
          "The Stripe REST API. Please see https://stripe.com/docs/api for more details.",
        preferredVersion: "2022-11-15",
        mirrorUrl:
          "https://api.apis.guru/v2/specs/stripe.com/2022-11-15/openapi.json",
        originUrls: [
          "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml",
        ],
        possiblyOfficialUrls: [],
        updated: "2023-03-06T07:12:59.965Z",
      });
    });

    it("puts an exact title match ahead of prefix and token matches", async () => {
      const found = await withFixture().findCandidates("Drive API");
      expect(found.map((c) => c.apiId)).toEqual([
        "googleapis.com/drive",
        "googleapis.com/driveactivity",
      ]);
    });

    it('finds googleapis.com:drive for "google drive"', async () => {
      const found = await withFixture().findCandidates("google drive");
      expect(found[0]?.apiId).toBe("googleapis.com/drive");
      expect(found.map((c) => c.apiId)).toContain("googleapis.com/gmail");
    });

    it("lists every API of a Vendor with several, in key order", async () => {
      const found = await withFixture().findCandidates("npr");
      expect(found.map((c) => c.apiId)).toEqual([
        "npr.org/authorization",
        "npr.org/identity",
        "npr.org/listening",
        "npr.org/station-finder",
      ]);
      expect(found.every((c) => c.vendor.id === "npr.org")).toBe(true);
    });

    it("maps service keys to the service slug and plain keys to the title slug", async () => {
      const guru = withFixture();
      expect((await guru.findCandidates("jira"))[0]?.apiId).toBe(
        "atlassian.com/jira",
      );
      expect((await guru.findCandidates("slack"))[0]?.apiId).toBe(
        "slack.com/slack-web-api",
      );
    });

    it("extracts originUrls and flags those on the Vendor's domain", async () => {
      const [spotify] = await withFixture().findCandidates("spotify");
      expect(spotify?.originUrls).toEqual([
        "https://developer.spotify.com/_data/documentation/web-api/reference/open-api-schema.yml",
      ]);
      expect(spotify?.possiblyOfficialUrls).toEqual(spotify?.originUrls);

      const [npr] = await withFixture().findCandidates("NPR Authorization");
      expect(npr?.possiblyOfficialUrls).toEqual([
        "https://authorization.api.npr.org/v2/swagger.json",
      ]);
    });

    it("returns at most 10 Candidates and nothing for no match", async () => {
      const guru = withFixture();
      expect(await guru.findCandidates("zzzz nothing")).toEqual([]);
      expect(await guru.findCandidates("   ")).toEqual([]);
      const many = createApisGuru({
        cachePath: join(dir, "many.json"),
        fetchJson: async () =>
          Object.fromEntries(
            Array.from({ length: 15 }, (_, i) => [
              `example${i}.com`,
              {
                preferred: "1",
                versions: {
                  "1": {
                    info: { title: `Example ${i}` },
                    swaggerUrl: `https://api.apis.guru/v2/specs/example${i}.com/1/openapi.json`,
                    updated: "2024-01-01T00:00:00.000Z",
                  },
                },
              },
            ]),
          ),
      });
      expect(await many.findCandidates("example")).toHaveLength(10);
    });
  });

  describe("findVendorApis", () => {
    it("lists one Vendor's APIs by key", async () => {
      const guru = withFixture();
      const google = await guru.findVendorApis("googleapis.com");
      expect(google.map((c) => c.apiId)).toEqual([
        "googleapis.com/drive",
        "googleapis.com/driveactivity",
        "googleapis.com/gmail",
      ]);
      expect(await guru.findVendorApis("nothing.test")).toEqual([]);
    });
  });

  describe("cache", () => {
    it("fetches the list once and writes it to disk", async () => {
      const fetchJson = vi.fn(async () => fixture);
      const guru = createApisGuru({ fetchJson, cachePath });
      await guru.findCandidates("stripe");
      await guru.findCandidates("slack");
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(fetchJson).toHaveBeenCalledWith(APIS_GURU_LIST_URL);
      expect(existsSync(cachePath)).toBe(true);
    });

    it("uses the cache within the TTL without fetching", async () => {
      await withFixture().findCandidates("stripe");
      const fetchJson = vi.fn(offline);
      const found = await createApisGuru({
        fetchJson,
        cachePath,
      }).findCandidates("stripe");
      expect(fetchJson).not.toHaveBeenCalled();
      expect(found[0]?.apiId).toBe("stripe.com/stripe-api");
    });

    it("refetches once the cache is older than the TTL", async () => {
      await withFixture().findCandidates("stripe");
      const old = new Date(Date.now() - 25 * 3_600_000);
      utimesSync(cachePath, old, old);
      const fetchJson = vi.fn(async () => ({}));
      const found = await createApisGuru({
        fetchJson,
        cachePath,
      }).findCandidates("stripe");
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(found).toEqual([]);
    });

    it("falls back to a stale cache when the fetch fails", async () => {
      const stalePath = join(dir, "stale-list.json");
      writeFileSync(stalePath, JSON.stringify(fixture));
      const old = new Date(Date.now() - 72 * 3_600_000);
      utimesSync(stalePath, old, old);
      const fetchJson = vi.fn(offline);
      const found = await createApisGuru({
        fetchJson,
        cachePath: stalePath,
      }).findCandidates("stripe");
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(found[0]?.apiId).toBe("stripe.com/stripe-api");
    });

    it("throws when the fetch fails and there is no cache", async () => {
      const guru = createApisGuru({ fetchJson: offline, cachePath });
      await expect(guru.findCandidates("stripe")).rejects.toThrow(
        "APIs.guru list unavailable",
      );
    });
  });
});
