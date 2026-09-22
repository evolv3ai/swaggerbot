import {
  Api,
  apiId,
  type Source,
  type Spec,
  slugify,
  type Vendor,
  vendorIdFromDomain,
} from "~/domain/catalog";
import type { Outcome } from "~/domain/outcome";
import type { Provenance } from "~/domain/provenance";
import type { Fetcher } from "~/fetch/fetcher";
import { type KnownPathHit, probeKnownPaths } from "~/fetch/known-paths";
import { type SniffResult, sniffSpec } from "~/fetch/sniff";
import type { Db } from "~/index-store/db";
import { createRepo, normalizeName, specIdOf } from "~/index-store/repo";
import { type ApiRef, type Judge, NONE } from "~/judge/judge";
import type { ApiCandidate, ApisGuru } from "~/sources/apis-guru";
import { registrableDomain } from "~/sources/domain";
import { findPortalCandidates, type PortalCandidate } from "~/sources/portal";
import type { WebSearch } from "~/sources/web-search";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";

export type LookupRequest = {
  name: string;
  /** Accepted, not yet acted on: API Versions arrive in a later slice. */
  apiVersion?: string;
  /** Accepted, not yet acted on: Community Specs arrive in Slice 2. */
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
  probe?: (domain: string) => Promise<KnownPathHit[]>;
};

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
};

type AmbiguousCandidate = {
  apiId: string;
  name: string;
  vendor: string;
  probability: number;
};

type Verdict =
  | { kind: "unknown" }
  | { kind: "identified"; choice: ApiChoice }
  | { kind: "ambiguous"; candidates: AmbiguousCandidate[] };

/** A fetched Spec for the identified API, with the Judge's answer on it. */
type SpecCandidate = {
  url: string;
  bytes: Uint8Array;
  specId: string;
  sniff: SniffResult;
  provenance: Provenance;
  /** `specDescribesApi`. */
  probability: number;
};

/**
 * The Lookup pipeline: turns a name into an Outcome. The Source chain runs in
 * order and stops once the Outcome is settled:
 *
 * 1. the Index, for a name already resolved;
 * 2. APIs.guru Candidates, judged by `whichApi`;
 * 3. Developer Portal Candidates from web search, judged with step 2's;
 * 4. for the identified API, its Spec: APIs.guru origin URLs, then known
 *    paths on the Vendor's domain, then the APIs.guru mirror.
 *
 * A Judge, search or fetch error skips that step and is reported in
 * `diagnostics`; it never makes the Lookup throw.
 */
