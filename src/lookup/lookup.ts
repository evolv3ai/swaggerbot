import {
  type ApiVersionOf,
  apiVersionOf,
  currentAndAlternates,
  urlNamesApiVersion,
} from "~/domain/api-version";
import {
  Api,
  type Source,
  type Spec,
  slugify,
  type Vendor,
  vendorIdFromDomain,
} from "~/domain/catalog";
import type { Outcome } from "~/domain/outcome";
import {
  bestProvenance,
  PROVENANCE_TIERS,
  type Provenance,
} from "~/domain/provenance";
import { FetchError, type Fetcher } from "~/fetch/fetcher";
import {
  type KnownPathHit,
  type ProbeOptions,
  probeKnownPaths,
} from "~/fetch/known-paths";
import { type SniffResult, sniffSpec } from "~/fetch/sniff";
import type { Db } from "~/index-store/db";
import { createRepo, normalizeName, specIdOf } from "~/index-store/repo";
import {
  type ApiRef,
  type Judge,
  NONE,
  type SpecLink,
  type VendorRef,
} from "~/judge/judge";
import type { ApiCandidate, ApisGuru } from "~/sources/apis-guru";
import {
  type CrawlResult,
  crawlForSpecs,
  crawlForVendorApis,
  type VendorApiCrawlResult,
  type VendorApiHit,
} from "~/sources/crawl";
import { registrableDomain } from "~/sources/domain";
import {
  type GitHubCodeSearch,
  type GitHubRepos,
  parseRawGitHubUrl,
  rawGitHubUrl,
  type SpecHit,
} from "~/sources/github";
import { findPortalCandidates, type PortalCandidate } from "~/sources/portal";
import type { WebSearch } from "~/sources/web-search";
import { crawledNamesCovered } from "./coverage";
import {
  DEFAULT_FRESHNESS_DAYS,
  DEFAULT_THRESHOLDS,
  freshnessMs,
  PARTIAL_SPEC_RATIO,
  SPEC_STEP_BUDGET_MS,
  type Thresholds,
} from "./thresholds";
import { type LookupStep, stepTimer, type Timed } from "./timings";
import { enqueueVerification } from "./verify";

export type LookupRequest = {
  name: string;
  /**
   * Selects this API Version exactly, even a Preview Version or a Superseded
   * Spec; `NoSpec` when the API has no such Version. Absent, the Current Spec
   * answers, with the Alternates.
   */
  apiVersion?: string;
  /**
   * Lets a Community Spec answer. Off (the default), Community Specs are only
   * counted, as `NoSpec.communityAvailable`.
   */
  allowCommunity?: boolean;
  /**
   * Demands a fresh Verification: the Lookup skips the Index and answers
   * from Discovery, which moves `verifiedAt`. Off (the default), an answer
   * from the Index is returned as stored, even when Stale.
   */
  fresh?: boolean;
};

/** How the app runs a Lookup; never set by a Caller. */
export type LookupOptions = {
  /** Skips step 1, the Index: a Verification of the name. */
  skipIndex?: boolean;
};

export type Lookup = (
  request: LookupRequest,
  options?: LookupOptions,
) => Promise<Outcome>;

/**
 * A Lookup that can also say whether the Index alone answers a request, as
 * `POST /api/lookup` must know before it decides whether a key is needed.
 */
export type IndexedLookup = Lookup & {
  /**
   * The Lookup's step 1 on its own: the answer from the Index, or null when
   * the Index has none or the request is `fresh`. A Stale answer queues its
   * background Verification, as in the Lookup.
   */
  fromIndex(request: LookupRequest): Outcome | null;
};

export type LookupDeps = {
  db: Db;
  judge: Judge;
  apisGuru: ApisGuru;
  /** `null` skips the Developer Portal step. */
  webSearch: WebSearch | null;
  fetcher: Fetcher;
  thresholds?: Partial<Thresholds>;
  now?: () => Date;
  /**
   * The freshness window: an answer from the Index verified longer ago is
   * Stale and queues a background Verification. Defaults to
   * `DEFAULT_FRESHNESS_DAYS`.
   */
  freshnessDays?: number;
  /**
   * Checks a Vendor's domain for Specs at well-known paths. Defaults to
   * `probeKnownPaths` over https; tests point it at a fixture server.
   */
  probe?: (domain: string, opts: ProbeOptions) => Promise<KnownPathHit[]>;
  /**
   * A shallow crawl of a Developer Portal for Specs. Defaults to
   * `crawlForSpecs` with this Lookup's fetcher and Judge; tests inject a fake.
   */
  crawl?: (opts: {
    startUrl: string;
    api: ApiRef;
    budgetMs?: number;
  }) => Promise<CrawlResult>;
  /**
   * A shallow crawl of a Developer Portal for the Vendor's APIs. Defaults to
   * `crawlForVendorApis` with this Lookup's fetcher and Judge; tests inject a
   * fake.
   */
  vendorCrawl?: (opts: {
    startUrl: string;
    vendor: VendorRef;
  }) => Promise<VendorApiCrawlResult>;
  /**
   * Checks the repo behind a raw.githubusercontent.com origin URL: archived
   * repos are skipped, non-default branches rewritten. Absent, such URLs are
   * fetched as they are.
   */
  github?: GitHubRepos;
  /**
   * GitHub code search for Spec files in the Vendor's org, then across
   * GitHub. Absent (no `GITHUB_SEARCH_TOKEN`), the step is skipped.
   */
  githubSearch?: GitHubCodeSearch;
  /**
   * Adds to `diagnostics` what the Spec step checked and each Spec it found,
   * with its API Version, path count and Judge probability, for diagnosing
   * a Lookup afterwards (`LOOKUP_TRACE=1`), and puts each step's time on
   * the Outcome as `timings`. Off by default.
   */
  trace?: boolean;
  /**
   * The Spec step's deadline for the known-path probe, the crawl and GitHub
   * code search, which run at once. Defaults to `SPEC_STEP_BUDGET_MS`;
   * `Infinity` is none.
   */
  specStepBudgetMs?: number;
};

/**
 * The crawl step's budget: the crawl's own 20 s, and the known-path probes
 * on the off-host domains it reports share what is left of it.
 */
const CRAWL_STEP_BUDGET_MS = 20_000;

/**
 * A Source bounded by a budget of its own (the probe, the crawl) is given
 * the time to the Spec step's deadline less this much, at most a tenth of
 * it, so it returns what it has gathered before the deadline drops it.
 */
const SELF_BOUNDED_MARGIN_MS = 100;

/**
 * GitHub code search fetches at most this many of its ranked hits: they are
 * gathered before any is judged, so it can't stop at the first that settles.
 */
const MAX_GITHUB_SPEC_FETCHES = 3;

/** The diagnostic when GitHub code search answers `null`, which gives no reason. */
const GITHUB_SEARCH_SKIPPED =
  "GitHub code search: skipped (no GITHUB_SEARCH_TOKEN, rate-limited or failed)";

/** The diagnostic when GitHub repo search answers `null`, which gives no reason. */
const GITHUB_REPO_SEARCH_SKIPPED =
  "GitHub repo search: skipped (no GITHUB_SEARCH_TOKEN, rate-limited or failed)";

/** The GitHub search step searches at most this many orgs verified by their website. */
const MAX_VERIFIED_ORGS = 3;

/** The GitHub search step lists the trees of at most this many repos. */
const MAX_REPO_TREES_LISTED = 3;

/** A merged APIs.guru choice keeps at most this many origin URLs. */
const MAX_MERGED_ORIGIN_URLS = 8;

/** Umbrella names list at most this many Candidates. */
const MAX_UMBRELLA_CANDIDATES = 10;

/** An API Candidate, from APIs.guru or a Developer Portal. */
type ApiChoice = {
  api: Api;
  vendor: Vendor;
  description?: string;
  /** Where APIs.guru got the Spec; Official when on the Vendor's domain. */
  originUrls: string[];
  /** The APIs.guru copy of the Spec: a Mirror, tried last. */
  mirrorUrl?: string;
  /** The Developer Portal page the Candidate came from; where the crawl starts. */
  portalUrl?: string;
};

type AmbiguousCandidate = {
  apiId: string;
  name: string;
  vendor: string;
  probability: number;
};

type Verdict =
  /** `top`: the likeliest Candidate, when `whichApi` weighed any. */
  | { kind: "unknown"; top?: ApiChoice }
  | { kind: "identified"; choice: ApiChoice }
  | { kind: "ambiguous"; candidates: AmbiguousCandidate[] };

/** A fetched Spec for the identified API, with the Judge's answer on it. */
type SpecCandidate = ApiVersionOf & {
  url: string;
  bytes: Uint8Array;
  specId: string;
  sniff: SniffResult;
  provenance: Provenance;
  /** `specDescribesApi`. */
  probability: number;
  /** Found by the crawl off the portal's registrable domain. */
  offHost?: boolean;
  /** The APIs.guru copy: a Mirror whatever its bytes. */
  apisGuruMirror?: boolean;
  /** Its host's robots.txt disallowed it; fetched under ADR 0003. */
  robotsDisallowed?: boolean;
};

