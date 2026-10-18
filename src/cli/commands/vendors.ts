import type { CliCommand } from "../args";
import { getJson, TIMEOUT_MS } from "../http";
import {
  EXIT,
  renderUnknownVendor,
  renderUsageError,
  renderVendorApis,
  renderVendorMatches,
  renderVendors,
  type VendorApisBody,
  type VendorMatchesBody,
  type VendorsPageBody,
} from "../render";
import { type CommandContext, failed } from "./lookup";

export type VendorsArgs = Extract<CliCommand, { command: "vendors" }>;
export type VendorArgs = Extract<CliCommand, { command: "vendor" }>;

/** Vendors a page when `--all` follows every page: the most the route allows. */
const ALL_PAGE_LIMIT = 200;

/**
 * `swaggerbot vendors [<query>]`: `GET /api/vendors[?query=]`, one page of
 * the Vendors in the Index (the server's 50, or from the hidden `--cursor`),
 * as `renderVendors` shows it; `--all` follows every page. `--json` prints
 * the server's body unchanged, one line a page. Exit 1 for a failed request
 * (`EXIT`).
 */
export async function runVendors(
  args: VendorsArgs,
  { http, globals, io, color, stderrColor }: CommandContext,
): Promise<number> {
  const seen = new Set<string>();
  let cursor = args.cursor;
  let total = 0;
  const vendors: VendorsPageBody["vendors"] = [];
  for (;;) {
    const query = new URLSearchParams();
    if (args.query !== undefined) query.set("query", args.query);
    if (cursor !== undefined) query.set("cursor", cursor);
    if (args.all) query.set("limit", String(ALL_PAGE_LIMIT));
    const result = await getJson<VendorsPageBody>(
      http,
      `/api/vendors${query.size > 0 ? `?${query}` : ""}`,
      { timeoutMs: TIMEOUT_MS },
    );
    if (!result.ok) return failed(result, globals, io, stderrColor);
    if (globals.json) io.stdout.write(`${result.text}\n`);
    const page = result.body;
    total = page.total;
    vendors.push(...page.vendors);
    if (!args.all || page.nextCursor === null) {
      if (!globals.json)
        io.stdout.write(
          renderVendors(
            { vendors, total, nextCursor: page.nextCursor },
            { query: args.query, color },
          ),
        );
      return EXIT.ok;
    }
    // A cursor seen before would page forever: stop and say so.
    if (seen.has(page.nextCursor)) {
      io.stderr.write(
        renderUsageError(
          `the service handed out cursor ${page.nextCursor} twice; stopped paging`,
          stderrColor,
        ),
      );
      return EXIT.failed;
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

/**
 * `swaggerbot vendor <vendor>`: `GET /api/vendors/{vendor}/apis`. A 200 lists
 * the Vendor's APIs (`renderVendorApis`), exit 0; a 300 lists the Vendors it
 * could mean, exit 3 as Ambiguous; a 404 says the Index holds no such Vendor
 * and how a Lookup adds one, exit 6 as Unknown. `--json` prints the server's
 * body unchanged, with the same exit codes. Exit 1 for any other failure.
 */
export async function runVendor(
  args: VendorArgs,
  { http, globals, io, color, stderrColor }: CommandContext,
): Promise<number> {
  const result = await getJson<VendorApisBody>(
    http,
    `/api/vendors/${encodeURIComponent(args.vendor)}/apis`,
    { timeoutMs: TIMEOUT_MS },
  );
  if (result.ok) {
    io.stdout.write(
      globals.json
        ? `${result.text}\n`
        : renderVendorApis(result.body, { baseUrl: http.baseUrl, color }),
    );
    return EXIT.ok;
  }
  const { status } = result.error;
  if (status === 300) {
    const body = parsed(result.text) as Partial<VendorMatchesBody> | undefined;
    if (Array.isArray(body?.vendors) && body.vendors.length > 0) {
      io.stdout.write(
        globals.json
          ? `${result.text}\n`
          : renderVendorMatches(
              { vendors: body.vendors },
              { vendor: args.vendor, color },
            ),
      );
      return EXIT.Ambiguous;
    }
  }
  if (status === 404 && parsed(result.text) !== undefined) {
    io.stdout.write(
      globals.json
        ? `${result.text}\n`
        : renderUnknownVendor(args.vendor, color),
    );
    return EXIT.Unknown;
  }
  return failed(result, globals, io, stderrColor);
}

/** `text` as JSON; none when there is no text or it isn't JSON. */
function parsed(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}
