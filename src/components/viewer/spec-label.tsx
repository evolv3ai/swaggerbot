import { ArrowRight, ChevronRight, Download } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ProvenanceBadge } from "~/components/ui/provenance-badge";
import { dayOf } from "~/lib/dates";
import { vendorHref } from "~/lib/vendor-hrefs";
import { lookupHref } from "~/server/lookup-search";
import type { SpecView } from "~/server/spec-view";
import { sizeOf } from "./size";

/**
 * The Spec viewer's heading: the API's name, then a meta line with the Spec
 * format and API Version, its Vendor (a link to the Vendor's page) and a
 * link to look the API up by that name.
 */
export function SpecHeader({ view }: { view: SpecView }) {
  return (
    <header className="grid gap-2">
      <h1
        id="spec"
        className="scroll-mt-20 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.01em] text-sb-text [overflow-wrap:anywhere] sm:text-[40px]"
      >
        {view.api.name}
      </h1>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-sb-text-muted">
        <span>
          {specFormat(view.spec.specVersion)} · API Version{" "}
          {view.spec.apiVersion ?? "not stated"}
        </span>
        <span>
          By{" "}
          <a href={vendorHref(view.vendor.id)} className="text-sb-text">
            {view.vendor.name}
          </a>
        </span>
        <a
          href={lookupHref(view.lookupName)}
          className="inline-flex items-center gap-1 text-sb-text"
        >
          Look it up
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </a>
      </p>
    </header>
  );
}

/**
 * The Spec's facts in a card: Vendor, Provenance, when it was verified, API
 * Version, format, Standing and id; then its downloads and its Validity
 * Issues.
 */
export function SpecSummary({ view }: { view: SpecView }) {
  const { spec } = view;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-sb-border px-4 py-3.5 sm:px-5">
        {view.provenance ? (
          <ProvenanceBadge provenance={view.provenance} />
        ) : (
          <Badge tone="outline">No confirmed Provenance</Badge>
        )}
        {spec.current ? <Badge tone="success">Current</Badge> : null}
        {spec.isPreview ? <Badge tone="warning">Preview</Badge> : null}
        {view.stale ? <Badge tone="warning">Stale</Badge> : null}
      </div>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[140px_minmax(0,1fr)] sm:px-5">
        <Fact term="Vendor">
          <a href={vendorHref(view.vendor.id)} className="text-sb-text">
            {view.vendor.name}
          </a>
          {view.vendor.domain !== view.vendor.name ? (
            <span className="text-sb-text-muted"> · {view.vendor.domain}</span>
          ) : null}
        </Fact>
        <Fact term="Provenance">{view.provenance ?? "None confirmed"}</Fact>
        <Fact term="Verified">
          {view.verifiedAt ? (
            <time dateTime={view.verifiedAt}>{dayOf(view.verifiedAt)}</time>
          ) : (
            "Not verified"
          )}
          {view.stale ? (
            <span className="text-sb-text-muted">
              {" "}
              · Stale: a Lookup queues a new Verification
            </span>
          ) : null}
        </Fact>
        <Fact term="API Version">
          <span className="[overflow-wrap:anywhere]">
            {spec.apiVersion ?? "Not stated"}
          </span>
        </Fact>
        <Fact term="Format">{specFormat(spec.specVersion)}</Fact>
        <Fact term="Standing">{standing(spec)}</Fact>
        <Fact term="Spec id">
          <code className="font-mono text-[12.5px] leading-5 text-sb-text [overflow-wrap:anywhere]">
            {spec.id}
          </code>
        </Fact>
      </dl>
      <div className="grid gap-4 border-t border-sb-border px-4 py-4 sm:px-5">
        <Downloads view={view} />
        <ValidityIssues view={view} />
      </div>
    </Card>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sb-text-muted">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** `3.1.0` → `OpenAPI 3.1.0`; `2.0` → `Swagger 2.0`. */
export function specFormat(specVersion: string): string {
  return `${specVersion.startsWith("2.") ? "Swagger" : "OpenAPI"} ${specVersion}`;
}

function standing(spec: SpecView["spec"]): string {
  const words = [
    spec.current
      ? "Current Spec"
      : spec.superseded
        ? "Superseded"
        : "Alternate Spec",
  ];
  if (spec.isPreview) words.push("Preview");
  return words.join(" · ");
}

const DOWNLOAD = buttonClass({ variant: "secondary", size: "sm" });

function Downloads({ view }: { view: SpecView }) {
  const { published, normalized } = view.forms;
  return (
    <section aria-labelledby="downloads" className="grid gap-2">
      <h3
        id="downloads"
        className="font-display text-[13px] font-bold text-sb-text"
      >
        Downloads
      </h3>
      <ul className="flex flex-wrap gap-2">
        <li>
          <a href={published.url} className={DOWNLOAD}>
            <Download aria-hidden="true" />
            Published Form · {published.format.toUpperCase()}
            <Size bytes={published.bytes} />
          </a>
        </li>
        <li>
          {normalized.status === "ready" ? (
            <a href={normalized.url} className={DOWNLOAD}>
              <Download aria-hidden="true" />
              Normalized Form · JSON
              <Size bytes={normalized.bytes} />
            </a>
          ) : (
            <span className="inline-flex h-8 items-center gap-2 rounded-sm border-2 border-dashed border-sb-border px-3 text-[13px] text-sb-text-muted">
              Normalized Form · JSON:{" "}
              {normalized.status === "pending" ? "being built" : "failed"}
            </span>
          )}
        </li>
      </ul>
    </section>
  );
}

function Size({ bytes }: { bytes: number }) {
  const { value, unit } = sizeOf(bytes);
  return (
    <span className="font-sans font-medium tabular-nums text-sb-text-muted">
      {value} {unit}
    </span>
  );
}

function ValidityIssues({ view }: { view: SpecView }) {
  const count = view.validityFindingCount;
  if (view.forms.normalized.status === "pending")
    return (
      <p className="text-sm text-sb-text-muted">
        Validity Issues are listed once the Normalized Form is built.
      </p>
    );
  if (count === 0)
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="success">0 Validity Issues</Badge>
        <span className="text-sb-text-muted">
          The Published Form validates.
        </span>
      </p>
    );
  const groups = view.validityIssues.length;
  return (
    <details className="group text-sm">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-sb-text-muted transition-transform duration-150 group-open:rotate-90"
        />
        <Badge tone="warning">
          {count} Validity {count === 1 ? "Issue" : "Issues"}
        </Badge>
        <span className="text-sb-text-muted">
          in {groups} {groups === 1 ? "group" : "groups"}, as published. They
          don't stop it being shown or downloaded.
        </span>
      </summary>
      <ol className="mt-3 grid max-h-80 gap-2.5 overflow-y-auto rounded-md border border-sb-border bg-sb-bg-subtle p-3">
        {view.validityIssues.map((issue) => (
          <li
            key={`${issue.path}\u0000${issue.message}`}
            className="grid gap-0.5"
          >
            <span className="[overflow-wrap:anywhere]">
              {issue.message}
              {issue.count > 1 ? (
                <span className="text-sb-text-muted"> ×{issue.count}</span>
              ) : null}
            </span>
            <code className="font-mono text-xs text-sb-text-muted [overflow-wrap:anywhere]">
              {issue.path}
            </code>
          </li>
        ))}
      </ol>
    </details>
  );
}