/** A Spec a Source gathered, not judged yet: what `consider` takes. */
type Gathered = {
  url: string;
  bytes: Uint8Array;
  sniff: SniffResult;
  provenance: Provenance;
  found: Pick<SpecCandidate, "offHost" | "robotsDisallowed" | "apisGuruMirror">;
  /** The GitHub org its repo is in now, after a move, when fetched as an origin. */
  githubOrg?: string;
};

/** What the crawl gathered: its hits, then each off-host host's probe hits. */
type CrawlGathered = { hits: Gathered[]; offHost: Gathered[][] };

/** A GitHub code search hit to fetch, in rank order, and its Spec once fetched. */
type GitHubGathered = { hitUrl: string; spec?: Gathered };

/**
 * What a Source checked, the diagnostics it gave and what each URL it fetched
 * served, kept apart while it gathers alongside the others.
 */
type SourceLog = {
  checked: string[];
  diagnostics: string[];
  served: Map<string, string | null>;
};

/** A Source's log and what it gathers into. */
function gathering<T>(out: T): { log: SourceLog; out: T } {
  return { log: { checked: [], diagnostics: [], served: new Map() }, out };
}

function copyLog(log: SourceLog): SourceLog {
  return {
    checked: [...log.checked],
    diagnostics: [...log.diagnostics],
    served: new Map(log.served),
  };
}

/**
 * The Lookup pipeline: turns a name into an Outcome. The Source chain runs in
 * order and stops once the Outcome is settled:
 *
 * 1. the Index, for a name already resolved, unless `fresh` or `skipIndex`
 *    (a Verification). A Stale answer is returned at once and queues a
 *    background Verification of the name;
 * 2. APIs.guru Candidates, judged by `whichApi`;
 * 3. Developer Portal Candidates from web search, one per Vendor after
 *    following redirects, judged with step 2's;
 * 4. when nothing is identified yet, or the name is the Vendor's own name: a
 *    name the Judge takes for the top (or identified) Candidate's Vendor as a
 *    whole answers Ambiguous over that Vendor's APIs, from APIs.guru or, when
 *    it has fewer than two, the Developer Portal; a Vendor with one API goes
 *    on to that API's Spec. For an identified API whose Vendor's APIs came
 *    from the Developer Portal, its Spec answers instead when Resolved and
 *    it covers most of their names (a Vendor's product pages, one API);
 * 5. for the identified API, its Spec: APIs.guru origin URLs (a GitHub
 *    one skipped when its repo is archived, read from the default branch
 *    when it names another); then, at once and within the Spec step's
 *    deadline (`specStepBudgetMs`), known paths on the Vendor's domain, a
 *    shallow crawl of the Developer Portal and known paths on the other
 *    domains it links to, and GitHub code search in the Vendor's orgs or
 *    else across GitHub, judged in that order; then the APIs.guru mirror.
 *
 * A Judge, search or fetch error skips that step and is reported in
 * `diagnostics`; it never makes the Lookup throw.
 */
