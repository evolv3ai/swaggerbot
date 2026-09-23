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
  DEFAULT_THRESHOLDS,
  PARTIAL_SPEC_RATIO,
  type Thresholds,
} from "./thresholds";

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
   * Accepted and ignored in Slice 1: there is no Verification yet (Slice 3),
   * so an answer from the Index is returned as stored.
   */
  fresh?: boolean;
};

export type Lookup = (request: LookupRequest) => Promise<Outcome>;

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
   * Checks a Vendor's domain for Specs at well-known paths. Defaults to
   * `probeKnownPaths` over https; tests point it at a fixture server.
   */
  probe?: (domain: string, opts: ProbeOptions) => Promise<KnownPathHit[]>;
  /**
   * A shallow crawl of a Developer Portal for Specs. Defaults to
   * `crawlForSpecs` with this Lookup's fetcher and Judge; tests inject a fake.
   */
  crawl?: (opts: { startUrl: string; api: ApiRef }) => Promise<CrawlResult>;
  /**
   * A shallow crawl of a Developer Portal for the Vendor's APIs. Defaults to
   * `crawlForVendorApis` with this Lookup's fetcher and Judge; tests inject a
   * fake.
   */
  vendorCrawl?: (opts: {
    startUrl: string;
    vendor: VendorRef;
  }) => Promise<VendorApiHit[]>;
  /**
   * Checks the repo behind a raw.githubusercontent.com origin URL: archived
   * repos are skipped, non-default branches rewritten. Absent, such URLs are
   * fetched as they are.
   */
  github?: GitHubRepos;
  /**
   * GitHub code search for Spec files in the Vendor's org, then across
   * GitHub. Absent (no `GITHUB_TOKEN`), the step is skipped.
   */
  githubSearch?: GitHubCodeSearch;
};

/**
 * The crawl step's budget: the crawl's own 20 s, and the known-path probes
 * on the off-host domains it reports share what is left of it.
 */
const CRAWL_STEP_BUDGET_MS = 20_000;

/** The diagnostic when GitHub code search answers `null`, which gives no reason. */
const GITHUB_SEARCH_SKIPPED =
  "GitHub code search: skipped (no GITHUB_TOKEN, rate-limited or failed)";

/** The diagnostic when GitHub repo search answers `null`, which gives no reason. */
const GITHUB_REPO_SEARCH_SKIPPED =
  "GitHub repo search: skipped (no GITHUB_TOKEN, rate-limited or failed)";

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

/**
 * The Lookup pipeline: turns a name into an Outcome. The Source chain runs in
 * order and stops once the Outcome is settled:
 *
 * 1. the Index, for a name already resolved;
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
 *    when it names another), then known paths on the Vendor's domain, then
 *    a shallow crawl of the Developer Portal and known paths on the other
 *    domains it links to, then GitHub code search in the Vendor's orgs or
 *    else across GitHub, then the APIs.guru mirror.
 *
 * A Judge, search or fetch error skips that step and is reported in
 * `diagnostics`; it never makes the Lookup throw.
 */