export function createLookup(deps: LookupDeps): Lookup {
  const { judge, fetcher, webSearch, apisGuru } = deps;
  const repo = createRepo(deps.db);
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...deps.thresholds };
  const now = deps.now ?? (() => new Date());
  const probe =
    deps.probe ?? ((domain: string) => probeKnownPaths(domain, fetcher));

  return async function lookup({ name }) {
    const diagnostics: string[] = [];
    const finish = (outcome: Outcome): Outcome =>
      diagnostics.length > 0 ? { ...outcome, diagnostics } : outcome;

    // 1. The Index.
    const indexed = answerFromIndex(name);
    if (indexed) return indexed;

    // 2. APIs.guru.
    let guru: ApiChoice[] = [];
    try {
      guru = (await apisGuru.findCandidates(name)).map(fromApisGuru);
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
        ...portals.flatMap((p) => fromPortal(p) ?? []),
      ]);
      if (all.length > guru.length) {
        verdict = (await whichApi(name, all, diagnostics)) ?? verdict;
      }
    }

    if (!verdict || verdict.kind === "unknown")
      return finish({ outcome: "Unknown", name });
    if (verdict.kind === "ambiguous")
      return finish({ outcome: "Ambiguous", candidates: verdict.candidates });

    // 4. The identified API's Spec.
    return finish(await findSpec(name, verdict.choice, diagnostics));
  };

  /** Resolved from a confirmed Spec with an Official Source, if the name is known. */
  function answerFromIndex(name: string): Outcome | null {
    const api = repo.findApiByName(name);
    if (!api) return null;
    const stored = repo.getApiWithSpecs(api.id);
    // Newest confirmed Spec first; an Unconfirmed one never answers Resolved.
    const confirmed = stored?.specs
      .filter((s) => s.confirmedAt !== null)
      .reverse()
      .find((s) => s.sources.some((src) => src.provenance === "Official"));
    if (!stored || !confirmed) return null;
    return resolved(stored.api, stored.vendor, confirmed);
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
    if (p(NONE) >= t.none) return { kind: "unknown" };

    const ranked = choices
      .map((choice) => ({ choice, probability: p(choice.api.id) }))
      .sort((a, b) => b.probability - a.probability);
    const [top, second] = ranked;
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
      return { kind: "unknown" };
    }
    return {
      kind: "ambiguous",
      candidates: listed.map(({ choice, probability }) =>
        ambiguousCandidate(choice, probability),
      ),
    };
  }

  /**
   * A name equal to the first label of a Vendor id (`google` ↔ `google.com`)
   * with two or more of that Vendor's APIs among the Candidates means the
   * Vendor, not one API: Ambiguous without asking `whichApi`, which tends to
   * answer `"none"` for such names.
   */
  function umbrellaCandidates(
    name: string,
    choices: ApiChoice[],
  ): AmbiguousCandidate[] | null {
    const query = normalizeName(name);
    const members = choices
      .filter((c) => c.vendor.id.split(".")[0] === query)
      .slice(0, MAX_UMBRELLA_CANDIDATES);
    if (members.length < 2) return null;
    return members.map((c) => ambiguousCandidate(c, 1 / members.length));
  }

  async function findSpec(
    name: string,
    choice: ApiChoice,
    diagnostics: string[],
  ): Promise<Outcome> {
    const ref = apiRef(choice);
    const candidates: SpecCandidate[] = [];
    const checked: string[] = [];
    let judgeFailed = false;

    async function consider(
      url: string,
      bytes: Uint8Array,
      sniff: SniffResult,
      provenance: Provenance,
    ) {
      if (candidates.some((c) => c.url === url)) return;
      const specId = specIdOf(bytes);
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
      candidates.push({ url, bytes, specId, sniff, provenance, probability });
    }

    async function fetchAndConsider(url: string, mirror: boolean) {
      try {
        const res = await fetcher.fetchUrl(url);
        const sniff = sniffSpec(res.bytes, res.contentType);
        if (!sniff) {
          checked.push(`${url} (not a Spec)`);
          return;
        }
        checked.push(url);
        const provenance = mirror
          ? "Mirror"
          : provenanceOf(res.finalUrl, choice.vendor);
        await consider(res.finalUrl, res.bytes, sniff, provenance);
      } catch (error) {
        checked.push(`${url} (unreachable)`);
        diagnostics.push(`fetch: ${message(error)}`);
      }
    }

    const confirmed = () =>
      best(candidates.filter((c) => c.provenance === "Official"));
    const settled = () => (confirmed()?.probability ?? 0) >= t.describes;

    for (const url of choice.originUrls) {
      await fetchAndConsider(url, false);
      if (settled()) break;
    }
    if (!settled()) {
      let hits: KnownPathHit[] = [];
      try {
        hits = await probe(choice.vendor.domain);
      } catch (error) {
        diagnostics.push(`known paths: ${message(error)}`);
      }
      checked.push(
        `known paths on ${choice.vendor.domain} (${hits.length} found)`,
      );
      for (const hit of hits) {
        await consider(
          hit.url,
          hit.bytes,
          hit.sniff,
          provenanceOf(hit.url, choice.vendor),
        );
        if (settled()) break;
      }
    }
    if (!settled() && choice.mirrorUrl)
      await fetchAndConsider(choice.mirrorUrl, true);

    const official = confirmed();
    if (official && official.probability >= t.describes) {
      const stored = store(name, choice, official, candidates, true);
      return resolved(choice.api, choice.vendor, stored);
    }

    // The Vendor's own copy is preferred to a likelier third-party one.
    const doubtful = candidates.filter((c) => c.probability >= t.doubt);
    const pick =
      best(doubtful.filter((c) => c.provenance === "Official")) ??
      best(doubtful);
    if (pick) {
      const stored = store(name, choice, pick, candidates, false);
      const reasons: string[] = [];
      if (pick.provenance !== "Official")
        reasons.push("only a third-party copy found");
      reasons.push(
        `the Judge gave ${pick.probability.toFixed(2)} that the Spec at ${pick.url} describes ${choice.api.name}; Resolved needs ${t.describes} from an Official Source`,
        `checked: ${checked.join("; ")}`,
      );
      return {
        outcome: "Unconfirmed",
        api: choice.api,
        vendor: choice.vendor,
        spec: stored.spec,
        sources: stored.sources,
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
      communityAvailable: false,
    };
  }

  /**
   * Stores the Vendor, API, Spec and every Source it was found at, and
   * remembers the name. Only a Spec that answers Resolved is marked confirmed.
   */
  function store(
    name: string,
    choice: ApiChoice,
    pick: SpecCandidate,
    all: SpecCandidate[],
    confirm: boolean,
  ) {
    const at = now().toISOString();
    repo.upsertVendor(choice.vendor);
    repo.upsertApi(choice.api);
    const spec = repo.putSpec(choice.api.id, pick.bytes, {
      specVersion: pick.sniff.specVersion,
      apiVersion: null,
      format: pick.sniff.format,
    });
    if (confirm) repo.confirmSpec(spec.id, at);
    const sources = [pick, ...all.filter((c) => c !== pick)]
      .filter((c) => c.specId === spec.id)
      .map((c) => repo.addSource(spec.id, c.url, c.provenance, at));
    repo.rememberName(name, choice.api.id);
    return { spec, sources };
  }
}