export function createLookup(deps: LookupDeps): IndexedLookup {
  const { judge, fetcher, webSearch, apisGuru, github, githubSearch } = deps;
  const repo = createRepo(deps.db);
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...deps.thresholds };
  const now = deps.now ?? (() => new Date());
  const freshnessDays = deps.freshnessDays ?? DEFAULT_FRESHNESS_DAYS;
  const specStepBudgetMs = deps.specStepBudgetMs ?? SPEC_STEP_BUDGET_MS;
  const probe =
    deps.probe ??
    ((domain: string, opts: ProbeOptions) =>
      probeKnownPaths(domain, fetcher, opts));
  const crawl =
    deps.crawl ??
    ((opts: { startUrl: string; api: ApiRef; budgetMs?: number }) =>
      crawlForSpecs({ ...opts, fetcher, judge }));
  const vendorCrawl =
    deps.vendorCrawl ??
    ((opts: { startUrl: string; vendor: VendorRef }) =>
      crawlForVendorApis({ ...opts, fetcher, judge }));

  const lookup: Lookup = async (
    { name, apiVersion, allowCommunity = false, fresh = false },
    { skipIndex = false } = {},
  ) => {
    const diagnostics: string[] = [];
    const { timed, timings } = stepTimer();
    const finish = (outcome: Outcome): Outcome => ({
      ...outcome,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
      ...(deps.trace ? { timings: timings() } : {}),
    });

    // 1. The Index.
    if (!fresh && !skipIndex) {
      const indexed = await timed("Index", () =>
        fromIndexWith({ name, apiVersion, allowCommunity }, diagnostics),
      );
      if (indexed) return finish(indexed);
    }

    // 2. APIs.guru.
    let guru: ApiChoice[] = [];
    try {
      guru = mergeGuruChoices(
        await timed("APIs.guru", () => apisGuru.findCandidates(name)),
      );
    } catch (error) {
      diagnostics.push(`APIs.guru: ${message(error)}`);
    }

    const umbrella = await timed("umbrella check", () =>
      umbrellaCandidates(name, guru),
    );
    if (umbrella) return finish({ outcome: "Ambiguous", candidates: umbrella });

    let verdict: Verdict | null =
      guru.length > 0
        ? await timed("Judge whichApi", () => whichApi(name, guru, diagnostics))
        : null;

    // 3. Developer Portal, when step 2 settled nothing.
    if ((!verdict || verdict.kind === "unknown") && webSearch) {
      const portals = await timed("Developer Portal search", async () => {
        let found: PortalCandidate[] = [];
        try {
          found = await findPortalCandidates(name, webSearch);
        } catch (error) {
          diagnostics.push(`web search: ${message(error)}`);
        }
        return followPortals(found, diagnostics);
      });
      const all = uniqueById([...guru, ...portalChoices(portals, guru)]);
      if (all.length > guru.length) {
        verdict =
          (await timed("Judge whichApi", () =>
            whichApi(name, all, diagnostics),
          )) ?? verdict;
      }
    }

    // 4. A name for the whole Vendor.
    const top =
      verdict?.kind === "identified"
        ? verdict.choice
        : verdict?.kind === "unknown"
          ? verdict.top
          : undefined;
    if (top) {
      const vendorApis = await vendorCandidates(name, top, diagnostics, timed);
      if (vendorApis?.crawled && verdict?.kind === "identified")
        return finish(
          await vendorOrSpec(
            name,
            verdict.choice,
            vendorApis.candidates,
            { allowCommunity, apiVersion },
            diagnostics,
            timed,
          ),
        );
      if (vendorApis)
        return finish({
          outcome: "Ambiguous",
          candidates: vendorApis.candidates,
        });
    }

    if (!verdict || verdict.kind === "unknown")
      return finish({ outcome: "Unknown", name });
    if (verdict.kind === "ambiguous")
      return finish({ outcome: "Ambiguous", candidates: verdict.candidates });

    // 5. The identified API's Spec.
    const found = await findSpec(
      name,
      verdict.choice,
      { allowCommunity, apiVersion },
      diagnostics,
      timed,
    );
    return finish(found.outcome);
  };

  return Object.assign(lookup, {
    fromIndex(request: LookupRequest): Outcome | null {
      const diagnostics: string[] = [];
      const indexed = fromIndexWith(request, diagnostics);
      if (!indexed || diagnostics.length === 0) return indexed;
      return { ...indexed, diagnostics };
    },
  });

  /**
   * Step 1: the answer from the Index, unless `fresh`. A Stale answer queues
   * a background Verification of the name.
   */
  function fromIndexWith(
    { name, apiVersion, allowCommunity = false, fresh = false }: LookupRequest,
    diagnostics: string[],
  ): Outcome | null {
    if (fresh) return null;
    const indexed = answerFromIndex(name, allowCommunity, apiVersion);
    if (indexed && isStale(indexed)) queueVerification(name, diagnostics);
    return indexed;
  }

  /**
   * Fetches each portal Candidate's own page and moves the Candidate to the
   * registrable domain it ends up on (`neon.tech` → `neon.com`), one fetch per
   * search domain. When the page can't be fetched, the site's origin is tried;
   * when that fails too, the Candidate keeps its search domain, with a
   * diagnostic.
   *
   * Then, when the Candidates are on more than one domain, each domain's apex
   * (`https://<domain>/`) is fetched once: when it ends on another Candidate's
   * domain, that domain's Candidates move there too. `api-docs.neon.tech`
   * stays put, but `neon.tech` redirects to `neon.com`, so both are one
   * Vendor; `neoncrm.com` redirects to `neonone.com`, which no Candidate has,
   * so it stays a Vendor of its own. An apex that can't be fetched moves
   * nothing, silently.
   */
  async function followPortals(
    portals: PortalCandidate[],
    diagnostics: string[],
  ): Promise<PortalCandidate[]> {
    const finalDomains = new Map<string, Promise<string | null>>();
    const settle = async (url: string, searchDomain: string) => {
      try {
        return registrableDomain((await fetcher.fetchUrl(url)).finalUrl);
      } catch (error) {
        if (!(error instanceof FetchError)) return null;
        // A host that answered, or a redirect off the search domain, still
        // says where the page lives.
        const domain = registrableDomain(error.url);
        return error.kind === "http-error" || domain !== searchDomain
          ? domain
          : null;
      }
    };
    const finalDomain = (p: PortalCandidate) => {
      let domain = finalDomains.get(p.domain);
      if (!domain) {
        domain = (async () => {
          const fromPage = await settle(p.url, p.domain);
          if (fromPage) return fromPage;
          // `p.url` parses: its registrable domain was taken from it.
          const fromOrigin = await settle(new URL(p.url).origin, p.domain);
          if (!fromOrigin)
            diagnostics.push(
              `Developer Portal: could not follow ${p.url}; kept its domain ${p.domain}`,
            );
          return fromOrigin;
        })();
        finalDomains.set(p.domain, domain);
      }
      return domain;
    };
    const settled = await Promise.all(
      portals.map(async (p) => {
        const domain = await finalDomain(p);
        return domain && domain !== p.domain ? { ...p, domain } : p;
      }),
    );
    const domains = new Set(settled.map((p) => p.domain));
    if (domains.size < 2) return settled;
    const apexDomains = new Map(
      await Promise.all(
        [...domains].map(
          async (d) => [d, await settle(`https://${d}/`, d)] as const,
        ),
      ),
    );
    return settled.map((p) => {
      const apex = apexDomains.get(p.domain);
      return apex && apex !== p.domain && domains.has(apex)
        ? { ...p, domain: apex }
        : p;
    });
  }

  /**
   * Resolved from the confirmed Specs with an Official or Endorsed Source (or
   * Community ones, when allowed and there are no others), if the name is
   * known: the Current Spec with its Alternates, leaving out Preview Versions
   * and Superseded Specs; or, with `apiVersion`, that API Version's Spec,
   * whatever it is. `null` sends the Lookup on to Discovery.
   *
   * The Current Spec is picked by `currentAndFull`, as in Discovery, from the
   * path count, deprecation and origin rank stored with each Spec; ties go to
   * the best Provenance, then the earliest origin URL, then the newest Spec.
   * A Spec stored before these were kept ranks by API Version alone.
   */
  function answerFromIndex(
    name: string,
    allowCommunity: boolean,
    apiVersion: string | undefined,
  ): Outcome | null {
    const api = repo.findApiByName(name);
    if (!api) return null;
    const stored = repo.getApiWithSpecs(api.id);
    if (!stored) return null;
    // An Unconfirmed Spec never answers Resolved; newest first, for ties.
    const confirmed = stored.specs.filter((s) => s.confirmedAt !== null);
    confirmed.reverse();
    const at = (ok: (p: Provenance) => boolean) =>
      confirmed.filter((s) => s.sources.some((src) => ok(src.provenance)));
    let pool = at(isVendorBacked);
    if (pool.length === 0 && allowCommunity)
      pool = at((p) => p === "Community");
    const live = pool.filter((s) => s.spec.supersededAt === null);
    const versionOf = (s: (typeof pool)[number]) => s.spec;

    if (apiVersion !== undefined) {
      const chosen = pool.find((s) => s.spec.apiVersion === apiVersion);
      if (!chosen) return null;
      const others = otherVersions(chosen, live, versionOf);
      return resolved(
        stored.api,
        stored.vendor,
        chosen,
        others.map((s) => s.spec),
      );
    }
    const tier = (s: (typeof pool)[number]) =>
      tierRank(
        bestProvenance(s.sources.map((src) => src.provenance)) ?? "Community",
      );
    const byOrigin = (s: (typeof pool)[number]) =>
      s.originRank ?? Number.MAX_SAFE_INTEGER;
    const ranked = [...live].sort(
      (a, b) => tier(a) - tier(b) || byOrigin(a) - byOrigin(b),
    );
    const picked = currentAndFull(ranked, (s) => ({
      apiVersion: s.spec.apiVersion,
      isPreview: s.spec.isPreview,
      pathCount: s.pathCount,
      deprecated: s.deprecated,
    }));
    if (!picked) return null;
    return resolved(
      stored.api,
      stored.vendor,
      picked.current,
      picked.alternates.map((s) => s.spec),
    );
  }

  /** Verified longer ago than the freshness window, or never. */
  function isStale(outcome: Outcome): boolean {
    if (!("verifiedAt" in outcome)) return false;
    const verifiedAt = Date.parse(outcome.verifiedAt);
    return (
      Number.isNaN(verifiedAt) ||
      now().getTime() - verifiedAt > freshnessMs(freshnessDays)
    );
  }

  /** Queues a background Verification; a failure is only diagnosed. */
  function queueVerification(name: string, diagnostics: string[]): void {
    try {
      enqueueVerification(deps.db, name, now(), freshnessDays);
    } catch (error) {
      diagnostics.push(`Verification: not queued: ${message(error)}`);
    }
  }

  async function whichApi(
    name: string,
    choices: ApiChoice[],
    diagnostics: string[],
  ): Promise<Verdict | null> {
    let probabilities: Record<string, number>;
    try {
      ({ probabilities } = await judge.whichApi(name, choices.map(apiRef)));
    } catch (error) {
      diagnostics.push(`Judge whichApi: ${message(error)}`);
      return null;
    }
    const p = (id: string) => probabilities[id] ?? 0;
    const ranked = choices
      .map((choice) => ({ choice, probability: p(choice.api.id) }))
      .sort((a, b) => b.probability - a.probability);
    const [top, second] = ranked;
    if (p(NONE) >= t.none) return { kind: "unknown", top: top?.choice };

    if (
      top &&
      top.probability >= t.apiPick &&
      top.probability - (second?.probability ?? 0) >= t.apiMargin
    )
      return { kind: "identified", choice: top.choice };

    // An Ambiguous answer names at least two Candidates, even weak ones.
    let listed = ranked.filter((r) => r.probability >= t.ambiguousFloor);
    if (listed.length < 2) listed = ranked.slice(0, 2);
    if (listed.length < 2) {
      if (top)
        diagnostics.push(
          `Judge whichApi: the only Candidate, ${top.choice.api.id}, was not likely enough (${top.probability.toFixed(2)})`,
        );
      return { kind: "unknown", top: top?.choice };
    }
    return {
      kind: "ambiguous",
      candidates: listed.map(({ choice, probability }) =>
        ambiguousCandidate(choice, probability),
      ),
    };
  }

  /**
   * A name equal to the first label of a Vendor id (`google` ↔ `google.com`),
   * or to that label less an `apis`/`api` suffix (`google` ↔
   * `googleapis.com`), with two or more of that Vendor's APIs among the
   * Candidates means the Vendor, not one API: Ambiguous without asking
   * `whichApi`, which tends to answer `"none"` for such names.
   */
  function umbrellaCandidates(
    name: string,
    choices: ApiChoice[],
  ): AmbiguousCandidate[] | null {
    const query = normalizeName(name);
    const members = choices
      .filter((c) => isUmbrellaLabel(query, vendorLabel(c.vendor)))
      .slice(0, MAX_UMBRELLA_CANDIDATES);
    if (members.length < 2) return null;
    return members.map((c) => ambiguousCandidate(c, 1 / members.length));
  }

  /**
   * When the Judge takes the name for the Vendor as a whole, that Vendor's
   * APIs as equally likely Candidates, if it has at least two: its APIs.guru
   * APIs, and when those are fewer than two, the APIs its Developer Portal
   * names, crawled from `top`'s portal page or else the Vendor's domain
   * (`crawled`). Otherwise `null`, and the Lookup keeps its answer.
   */
  async function vendorCandidates(
    name: string,
    top: ApiChoice,
    diagnostics: string[],
    timed: Timed,
  ): Promise<{ candidates: AmbiguousCandidate[]; crawled: boolean } | null> {
    const { vendor } = top;
    let members: ApiChoice[] = [];
    try {
      members = mergeGuruChoices(
        await timed("APIs.guru", () => apisGuru.findVendorApis(vendor.id)),
      );
    } catch (error) {
      diagnostics.push(`APIs.guru: ${message(error)}`);
    }
    let probability: number;
    try {
      ({ probability } = await timed("Judge isVendorName", () =>
        judge.isVendorName(name, { id: vendor.id, name: vendor.name }),
      ));
    } catch (error) {
      diagnostics.push(`Judge isVendorName: ${message(error)}`);
      return null;
    }
    if (probability < t.vendorName) return null;

    const crawled = members.length < 2;
    if (crawled) {
      const startUrl = top.portalUrl ?? `https://${vendor.domain}`;
      let hits: VendorApiHit[] = [];
      try {
        const result = await timed("Vendor API crawl", () =>
          vendorCrawl({
            startUrl,
            vendor: { id: vendor.id, name: vendor.name },
          }),
        );
        hits = result.hits;
        for (const { url, reason } of result.failed)
          diagnostics.push(`Vendor API crawl fetch failed: ${url} (${reason})`);
      } catch (error) {
        diagnostics.push(`Vendor API crawl: ${message(error)}`);
      }
      members = uniqueById([
        ...members,
        ...hits.flatMap((hit) => fromVendorApiHit(hit, vendor) ?? []),
      ]);
    }
    members = members.slice(0, MAX_UMBRELLA_CANDIDATES);
    if (members.length < 2) return null;
    return {
      candidates: members.map((c) => ambiguousCandidate(c, 1 / members.length)),
      crawled,
    };
  }

  /**
   * Step 4 for an identified API when the Vendor API crawl named several:
   * the crawl can return a Vendor's product pages, which are one API with one
   * Spec (Plaid's). The identified API's Spec answers when it is Resolved and
   * covers more than half of the crawled names; otherwise Ambiguous over them.
   * The name is remembered in the Index only for the Resolved answer.
   */
  async function vendorOrSpec(
    name: string,
    choice: ApiChoice,
    crawledApis: AmbiguousCandidate[],
    request: { allowCommunity: boolean; apiVersion: string | undefined },
    diagnostics: string[],
    timed: Timed,
  ): Promise<Outcome> {
    const ambiguous: Outcome = {
      outcome: "Ambiguous",
      candidates: crawledApis,
    };
    const found = await findSpec(
      name,
      choice,
      { ...request, remember: false },
      diagnostics,
      timed,
    );
    if (found.outcome.outcome !== "Resolved" || !found.current)
      return ambiguous;
    const { matched, counted, covered } = crawledNamesCovered(
      crawledApis.map((c) => c.name),
      found.current.sniff.outline,
      vendorLabel(choice.vendor),
    );
    diagnostics.push(
      `Vendor API crawl: ${matched} of ${counted} API names are covered by ${found.current.url}`,
    );
    if (!covered) return ambiguous;
    repo.rememberName(name, choice.api.id);
    return found.outcome;
  }

  /**
   * The identified API's Spec, as an Outcome, with the Spec answering it
   * when Resolved (`current`). With `remember: false`, the name is not
   * remembered in the Index.
   */
  async function findSpec(
    name: string,
    choice: ApiChoice,
    {
      allowCommunity,
      apiVersion,
      remember = true,
    }: {
      allowCommunity: boolean;
      apiVersion: string | undefined;
      remember?: boolean;
    },
    diagnostics: string[],
    timed: Timed,
  ): Promise<{ outcome: Outcome; current?: SpecCandidate }> {
    const ref = apiRef(choice);
    const candidates: SpecCandidate[] = [];
    const checked: string[] = [];
    let judgeFailed = false;
    /**
     * What each URL fetched in this Lookup served: a Spec id, or `null` for
     * no Spec (not one, or a 404/410). For marking Specs Superseded.
     */
    const served = new Map<string, string | null>();
    /**
     * Each Spec's earliest origin URL, as its place in `choice.originUrls`:
     * among Specs of one API Version, the earliest is Current.
     */
    const originRank = new Map<string, number>();
    /** The origin URL being fetched, as its place in `choice.originUrls`. */
    let originIndex: number | undefined;
    /** The GitHub orgs whose profile website is the Vendor's: its own, for Provenance. */
    const vendorOrgs = new Set<string>();

    async function consider(
      url: string,
      bytes: Uint8Array,
      sniff: SniffResult,
      provenance: Provenance,
      found: Pick<
        SpecCandidate,
        "offHost" | "robotsDisallowed" | "apisGuruMirror"
      > = {},
    ) {
      if (candidates.some((c) => c.url === url)) return;
      const specId = specIdOf(bytes);
      served.set(url, specId);
      if (originIndex !== undefined && !originRank.has(specId))
        originRank.set(specId, originIndex);
      // The same bytes from another Source are the same Spec: judge it once.
      const known = candidates.find((c) => c.specId === specId);
      let probability = known?.probability;
      if (probability === undefined) {
        try {
          ({ probability } = await judge.specDescribesApi(ref, sniff.extract));
        } catch (error) {
          judgeFailed = true;
          diagnostics.push(
            `Judge specDescribesApi (${url}): ${message(error)}`,
          );
          return;
        }
      }
      candidates.push({
        url,
        bytes,
        specId,
        sniff,
        provenance,
        probability,
        ...apiVersionOf(sniff.versionInfo, url),
        ...found,
      });
    }

    /** Judges a Spec a Source gathered, as `consider`. */
    const judgeGathered = (g: Gathered) =>
      consider(g.url, g.bytes, g.sniff, g.provenance, g.found);

    /** What the Spec fetch step writes to: this Lookup's own record. */
    const lookupLog: SourceLog = { checked, diagnostics, served };

    /**
     * Fetches a URL and gathers the Spec there, writing what it checked to
     * `log`; `null` when none was found. `githubOrg` is the GitHub org the
     * URL's repo is in now, after a move.
     */
    async function fetchSpec(
      url: string,
      mirror: boolean,
      log: SourceLog,
      githubOrg?: string,
    ): Promise<Gathered | null> {
      try {
        const res = await fetcher.fetchUrl(url);
        const sniff = sniffSpec(res.bytes, res.contentType);
        if (!sniff) {
          log.checked.push(`${url} (not a Spec)`);
          log.served.set(url, null).set(res.finalUrl, null);
          return null;
        }
        log.checked.push(url);
        log.served.set(url, specIdOf(res.bytes));
        const provenance = mirror
          ? "Mirror"
          : provenanceOf(
              res.finalUrl,
              choice.vendor,
              false,
              githubOrg,
              vendorOrgs,
            );
        return {
          url: res.finalUrl,
          bytes: res.bytes,
          sniff,
          provenance,
          found: mirror ? { apisGuruMirror: true } : {},
          ...(githubOrg ? { githubOrg } : {}),
        };
      } catch (error) {
        log.checked.push(`${url} (unreachable)`);
        log.diagnostics.push(`fetch: ${message(error)}`);
        // Gone, not merely unreachable.
        if (
          error instanceof FetchError &&
          (error.status === 404 || error.status === 410)
        )
          log.served.set(url, null);
        return null;
      }
    }

    /** Fetches a URL and considers the Spec there. */
    async function fetchAndConsider(url: string, mirror: boolean) {
      const spec = await fetchSpec(url, mirror, lookupLog);
      if (spec) await judgeGathered(spec);
    }

    /**
     * The Spec at an origin URL. On raw.githubusercontent.com its repo is
     * looked up first: an archived repo's Spec is never used, and a URL on
     * another branch is read from the default one, falling back to the URL
     * as given. When GitHub can't say, the URL is fetched as it is.
     */
    async function fetchOrigin(
      url: string,
      log: SourceLog,
    ): Promise<Gathered | null> {
      const raw = parseRawGitHubUrl(url);
      const info =
        raw && github ? await github.repoInfo(raw.owner, raw.repo) : null;
      if (!raw || !info) return fetchSpec(url, false, log);
      if (info.archived) {
        log.checked.push(`${url} (archived repo ${info.fullName})`);
        log.diagnostics.push(`archived repo ${info.fullName}`);
        return null;
      }
      const org = info.fullName.split("/")[0]?.toLowerCase();
      if (raw.ref !== info.defaultBranch) {
        const onDefault = rawGitHubUrl(
          url,
          info.fullName,
          info.defaultBranch,
          raw.path,
        );
        const spec = await fetchSpec(onDefault, false, log, org);
        if (spec) return spec;
      }
      return fetchSpec(url, false, log, org);
    }

    /**
     * Known paths on the Vendor's own domain, within `budgetMs`; every hit is
     * gathered.
     */
    async function gatherKnownPaths(
      log: SourceLog,
      out: Gathered[],
      budgetMs: number | undefined,
    ) {
      let hits: KnownPathHit[] = [];
      try {
        // The Vendor's own domain: ADR 0003 allows a shut host's Spec once.
        hits = await probe(choice.vendor.domain, {
          allowBlanketRobots: true,
          ...(budgetMs === undefined ? {} : { budgetMs }),
        });
      } catch (error) {
        log.diagnostics.push(`known paths: ${message(error)}`);
      }
      log.checked.push(
        `known paths on ${choice.vendor.domain} (${hits.length} found)`,
      );
      for (const hit of hits) {
        if (hit.robotsDisallowed)
          log.diagnostics.push(robotsDiagnostic(hit.url));
        out.push({
          url: hit.url,
          bytes: hit.bytes,
          sniff: hit.sniff,
          provenance: provenanceOf(hit.url, choice.vendor, false),
          found: { robotsDisallowed: hit.robotsDisallowed },
        });
      }
    }

    /**
     * Crawls the Developer Portal, within `budget` and at most the crawl
     * step's own budget, and gathers every Spec it found, hits on the
     * portal's domain first; those off it were reached by a link from the
     * Vendor's pages, so are Endorsed. Then probes known paths on the other
     * domains it links to, all at once, in what is left. The GitHub orgs the
     * crawl found go to `onGitHubOrgs` as soon as it ends.
     */
    async function gatherCrawl(
      log: SourceLog,
      out: CrawlGathered,
      budget: () => number | undefined,
      onGitHubOrgs: (orgs: string[]) => void,
    ) {
      const stepEndsAt = Date.now() + CRAWL_STEP_BUDGET_MS;
      const left = () =>
        Math.min(stepEndsAt - Date.now(), budget() ?? Infinity);
      const startUrl = choice.portalUrl ?? `https://${choice.vendor.domain}`;
      let result: CrawlResult = {
        hits: [],
        failed: [],
        offHostHosts: [],
        githubOrgs: [],
      };
      try {
        const budgetMs = budget();
        result = await crawl({
          startUrl,
          api: ref,
          ...(budgetMs === undefined ? {} : { budgetMs }),
        });
      } catch (error) {
        log.diagnostics.push(`crawl: ${message(error)}`);
      } finally {
        onGitHubOrgs(result.githubOrgs);
      }
      for (const { url, reason } of result.failed)
        log.diagnostics.push(`crawl fetch failed: ${url} (${reason})`);
      log.checked.push(`crawl from ${startUrl} (${result.hits.length} found)`);
      const hits = [
        ...result.hits.filter((hit) => !hit.offHost),
        ...result.hits.filter((hit) => hit.offHost),
      ];
      for (const hit of hits) {
        if (hit.robotsDisallowed)
          log.diagnostics.push(robotsDiagnostic(hit.url));
        out.hits.push({
          url: hit.url,
          bytes: hit.bytes,
          sniff: hit.sniff,
          provenance: provenanceOf(hit.url, choice.vendor, true),
          found: {
            offHost: hit.offHost,
            robotsDisallowed: hit.robotsDisallowed,
          },
        });
      }

      const vendorDomain =
        registrableDomain(choice.vendor.domain) ?? choice.vendor.domain;
      // The Vendor's own domain is probed by the known-path Source.
      const hosts = result.offHostHosts.filter((host) => host !== vendorDomain);
      const budgetMs = left();
      if (hosts.length === 0 || budgetMs <= 0) return;
      // Kept in the crawl's order, so judging can stop between hosts as the
      // sequential probes did.
      out.offHost.push(...hosts.map(() => [] as Gathered[]));
      await Promise.all(
        hosts.map(async (host, i) => {
          log.checked.push(`known paths on ${host} (from the crawl)`);
          let hits: KnownPathHit[] = [];
          try {
            // Out of time is a miss, not an error.
            hits =
              (await withDeadline(probe(host, { budgetMs }), budgetMs)) ?? [];
          } catch (error) {
            log.diagnostics.push(`known paths on ${host}: ${message(error)}`);
          }
          out.offHost[i]?.push(
            ...hits.map((hit) => ({
              url: hit.url,
              bytes: hit.bytes,
              sniff: hit.sniff,
              provenance: provenanceOf(hit.url, choice.vendor, true),
              found: { offHost: true },
            })),
          );
        }),
      );
    }

    /**
     * Of the GitHub orgs the crawl found linked, those whose profile website
     * is on the Vendor's registrable domain, in the crawl's order, at most 3
     * in all, each then counting as the Vendor's for Provenance.
     */
    async function verifiedOrgs(
      linked: string[],
      log: SourceLog,
    ): Promise<string[]> {
      const vendorDomain =
        registrableDomain(choice.vendor.domain) ?? choice.vendor.domain;
      for (const org of linked) {
        if (!github || vendorOrgs.size >= MAX_VERIFIED_ORGS) break;
        let website: string | null;
        try {
          website = await github.orgWebsite(org);
        } catch (error) {
          log.diagnostics.push(`GitHub org ${org}: ${message(error)}`);
          continue;
        }
        if (website !== null && websiteDomain(website) === vendorDomain)
          vendorOrgs.add(org);
      }
      return [...vendorOrgs];
    }

    /**
     * Searches GitHub for Spec files in the Vendor's orgs: at once in the
     * Vendor id's first label, as APIs.guru names no org, or across GitHub
     * by the API's name when it has none, and fetches the likeliest; then,
     * as an extra once the crawl has reported them, in the orgs it found
     * linked (`verifiedOrgs`) not searched yet. The trees of each org's Spec
     * repos (those with hits, or found by repo search) add the files code
     * search can't index. An org GitHub says doesn't exist gets a diagnostic
     * of its own, not a failed search's. Hits are fetched as origins, so
     * archived repos are skipped and `HEAD` becomes the default branch.
     */
    async function gatherGitHub(
      search: GitHubCodeSearch,
      log: SourceLog,
      out: GitHubGathered[],
      crawledGitHubOrgs: Promise<string[]>,
    ) {
      /** The hits, or `null` after one diagnostic when the search can't run. */
      const searchSpecs = async (org: string | null) => {
        let hits: SpecHit[] | null;
        try {
          hits = await search.searchSpecs(org, choice.api.name);
        } catch (error) {
          log.diagnostics.push(`GitHub code search: ${message(error)}`);
          return null;
        }
        if (hits === null) log.diagnostics.push(GITHUB_SEARCH_SKIPPED);
        return hits;
      };

      /**
       * The repos to list: those among the org's hits, or, when it had none,
       * the org's repos that look like they hold a Spec. `[]` after one
       * diagnostic when the repo search can't run.
       */
      const reposToList = async (org: string, hits: SpecHit[]) => {
        if (hits.length > 0) return [...new Set(hits.map((h) => h.fullName))];
        let repos: string[] | null;
        try {
          repos = await search.searchSpecRepos(org, choice.api.name);
        } catch (error) {
          log.diagnostics.push(`GitHub repo search: ${message(error)}`);
          return [];
        }
        if (repos === null) log.diagnostics.push(GITHUB_REPO_SEARCH_SKIPPED);
        return repos ?? [];
      };
      /** A repo's Spec-looking files from its tree; `[]` after one diagnostic on failure. */
      const specsInRepo = async (fullName: string) => {
        let files: SpecHit[] | null;
        try {
          files = await search.specsInRepo(fullName);
        } catch (error) {
          log.diagnostics.push(
            `GitHub repo tree ${fullName}: ${message(error)}`,
          );
          return [];
        }
        if (files === null) {
          log.diagnostics.push(
            `GitHub repo tree ${fullName}: skipped (failed)`,
          );
          return [];
        }
        log.checked.push(
          `GitHub repo tree ${fullName} (${files.length} files)`,
        );
        return files;
      };

      const seen = new Set<string>();
      /** The hits not gathered before, recorded as gathered. */
      const unseen = (found: SpecHit[]) =>
        found.filter((hit) => !seen.has(hit.url) && seen.add(hit.url));
      const searched = new Set<string>();
      /**
       * Each org's hits and its Spec repos' tree files, for the orgs not
       * searched yet; `null` when a search can't run.
       */
      const searchOrgs = async (orgs: string[]) => {
        const hits: SpecHit[] = [];
        for (const org of orgs) {
          if (searched.has(org.toLowerCase())) continue;
          searched.add(org.toLowerCase());
          const orgHits = await searchSpecs(org);
          if (orgHits === null) return null;
          log.checked.push(
            `GitHub code search in org ${org} (${orgHits.length} hits)`,
          );
          hits.push(...unseen(orgHits));
          // Code search leaves out files it can't index (over its size limit),
          // so the trees of the org's Spec repos are listed as well.
          const repos = (await reposToList(org, orgHits)).slice(
            0,
            MAX_REPO_TREES_LISTED,
          );
          for (const fullName of repos)
            hits.push(...unseen(await specsInRepo(fullName)));
          if (search.missingOrgs().includes(org.toLowerCase()))
            log.diagnostics.push(`GitHub org ${org}: no such org (HTTP 422)`);
        }
        return hits;
      };
      /**
       * The Judge ranks the hits as links, and the likeliest few likely
       * enough are fetched at once, as origins, into `out` after those
       * already there, in rank order: a repo tree lists the right Spec after
       * code search's wrong ones (PagerDuty's Events Specs before its REST
       * Spec). Nothing is judged yet to stop at, hence only a few.
       */
      const fetchRanked = async (hits: SpecHit[]) => {
        if (hits.length === 0) return;
        const links: SpecLink[] = hits.map((hit) => ({
          url: hit.url,
          text: hit.path,
          context: hit.fullName,
        }));
        let probabilities: number[];
        try {
          probabilities = (await judge.areSpecLinks(ref, links)).map(
            (j) => j.probability,
          );
        } catch (error) {
          log.diagnostics.push(`Judge areSpecLinks: ${message(error)}`);
          return;
        }
        const slots: GitHubGathered[] = hits
          .map((hit, i) => ({ hit, p: probabilities[i] ?? 0 }))
          .filter(({ p }) => p >= t.specLink)
          .sort((a, b) => b.p - a.p)
          .slice(0, MAX_GITHUB_SPEC_FETCHES)
          .map(({ hit }) => ({ hitUrl: hit.url }));
        out.push(...slots);
        await Promise.all(
          slots.map(async (slot) => {
            const spec = await fetchOrigin(slot.hitUrl, log);
            if (spec) slot.spec = spec;
          }),
        );
      };

      // The org known up front, without waiting for the crawl.
      let hits = await searchOrgs([vendorLabel(choice.vendor)]);
      if (hits === null) return;
      if (hits.length === 0) {
        const global = await searchSpecs(null);
        if (global === null) return;
        log.checked.push(
          `GitHub code search for "${choice.api.name}" (${global.length} hits)`,
        );
        hits = unseen(global);
      }
      await fetchRanked(hits);

      // The orgs the crawl found, an extra when it reports them in time.
      const linked = await crawledGitHubOrgs;
      const extra = await searchOrgs(await verifiedOrgs(linked, log));
      if (extra) await fetchRanked(extra);
    }

    /**
     * The known-path probe, the crawl and GitHub code search, gathering at
     * once within the Spec step's deadline, each judged as soon as it and
     * those before it have ended, in the order they ran in one after another.
     * Once settled, the Sources after are not waited for. What a Source had
     * gathered by the deadline is judged, the rest is dropped.
     */
    async function gatherAndJudge() {
      const startedAt = Date.now();
      const endsAt = startedAt + specStepBudgetMs;
      /**
       * What is left for a Source bounded by a budget of its own, less a
       * margin so it returns what it has before the deadline drops it;
       * `undefined` without a deadline.
       */
      const budget = () =>
        Number.isFinite(endsAt)
          ? Math.max(
              0,
              endsAt -
                Date.now() -
                Math.min(SELF_BOUNDED_MARGIN_MS, specStepBudgetMs / 10),
            )
          : undefined;

      const known = gathering<Gathered[]>([]);
      const crawled = gathering<CrawlGathered>({ hits: [], offHost: [] });
      const githubHits = gathering<GitHubGathered[]>([]);
      let orgsFound: (orgs: string[]) => void = () => {};
      const crawledGitHubOrgs = new Promise<string[]>((resolve) => {
        orgsFound = resolve;
      });

      const running = new Set<LookupStep>();
      /** When the deadline passed, in ms from the start. */
      let deadlineAfter: number | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        if (!Number.isFinite(endsAt)) return;
        timer = setTimeout(() => {
          deadlineAfter = Date.now() - startedAt;
          resolve();
        }, specStepBudgetMs);
      });
      /** Resolves once the Spec step stops waiting on the Sources. */
      let stopWaiting: () => void = () => {};
      const stopped = new Promise<void>((resolve) => {
        stopWaiting = resolve;
      });
      /**
       * Starts a Source's gather, timed until it ends, the deadline passes
       * or the Spec step stops waiting; a Source's error is its diagnostic.
       */
      const start = (
        step: LookupStep,
        log: SourceLog,
        gather: () => Promise<void>,
      ) => {
        running.add(step);
        const done = gather()
          .catch((error) => {
            log.diagnostics.push(`${step}: ${message(error)}`);
          })
          .finally(() => running.delete(step));
        return timed(step, () => Promise.race([done, deadline, stopped]));
      };

      const knownDone = start("known paths", known.log, () =>
        gatherKnownPaths(known.log, known.out, budget()),
      );
      const crawlDone = start("Developer Portal crawl", crawled.log, () =>
        gatherCrawl(crawled.log, crawled.out, budget, orgsFound),
      );
      const githubDone = githubSearch
        ? start("GitHub code search", githubHits.log, () =>
            gatherGitHub(
              githubSearch,
              githubHits.log,
              githubHits.out,
              crawledGitHubOrgs,
            ),
          )
        : undefined;

      /** The Sources the deadline stopped while they were waited for. */
      const cut: LookupStep[] = [];
      /**
       * Waits for a Source, then takes what it gathered and its log: a
       * Source still running writes on, to nothing read.
       */
      const wait = async <T>(
        step: LookupStep,
        done: Promise<unknown>,
        source: { log: SourceLog; out: T },
        copy: (out: T) => T,
      ): Promise<T> => {
        await done;
        if (running.has(step)) cut.push(step);
        const log = copyLog(source.log);
        checked.push(...log.checked);
        diagnostics.push(...log.diagnostics);
        for (const [url, specId] of log.served) served.set(url, specId);
        return copy(source.out);
      };
      const judging = <T>(fn: () => Promise<T>) => timed("Spec judging", fn);

      try {
        const knownHits = await wait("known paths", knownDone, known, (o) => [
          ...o,
        ]);
        // Every hit, even once settled: the bytes are in hand, and a stale
        // copy on one host (docs.) may answer before the current Spec on
        // another.
        await judging(async () => {
          for (const g of knownHits) await judgeGathered(g);
        });
        if (settled()) return;

        const crawl = await wait(
          "Developer Portal crawl",
          crawlDone,
          crawled,
          (o) => ({
            hits: [...o.hits],
            offHost: o.offHost.map((hits) => [...hits]),
          }),
        );
        await judging(async () => {
          // Every crawl hit too: the Judge's link scores, which set the
          // order, vary between calls. Skipped once settled, a full Spec
          // after its per-version add-on never reached the pool (WTR-95).
          for (const g of crawl.hits) await judgeGathered(g);
          for (const hits of crawl.offHost) {
            if (settled()) return;
            for (const g of hits) if (goOn(g.url)) await judgeGathered(g);
          }
        });
        if (settled() || !githubDone) return;

        const slots = await wait(
          "GitHub code search",
          githubDone,
          githubHits,
          (o) => o.map((slot) => ({ ...slot })),
        );
        await judging(async () => {
          // Its Provenance as of now: an org the crawl reported may have
          // been verified as the Vendor's after the hit was fetched.
          for (const { hitUrl, spec } of slots)
            if (spec && goOn(hitUrl))
              await judgeGathered({
                ...spec,
                provenance: provenanceOf(
                  spec.url,
                  choice.vendor,
                  false,
                  spec.githubOrg,
                  vendorOrgs,
                ),
              });
        });
      } finally {
        stopWaiting();
        clearTimeout(timer);
        if (cut.length > 0)
          diagnostics.push(
            `spec step deadline: ${cut.join(", ")} stopped after ${deadlineAfter ?? Date.now() - startedAt} ms`,
          );
      }
    }

    /**
     * A Spec the Caller may be answered with: the API Version asked for, or,
     * when none was, any but a Preview Version.
     */
    const wanted = (c: SpecCandidate) =>
      apiVersion === undefined ? !c.isPreview : c.apiVersion === apiVersion;
    /**
     * Settled once a wanted Spec from the Vendor or linked by it describes
     * the API, and its URL names no API Version: a Spec whose URL does may
     * be a per-version add-on (Box's 24-path `openapi-v2025.0.json` on
     * GitHub, judged before the crawl brought `box-openapi.json`), so later
     * Sources are still waited for and judged. When none comes in time,
     * `answer` weighs such Specs as ever.
     */
    const confirming = (c: SpecCandidate) =>
      isVendorBacked(c.provenance) && c.probability >= t.describes && wanted(c);
    const settled = () =>
      candidates.some((c) => confirming(c) && !urlNamesApiVersion(c.url));
    /**
     * Whether a step goes on to its next Source. Once settled, it still takes
     * those whose URL names an API Version (`openapi-v2026.0.json` beside
     * `openapi-v2025.0.json`), which may be Alternates; later steps don't run.
     */
    const goOn = (url: string) => !settled() || urlNamesApiVersion(url);

    if (choice.originUrls.length > 0)
      await timed("Spec fetch", async () => {
        for (const [i, url] of choice.originUrls.entries()) {
          if (!goOn(url)) continue;
          originIndex = i;
          const spec = await fetchOrigin(url, lookupLog);
          if (spec) await judgeGathered(spec);
        }
      });
    originIndex = undefined;
    if (!settled()) await gatherAndJudge();
    const { mirrorUrl } = choice;
    // The mirror never answers over a Spec the Vendor backs, add-on or not.
    if (!candidates.some(confirming) && mirrorUrl)
      await timed("Spec fetch", () => fetchAndConsider(mirrorUrl, true));
    // A third-party Source is a Mirror only of bytes the Vendor stands behind;
    // otherwise it is Community.
    const backed = new Set(
      candidates
        .filter((c) => isVendorBacked(c.provenance))
        .map((c) => c.specId),
    );
    for (const c of candidates)
      if (
        c.provenance === "Mirror" &&
        !c.apisGuruMirror &&
        !backed.has(c.specId)
      )
        c.provenance = "Community";

    let current: SpecCandidate | undefined;
    let pool: SpecCandidate[] = [];
    const outcome = answer();
    supersedeUnserved(choice.api.id, served);
    // Unconfirmed already gives what was checked in its reasons.
    if (deps.trace && outcome.outcome !== "Unconfirmed") traceSpecs();
    return { outcome, ...(current ? { current } : {}) };

    /** What was checked, then each Spec found: the pool's first, in order. */
    function traceSpecs(): void {
      if (checked.length > 0)
        diagnostics.push(`checked: ${checked.join("; ")}`);
      const rest = candidates.filter((c) => !pool.includes(c));
      for (const [label, list] of [
        ["pool", pool],
        ["not in pool", rest],
      ] as const)
        for (const c of list)
          diagnostics.push(
            `${label}: ${c.url} (API Version ${c.apiVersion ?? "none"}${c.isPreview ? ", Preview" : ""}, ${c.sniff.extract.pathCount} paths, Judge ${c.probability.toFixed(2)}, ${c.provenance})`,
          );
    }

    function answer(): Outcome {
      // Every Spec that could answer Resolved, one candidate each, in order
      // of preference: Official, then Endorsed, then earliest origin URL (the
      // Judge's probabilities for near-identical Specs vary between calls),
      // then likeliest.
      const byOrigin = (c: SpecCandidate) =>
        originRank.get(c.specId) ?? choice.originUrls.length;
      const describes = candidates.filter((c) => c.probability >= t.describes);
      pool = describes.filter((c) => isVendorBacked(c.provenance));
      if (pool.length === 0 && allowCommunity)
        pool = describes.filter((c) => c.provenance === "Community");
      pool = uniqueSpecs(
        [...pool].sort(
          (a, b) =>
            tierRank(a.provenance) - tierRank(b.provenance) ||
            byOrigin(a) - byOrigin(b) ||
            b.probability - a.probability,
        ),
      );
      const stored = store(
        name,
        choice,
        pool,
        candidates,
        true,
        remember,
        originRank,
      );
      const storedOf = (c: SpecCandidate) =>
        stored[pool.indexOf(c)] as StoredSpec;

      if (apiVersion !== undefined) {
        const chosen = pool.find((c) => c.apiVersion === apiVersion);
        current = chosen;
        if (chosen)
          return resolved(
            choice.api,
            choice.vendor,
            storedOf(chosen),
            otherVersions(chosen, pool, (c) => c).map((c) => storedOf(c).spec),
          );
      } else {
        const picked = currentAndFull(pool, rankingOf);
        current = picked?.current;
        if (picked)
          return resolved(
            choice.api,
            choice.vendor,
            storedOf(picked.current),
            picked.alternates.map((c) => storedOf(c).spec),
          );
      }
      if (pool.length > 0) diagnostics.push(versionsDiagnostic(pool));

      // The Vendor's own copy is preferred to a likelier third-party one.
      const doubtful = candidates.filter((c) => c.probability >= t.doubt);
      const allowed = doubtful.filter(
        (c) =>
          wanted(c) &&
          !pool.some((p) => p.specId === c.specId) &&
          (allowCommunity || c.provenance !== "Community"),
      );
      const pick =
        best(allowed.filter((c) => c.provenance === "Official")) ??
        best(allowed.filter((c) => c.provenance === "Endorsed")) ??
        best(allowed);
      if (pick) {
        const [unconfirmed] = store(
          name,
          choice,
          [pick],
          candidates,
          false,
          remember,
          originRank,
        );
        if (!unconfirmed) throw new Error("store returned no Spec");
        const reasons: string[] = [];
        if (pick.provenance === "Community")
          reasons.push("only a Community Spec found");
        else if (pick.provenance === "Mirror")
          reasons.push("only a third-party copy found");
        reasons.push(
          `the Judge gave ${pick.probability.toFixed(2)} that the Spec at ${pick.url} describes ${choice.api.name}; Resolved needs ${t.describes} from an Official or Endorsed Source`,
          `checked: ${checked.join("; ")}`,
        );
        return {
          outcome: "Unconfirmed",
          api: choice.api,
          vendor: choice.vendor,
          spec: unconfirmed.spec,
          sources: unconfirmed.sources,
          reasons,
          verifiedAt: now().toISOString(),
        };
      }

      // A Spec the Judge could not weigh may still exist: don't claim No Spec.
      if (judgeFailed) return { outcome: "Unknown", name };
      return {
        outcome: "NoSpec",
        api: choice.api,
        vendor: choice.vendor,
        communityAvailable: doubtful.some((c) => c.provenance === "Community"),
      };
    }

    /** What the pool had instead of what was asked for. */
    function versionsDiagnostic(pool: SpecCandidate[]): string {
      const found = pool
        .map(
          (c) =>
            `${c.apiVersion ?? "no API Version"}${c.isPreview ? " (Preview)" : ""}`,
        )
        .join(", ");
      return apiVersion === undefined
        ? `only Preview Versions found: ${found}`
        : `no Spec for API Version ${apiVersion}; found: ${found}`;
    }
  }

  /**
   * Stores the Vendor, API, each Spec with its API Version, and every Source
   * it was found at, with what `currentAndFull` ranks it by, and remembers
   * the name; returns the Specs as stored, in order. Only Specs that could
   * answer Resolved are marked confirmed.
   */
  function store(
    name: string,
    choice: ApiChoice,
    picks: SpecCandidate[],
    all: SpecCandidate[],
    confirm: boolean,
    remember: boolean,
    /** Each Spec's earliest origin URL, as its place in `choice.originUrls`. */
    originRank: Map<string, number>,
  ): StoredSpec[] {
    if (picks.length === 0) return [];
    const at = now().toISOString();
    repo.upsertVendor(choice.vendor);
    repo.upsertApi(choice.api);
    const stored = picks.map((pick) => {
      const spec = repo.putSpec(choice.api.id, pick.bytes, {
        specVersion: pick.sniff.specVersion,
        apiVersion: pick.apiVersion,
        isPreview: pick.isPreview,
        format: pick.sniff.format,
        pathCount: rankingOf(pick).pathCount,
        deprecated: rankingOf(pick).deprecated,
        originRank: originRank.get(pick.specId) ?? null,
      });
      if (confirm) repo.confirmSpec(spec.id, at);
      const sources = [pick, ...all.filter((c) => c !== pick)]
        .filter((c) => c.specId === spec.id)
        .map((c) => repo.addSource(spec.id, c.url, c.provenance, at));
      return { spec, sources };
    });
    if (remember) repo.rememberName(name, choice.api.id);
    return stored;
  }

  /**
   * Marks Superseded each stored Spec of the API whose every Source was seen
   * in this Lookup serving another Spec or none. A Source not fetched this
   * time, or unreachable, may still serve it.
   */
  function supersedeUnserved(
    apiId: string,
    served: Map<string, string | null>,
  ): void {
    if (served.size === 0) return;
    const stored = repo.getApiWithSpecs(apiId);
    if (!stored) return;
    const at = now().toISOString();
    for (const { spec, sources } of stored.specs) {
      if (spec.supersededAt !== null || sources.length === 0) continue;
      const gone = sources.every(
        (src) => served.has(src.url) && served.get(src.url) !== spec.id,
      );
      if (gone) repo.supersedeSpec(spec.id, at);
    }
  }
}