export function createLookup(deps: LookupDeps): Lookup {
  const { judge, fetcher, webSearch, apisGuru, github, githubSearch } = deps;
  const repo = createRepo(deps.db);
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...deps.thresholds };
  const now = deps.now ?? (() => new Date());
  const probe =
    deps.probe ??
    ((domain: string, opts: ProbeOptions) =>
      probeKnownPaths(domain, fetcher, opts));
  const crawl =
    deps.crawl ??
    ((opts: { startUrl: string; api: ApiRef }) =>
      crawlForSpecs({ ...opts, fetcher, judge }));
  const vendorCrawl =
    deps.vendorCrawl ??
    ((opts: { startUrl: string; vendor: VendorRef }) =>
      crawlForVendorApis({ ...opts, fetcher, judge }));

  return async function lookup({ name, apiVersion, allowCommunity = false }) {
    const diagnostics: string[] = [];
    const finish = (outcome: Outcome): Outcome =>
      diagnostics.length > 0 ? { ...outcome, diagnostics } : outcome;

    // 1. The Index.
    const indexed = answerFromIndex(name, allowCommunity, apiVersion);
    if (indexed) return indexed;

    // 2. APIs.guru.
    let guru: ApiChoice[] = [];
    try {
      guru = mergeGuruChoices(await apisGuru.findCandidates(name));
    } catch (error) {
      diagnostics.push(`APIs.guru: ${message(error)}`);
    }

    const umbrella = umbrellaCandidates(name, guru);
    if (umbrella) return finish({ outcome: "Ambiguous", candidates: umbrella });

    let verdict: Verdict | null =
      guru.length > 0 ? await whichApi(name, guru, diagnostics) : null;

    // 3. Developer Portal, when step 2 settled nothing.
    if ((!verdict || verdict.kind === "unknown") && webSearch) {
      let portals: PortalCandidate[] = [];
      try {
        portals = await findPortalCandidates(name, webSearch);
      } catch (error) {
        diagnostics.push(`web search: ${message(error)}`);
      }
      const all = uniqueById([
        ...guru,
        ...portalChoices(await followPortals(portals, diagnostics), guru),
      ]);
      if (all.length > guru.length) {
        verdict = (await whichApi(name, all, diagnostics)) ?? verdict;
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
      const vendorApis = await vendorCandidates(name, top, diagnostics);
      if (vendorApis?.crawled && verdict?.kind === "identified")
        return finish(
          await vendorOrSpec(
            name,
            verdict.choice,
            vendorApis.candidates,
            { allowCommunity, apiVersion },
            diagnostics,
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
    );
    return finish(found.outcome);
  };

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
  ): Promise<{ candidates: AmbiguousCandidate[]; crawled: boolean } | null> {
    const { vendor } = top;
    let members: ApiChoice[] = [];
    try {
      members = mergeGuruChoices(await apisGuru.findVendorApis(vendor.id));
    } catch (error) {
      diagnostics.push(`APIs.guru: ${message(error)}`);
    }
    let probability: number;
    try {
      ({ probability } = await judge.isVendorName(name, {
        id: vendor.id,
        name: vendor.name,
      }));
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
        hits = await vendorCrawl({
          startUrl,
          vendor: { id: vendor.id, name: vendor.name },
        });
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
    /** The GitHub orgs the crawl found the Vendor's pages linking to. */
    let crawledGitHubOrgs: string[] = [];
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

    /**
     * Fetches a URL and considers the Spec there; `false` when none was found.
     * `githubOrg` is the GitHub org the URL's repo is in now, after a move.
     */
    async function fetchAndConsider(
      url: string,
      mirror: boolean,
      githubOrg?: string,
    ): Promise<boolean> {
      try {
        const res = await fetcher.fetchUrl(url);
        const sniff = sniffSpec(res.bytes, res.contentType);
        if (!sniff) {
          checked.push(`${url} (not a Spec)`);
          served.set(url, null).set(res.finalUrl, null);
          return false;
        }
        checked.push(url);
        served.set(url, specIdOf(res.bytes));
        const provenance = mirror
          ? "Mirror"
          : provenanceOf(
              res.finalUrl,
              choice.vendor,
              false,
              githubOrg,
              vendorOrgs,
            );
        await consider(
          res.finalUrl,
          res.bytes,
          sniff,
          provenance,
          mirror ? { apisGuruMirror: true } : {},
        );
        return true;
      } catch (error) {
        checked.push(`${url} (unreachable)`);
        diagnostics.push(`fetch: ${message(error)}`);
        // Gone, not merely unreachable.
        if (
          error instanceof FetchError &&
          (error.status === 404 || error.status === 410)
        )
          served.set(url, null);
        return false;
      }
    }

    /**
     * An origin URL. On raw.githubusercontent.com its repo is looked up
     * first: an archived repo's Spec is never used, and a URL on another
     * branch is read from the default one, falling back to the URL as given.
     * When GitHub can't say, the URL is fetched as it is.
     */
    async function fetchOrigin(url: string) {
      const raw = parseRawGitHubUrl(url);
      const info =
        raw && github ? await github.repoInfo(raw.owner, raw.repo) : null;
      if (!raw || !info) {
        await fetchAndConsider(url, false);
        return;
      }
      if (info.archived) {
        checked.push(`${url} (archived repo ${info.fullName})`);
        diagnostics.push(`archived repo ${info.fullName}`);
        return;
      }
      const org = info.fullName.split("/")[0]?.toLowerCase();
      if (raw.ref !== info.defaultBranch) {
        const onDefault = rawGitHubUrl(
          url,
          info.fullName,
          info.defaultBranch,
          raw.path,
        );
        if (await fetchAndConsider(onDefault, false, org)) return;
      }
      await fetchAndConsider(url, false, org);
    }

    /**
     * Crawls the Developer Portal, then probes known paths on the other
     * domains it links to, stopping once settled. Hits on the portal's domain
     * come first; those off it were reached by a link from the Vendor's pages,
     * so are Endorsed.
     */
    async function crawlStep() {
      const deadline = Date.now() + CRAWL_STEP_BUDGET_MS;
      const startUrl = choice.portalUrl ?? `https://${choice.vendor.domain}`;
      let result: CrawlResult = { hits: [], offHostHosts: [], githubOrgs: [] };
      try {
        result = await crawl({ startUrl, api: ref });
      } catch (error) {
        diagnostics.push(`crawl: ${message(error)}`);
      }
      crawledGitHubOrgs = result.githubOrgs;
      checked.push(`crawl from ${startUrl} (${result.hits.length} found)`);
      const hits = [
        ...result.hits.filter((hit) => !hit.offHost),
        ...result.hits.filter((hit) => hit.offHost),
      ];
      for (const hit of hits) {
        if (!goOn(hit.url)) continue;
        if (hit.robotsDisallowed) diagnostics.push(robotsDiagnostic(hit.url));
        await consider(
          hit.url,
          hit.bytes,
          hit.sniff,
          provenanceOf(hit.url, choice.vendor, true),
          { offHost: hit.offHost, robotsDisallowed: hit.robotsDisallowed },
        );
      }

      const vendorDomain =
        registrableDomain(choice.vendor.domain) ?? choice.vendor.domain;
      for (const host of result.offHostHosts) {
        if (settled()) return;
        // The Vendor's own domain was probed in the step before.
        if (host === vendorDomain) continue;
        const budgetMs = deadline - Date.now();
        if (budgetMs <= 0) break;
        checked.push(`known paths on ${host} (from the crawl)`);
        let hits: KnownPathHit[] = [];
        try {
          // Out of time is a miss, not an error.
          hits =
            (await withDeadline(probe(host, { budgetMs }), budgetMs)) ?? [];
        } catch (error) {
          diagnostics.push(`known paths on ${host}: ${message(error)}`);
        }
        for (const hit of hits) {
          if (!goOn(hit.url)) continue;
          await consider(
            hit.url,
            hit.bytes,
            hit.sniff,
            provenanceOf(hit.url, choice.vendor, true),
            { offHost: true },
          );
        }
      }
    }

    /**
     * The GitHub orgs to search: those the crawl found linked whose profile
     * website is on the Vendor's registrable domain, in the crawl's order, at
     * most 3, each then counting as the Vendor's for Provenance; else the
     * Vendor id's first label, as APIs.guru names no org.
     */
    async function orgsToSearch(): Promise<string[]> {
      const vendorDomain =
        registrableDomain(choice.vendor.domain) ?? choice.vendor.domain;
      for (const org of crawledGitHubOrgs) {
        if (!github || vendorOrgs.size >= MAX_VERIFIED_ORGS) break;
        let website: string | null;
        try {
          website = await github.orgWebsite(org);
        } catch (error) {
          diagnostics.push(`GitHub org ${org}: ${message(error)}`);
          continue;
        }
        if (website !== null && websiteDomain(website) === vendorDomain)
          vendorOrgs.add(org);
      }
      return vendorOrgs.size > 0
        ? [...vendorOrgs]
        : [vendorLabel(choice.vendor)];
    }

    /**
     * Searches GitHub for Spec files in the Vendor's orgs (`orgsToSearch`),
     * or across GitHub by the API's name when they have none. The trees of
     * each org's Spec repos (those with hits, or found by repo search) add the
     * files code search can't index. An org GitHub says doesn't exist gets a
     * diagnostic of its own, not a failed search's. The Judge ranks the hits as links first; those likely enough are fetched
     * as origins, so archived repos are skipped and `HEAD` becomes the
     * default branch. Stops once settled.
     */
    async function githubSearchStep(search: GitHubCodeSearch) {
      /** The hits, or `null` after one diagnostic when the search can't run. */
      const searchSpecs = async (org: string | null) => {
        let hits: SpecHit[] | null;
        try {
          hits = await search.searchSpecs(org, choice.api.name);
        } catch (error) {
          diagnostics.push(`GitHub code search: ${message(error)}`);
          return null;
        }
        if (hits === null) diagnostics.push(GITHUB_SEARCH_SKIPPED);
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
          diagnostics.push(`GitHub repo search: ${message(error)}`);
          return [];
        }
        if (repos === null) diagnostics.push(GITHUB_REPO_SEARCH_SKIPPED);
        return repos ?? [];
      };
      /** A repo's Spec-looking files from its tree; `[]` after one diagnostic on failure. */
      const specsInRepo = async (fullName: string) => {
        let files: SpecHit[] | null;
        try {
          files = await search.specsInRepo(fullName);
        } catch (error) {
          diagnostics.push(`GitHub repo tree ${fullName}: ${message(error)}`);
          return [];
        }
        if (files === null) {
          diagnostics.push(`GitHub repo tree ${fullName}: skipped (failed)`);
          return [];
        }
        checked.push(`GitHub repo tree ${fullName} (${files.length} files)`);
        return files;
      };

      let hits: SpecHit[] = [];
      const seen = new Set<string>();
      const add = (found: SpecHit[]) => {
        for (const hit of found) {
          if (seen.has(hit.url)) continue;
          seen.add(hit.url);
          hits.push(hit);
        }
      };
      for (const org of await orgsToSearch()) {
        const orgHits = await searchSpecs(org);
        if (orgHits === null) return;
        checked.push(
          `GitHub code search in org ${org} (${orgHits.length} hits)`,
        );
        add(orgHits);
        // Code search leaves out files it can't index (over its size limit),
        // so the trees of the org's Spec repos are listed as well.
        const repos = (await reposToList(org, orgHits)).slice(
          0,
          MAX_REPO_TREES_LISTED,
        );
        for (const fullName of repos) add(await specsInRepo(fullName));
        if (search.missingOrgs().includes(org.toLowerCase()))
          diagnostics.push(`GitHub org ${org}: no such org (HTTP 422)`);
      }
      if (hits.length === 0) {
        const global = await searchSpecs(null);
        if (global === null) return;
        checked.push(
          `GitHub code search for "${choice.api.name}" (${global.length} hits)`,
        );
        hits = global;
      }
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
        diagnostics.push(`Judge areSpecLinks: ${message(error)}`);
        return;
      }
      // Likeliest first: the first Spec fetched may settle the Lookup, and a
      // repo tree lists the right Spec after code search's wrong ones
      // (PagerDuty's Events Specs before its REST Spec).
      const ranked = hits
        .map((hit, i) => ({ hit, p: probabilities[i] ?? 0 }))
        .filter(({ p }) => p >= t.specLink)
        .sort((a, b) => b.p - a.p);
      for (const { hit } of ranked) {
        if (!goOn(hit.url)) continue;
        await fetchOrigin(hit.url);
      }
    }

    /**
     * A Spec the Caller may be answered with: the API Version asked for, or,
     * when none was, any but a Preview Version.
     */
    const wanted = (c: SpecCandidate) =>
      apiVersion === undefined ? !c.isPreview : c.apiVersion === apiVersion;
    /** The likeliest wanted candidate at `tier` that describes the API. */
    const describing = (tier: Provenance) =>
      best(
        candidates.filter(
          (c) =>
            c.provenance === tier && c.probability >= t.describes && wanted(c),
        ),
      );
    // The Vendor's own Spec wins over one it links to.
    const confirmed = () => describing("Official") ?? describing("Endorsed");
    const settled = () => confirmed() !== undefined;
    /**
     * Whether a step goes on to its next Source. Once settled, it still takes
     * those whose URL names an API Version (`openapi-v2026.0.json` beside
     * `openapi-v2025.0.json`), which may be Alternates; later steps don't run.
     */
    const goOn = (url: string) => !settled() || urlNamesApiVersion(url);

    for (const [i, url] of choice.originUrls.entries()) {
      if (!goOn(url)) continue;
      originIndex = i;
      await fetchOrigin(url);
    }
    originIndex = undefined;
    if (!settled()) {
      let hits: KnownPathHit[] = [];
      try {
        // The Vendor's own domain: ADR 0003 allows a shut host's Spec once.
        hits = await probe(choice.vendor.domain, { allowBlanketRobots: true });
      } catch (error) {
        diagnostics.push(`known paths: ${message(error)}`);
      }
      checked.push(
        `known paths on ${choice.vendor.domain} (${hits.length} found)`,
      );
      // Every hit, even once settled: the bytes are in hand, and a stale copy
      // on one host (docs.) may answer before the current Spec on another.
      for (const hit of hits) {
        if (hit.robotsDisallowed) diagnostics.push(robotsDiagnostic(hit.url));
        await consider(
          hit.url,
          hit.bytes,
          hit.sniff,
          provenanceOf(hit.url, choice.vendor, false),
          { robotsDisallowed: hit.robotsDisallowed },
        );
      }
    }
    if (!settled()) await crawlStep();
    if (!settled() && githubSearch) await githubSearchStep(githubSearch);
    if (!settled() && choice.mirrorUrl)
      await fetchAndConsider(choice.mirrorUrl, true);

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
    const outcome = answer();
    supersedeUnserved(choice.api.id, served);
    return { outcome, ...(current ? { current } : {}) };

    function answer(): Outcome {
      // Every Spec that could answer Resolved, one candidate each, in order
      // of preference: Official, then Endorsed, then earliest origin URL (the
      // Judge's probabilities for near-identical Specs vary between calls),
      // then likeliest.
      const byOrigin = (c: SpecCandidate) =>
        originRank.get(c.specId) ?? choice.originUrls.length;
      const describes = candidates.filter((c) => c.probability >= t.describes);
      let pool = describes.filter((c) => isVendorBacked(c.provenance));
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