/** Resolved with a confirmed Spec; `verifiedAt` is its Official Source's. */
function resolved(
  api: Api,
  vendor: Vendor,
  stored: { spec: Spec; sources: Source[] },
): Outcome {
  const official = stored.sources.filter((s) => s.provenance === "Official");
  const verifiedAt =
    official
      .map((s) => s.lastVerifiedAt)
      .sort()
      .at(-1) ?? "";
  return {
    outcome: "Resolved",
    api,
    vendor,
    currentSpec: stored.spec,
    alternateSpecs: [],
    provenance: "Official",
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
 * Slice 1 Provenance: Official when the Source's registrable domain is the
 * Vendor's, or it sits in the Vendor's GitHub org; any other copy is a Mirror.
 */
export function provenanceOf(url: string, vendor: Vendor): Provenance {
  const domain = registrableDomain(url);
  const vendorDomain = registrableDomain(vendor.domain) ?? vendor.domain;
  if (domain !== null && domain === vendorDomain) return "Official";
  const org = githubOrg(url);
  return org !== null && org === vendorLabel(vendor) ? "Official" : "Mirror";
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
 * A Developer Portal's domain as a Candidate API of the Vendor at that domain,
 * or `null` when no valid ids can be made from it.
 */
function fromPortal(p: PortalCandidate): ApiChoice | null {
  const vendorId = vendorIdFromDomain(p.domain);
  const title = p.title.trim();
  const name = slugify(title) ? title : p.domain;
  const api = { id: apiId(vendorId, name), vendorId, name };
  if (!Api.safeParse(api).success) return null;
  return {
    api,
    vendor: { id: vendorId, name: p.domain, domain: p.domain },
    ...(p.snippet ? { description: p.snippet } : {}),
    originUrls: [],
  };
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