type StoredSpec = { spec: Spec; sources: Source[] };

/**
 * The other live, non-Preview API Versions beside a Spec the Caller chose by
 * its API Version: the Current Spec and Alternates of the rest, less any of
 * the chosen one's API Version.
 */
function otherVersions<T>(
  chosen: T,
  specs: T[],
  versionOf: (spec: T) => ApiVersionOf,
): T[] {
  const picked = currentAndAlternates(
    specs.filter(
      (s) =>
        s !== chosen &&
        versionOf(s).apiVersion !== versionOf(chosen).apiVersion,
    ),
    versionOf,
  );
  return picked ? [picked.current, ...picked.alternates] : [];
}

/** What `currentAndFull` ranks a Spec by. */
type Ranking = ApiVersionOf & {
  /** null when unknown: never partial, and never the largest. */
  pathCount: number | null;
  deprecated: boolean;
};

/** A fetched Spec's `Ranking`; `store` keeps it in the Index. */
function rankingOf(c: SpecCandidate): Ranking {
  return {
    apiVersion: c.apiVersion,
    isPreview: c.isPreview,
    pathCount: c.sniff.extract.pathCount,
    deprecated: isDeprecated(c),
  };
}

/**
 * `currentAndAlternates`, except for two kinds of Spec not taken as Current;
 * either may still be an Alternate. The one rule for the Current Spec, from
 * Discovery (`answer`) and from the Index (`answerFromIndex`): `pool` comes in
 * order of preference for ties, and `of` reads what each Spec is ranked by.
 *
 * - Partial: under `PARTIAL_SPEC_RATIO` of the pool's largest path count, a
 *   versioned add-on file (Box's `openapi-v2026.0.json`) beside the full
 *   Spec. A Spec with no paths, or an unknown path count, is ranked as before.
 * - Deprecated: its Vendor says so in its title or description (Novu's
 *   `api-json`, "DEPRECATED: Novu API. Use /openapi.{json,yaml} instead.").
 *   When every Spec is deprecated, they are ranked as before.
 */
