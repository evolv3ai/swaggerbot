import type { SpecOutline } from "~/fetch/sniff";

export type Coverage = {
  /** Crawled names that match the Spec. */
  matched: number;
  /** Crawled names with a token left once the Vendor's label is dropped. */
  counted: number;
  /** More than half of the counted names match. */
  covered: boolean;
};

/** A Spec token this long or longer also matches a name token it begins. */
const MIN_PREFIX = 4;

/**
 * Whether one Spec covers the API names the Vendor API crawl found: the
 * crawl can return a Vendor's product pages (Plaid's Transfer, Auth,
 * Liabilities…), which are one API with one Spec. A name matches when one of
 * its tokens equals a token of the Spec's first path segments or tag names,
 * or begins with one of at least 4 characters: the crawl joins a product's
 * heading and blurb (`TransferACH, RTP, and FedNow payment processing`).
 * Tokens are lowercase runs of `a-z0-9`; the Vendor's label tokens and
 * `api`/`apis` are dropped from each name, and a name left with none is not
 * counted.
 */
export function crawledNamesCovered(
  names: string[],
  spec: SpecOutline,
  vendorLabel: string,
): Coverage {
  const specTokens = new Set(
    [...spec.firstSegments, ...spec.tags].flatMap(tokens),
  );
  const dropped = new Set(["api", "apis", ...tokens(vendorLabel)]);
  let matched = 0;
  let counted = 0;
  for (const name of names) {
    const own = tokens(name).filter((token) => !dropped.has(token));
    if (own.length === 0) continue;
    counted++;
    if (own.some((token) => matches(token, specTokens))) matched++;
  }
  return { matched, counted, covered: matched * 2 > counted };
}

function matches(token: string, specTokens: Set<string>): boolean {
  if (specTokens.has(token)) return true;
  for (const s of specTokens)
    if (s.length >= MIN_PREFIX && token.startsWith(s)) return true;
  return false;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