function currentAndFull<T>(
  pool: T[],
  of: (spec: T) => Ranking,
): { current: T; alternates: T[] } | null {
  const paths = (x: T) => of(x).pathCount ?? 0;
  const most = Math.max(0, ...pool.map(paths));
  const partial = (x: T) =>
    paths(x) > 0 && paths(x) < PARTIAL_SPEC_RATIO * most;
  const deprecated = (x: T) => of(x).deprecated;
  const eligible = pool.every(deprecated)
    ? pool
    : pool.filter((x) => !deprecated(x));
  if (eligible.length === pool.length && !pool.some(partial))
    return currentAndAlternates(pool, of);
  const picked =
    currentAndAlternates(
      eligible.filter((x) => !partial(x)),
      of,
    ) ??
    currentAndAlternates(eligible, of) ??
    currentAndAlternates(pool, of);
  if (!picked) return null;
  const others = otherVersions(
    picked.current,
    pool.filter((x) => of(x).apiVersion !== null),
    of,
  );
  return { current: picked.current, alternates: others };
}

/** How far into a Spec's title or description a deprecation notice counts. */
const DEPRECATION_NOTICE_CHARS = 80;

/** The Vendor marks the Spec deprecated at the start of its title or description. */
function isDeprecated(c: SpecCandidate): boolean {
  const { title, description } = c.sniff.extract;
  return [title, description].some(
    (text) =>
      text !== null &&
      /\bdeprecated\b/i.test(text.slice(0, DEPRECATION_NOTICE_CHARS)),
  );
}

/** The first candidate for each Spec id. */
function uniqueSpecs(candidates: SpecCandidate[]): SpecCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => !seen.has(c.specId) && seen.add(c.specId));
}

/** Official first. */
function tierRank(provenance: Provenance): number {
  return PROVENANCE_TIERS.indexOf(provenance);
}

/**
 * Resolved with a confirmed Spec, at its best Provenance; `verifiedAt` is
 * that of its Sources at that tier.
 */
function resolved(
  api: Api,
  vendor: Vendor,
  stored: StoredSpec,
  alternateSpecs: Spec[] = [],
): Outcome {
  const provenance =
    bestProvenance(stored.sources.map((s) => s.provenance)) ?? "Official";
  const verifiedAt =
    stored.sources
      .filter((s) => s.provenance === provenance)
      .map((s) => s.lastVerifiedAt)
      .sort()
      .at(-1) ?? "";
  return {
    outcome: "Resolved",
    api,
    vendor,
    currentSpec: stored.spec,
    alternateSpecs,
    provenance,
    sources: stored.sources,
    validityIssues: [],
    verifiedAt,
  };
}

/** The likeliest candidate; ties go to the first found. */
function best(candidates: SpecCandidate[]): SpecCandidate | undefined {
  let top: SpecCandidate | undefined;
  for (const c of candidates)
    if (!top || c.probability > top.probability) top = c;
  return top;
}

/**
 * A Source's Provenance by where it is: Official when its registrable domain
 * is the Vendor's, or it sits in the Vendor's GitHub org; else Endorsed when
 * it was reached by a link from a page on the Vendor's domain; else Mirror.
 * `findSpec` makes a Mirror Community when no Official or Endorsed Source has
 * its bytes. `currentOrg` replaces the org in a GitHub URL whose repo has
 * moved since. The Vendor's GitHub org is the first label of its id, or one
 * of `vendorOrgs` (lowercased), those whose profile website is the Vendor's.
 */
export function provenanceOf(
  url: string,
  vendor: Vendor,
  linkedFromVendor: boolean,
  currentOrg?: string,
  vendorOrgs: ReadonlySet<string> = new Set(),
): Provenance {
  const domain = registrableDomain(url);
  const vendorDomain = registrableDomain(vendor.domain) ?? vendor.domain;
  if (domain !== null && domain === vendorDomain) return "Official";
  let org = githubOrg(url);
  if (org !== null && currentOrg) org = currentOrg.toLowerCase();
  if (org !== null && (org === vendorLabel(vendor) || vendorOrgs.has(org)))
    return "Official";
  return linkedFromVendor ? "Endorsed" : "Mirror";
}

/** Official or Endorsed: a Provenance that can answer Resolved by default. */
function isVendorBacked(provenance: Provenance): boolean {
  return provenance === "Official" || provenance === "Endorsed";
}

/**
 * The GitHub org a URL sits in (`github.com/<org>/…`,
 * `raw.githubusercontent.com/<org>/…`, `<org>.github.io`), lowercased.
 */
function githubOrg(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith(".github.io")) return host.slice(0, -".github.io".length);
  if (host === "github.com" || host === "raw.githubusercontent.com")
    return parsed.pathname.split("/")[1]?.toLowerCase() || null;
  return null;
}

/**
 * APIs.guru names no GitHub org, so the Vendor's is taken to be the first
 * label of its id (`stripe` for `stripe.com`).
 */
function vendorLabel(vendor: Vendor): string {
  return vendor.id.split(".")[0] ?? vendor.id;
}

/**
 * The registrable domain of a GitHub profile's website, written with or
 * without its scheme (`slack.com`, `https://www.render.com/`).
 */
function websiteDomain(website: string): string | null {
  return registrableDomain(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`,
  );
}

/** `google` names `google` and `googleapis`/`googleapi`. */
function isUmbrellaLabel(query: string, label: string): boolean {
  return (
    label === query ||
    (label.startsWith(query) &&
      ["apis", "api"].includes(label.slice(query.length)))
  );
}

/**
 * APIs.guru Candidates as choices, one per Vendor and title: APIs.guru lists
 * deployment variants and versions of one API as separate entries (twenty
 * "GitHub v3 REST API"s), which `whichApi` could only call Ambiguous. A
 * group's choice is its entry without a `:` suffix in the key, else its
 * first. Its origin URLs are its own, then those of the group that sit in
 * the same directory as one of its own: GitHub's `api.github.com/` files, not
 * `ghec/` or `ghes-3.8/`, other deployments' Specs of the same version.
 * Different titles are never merged.
 */
function mergeGuruChoices(candidates: ApiCandidate[]): ApiChoice[] {
  const groups = new Map<string, ApiCandidate[]>();
  for (const c of candidates) {
    const id = `${c.vendor.id}\n${c.name}`;
    const group = groups.get(id);
    if (group) group.push(c);
    else groups.set(id, [c]);
  }
  return [...groups.values()].map((group) => {
    const representative =
      group.find((c) => !c.key.includes(":")) ?? (group[0] as ApiCandidate);
    const dirs = new Set(representative.originUrls.map(originDirectory));
    const originUrls = [
      ...new Set([
        ...representative.originUrls,
        ...group
          .flatMap((c) => c.originUrls)
          .filter((url) => dirs.has(originDirectory(url))),
      ]),
    ];
    return {
      ...fromApisGuru(representative),
      originUrls: originUrls.slice(0, MAX_MERGED_ORIGIN_URLS),
    };
  });
}

/** A URL up to and including its path's last `/`. */
function originDirectory(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  return path.slice(0, path.lastIndexOf("/") + 1);
}

function fromApisGuru(c: ApiCandidate): ApiChoice {
  return {
    api: { id: c.apiId, vendorId: c.vendor.id, name: c.name },
    vendor: c.vendor,
    ...(c.description ? { description: c.description } : {}),
    originUrls: c.originUrls,
    mirrorUrl: c.mirrorUrl,
  };
}

/**
 * Developer Portals as Candidate APIs: one per Vendor, the highest-ranked,
 * leaving out Vendors that APIs.guru already has a Candidate for.
 */
function portalChoices(
  portals: PortalCandidate[],
  guru: ApiChoice[],
): ApiChoice[] {
  const known = new Set(
    guru.flatMap((c) => [
      c.vendor.id,
      registrableDomain(c.vendor.domain) ?? c.vendor.id,
    ]),
  );
  const choices: ApiChoice[] = [];
  for (const p of portals) {
    const choice = fromPortal(p);
    if (!choice || known.has(choice.vendor.id)) continue;
    known.add(choice.vendor.id);
    choices.push(choice);
  }
  return choices;
}

/**
 * A Developer Portal's domain as the Vendor's API, named after the Vendor
 * (`neon.com/api`, "Neon API"), or `null` when no valid ids can be made from it.
 */
function fromPortal(p: PortalCandidate): ApiChoice | null {
  const vendorId = vendorIdFromDomain(p.domain);
  const label = vendorId.split(".")[0] ?? vendorId;
  const brand = label.charAt(0).toUpperCase() + label.slice(1);
  const api = { id: `${vendorId}/api`, vendorId, name: `${brand} API` };
  if (!Api.safeParse(api).success) return null;
  return {
    api,
    vendor: { id: vendorId, name: p.domain, domain: p.domain },
    ...(p.snippet ? { description: p.snippet } : {}),
    originUrls: [],
    portalUrl: p.url,
  };
}

/**
 * An API named on the Vendor's Developer Portal as a Candidate
 * (`mailchimp.com/marketing-api`), or `null` when no valid id can be made
 * from its name.
 */
function fromVendorApiHit(hit: VendorApiHit, vendor: Vendor): ApiChoice | null {
  const api = {
    id: `${vendor.id}/${slugify(hit.name)}`,
    vendorId: vendor.id,
    name: hit.name,
  };
  if (!Api.safeParse(api).success) return null;
  return { api, vendor, originUrls: [], portalUrl: hit.url };
}

function apiRef(c: ApiChoice): ApiRef {
  return {
    id: c.api.id,
    name: c.api.name,
    vendor: c.vendor.name,
    ...(c.description ? { description: c.description } : {}),
  };
}

function ambiguousCandidate(
  c: ApiChoice,
  probability: number,
): AmbiguousCandidate {
  return {
    apiId: c.api.id,
    name: c.api.name,
    vendor: c.vendor.name,
    probability,
  };
}

function uniqueById(choices: ApiChoice[]): ApiChoice[] {
  const seen = new Set<string>();
  return choices.filter((c) => !seen.has(c.api.id) && seen.add(c.api.id));
}

/** `promise`'s value, or `null` once `ms` have passed without one. */
async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The diagnostic for a Spec fetched once despite its host's robots.txt. */
function robotsDiagnostic(url: string): string {
  return `robots.txt on ${new URL(url).host} disallowed ${url}; ADR 0003 allowed the single fetch`;
}
