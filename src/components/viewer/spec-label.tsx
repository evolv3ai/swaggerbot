import type { ReactNode } from "react";
import { ProvenanceMark } from "~/components/darkroom/provenance-mark";
import { VerifiedStamp } from "~/components/darkroom/stamp";
import { Sources } from "~/components/lookup/views";
import { vendorHref } from "~/lib/vendor-hrefs";
import { lookupHref } from "~/server/lookup-search";
import type { SpecView } from "~/server/spec-view";
import { sizeOf } from "./size";

/**
 * The Spec viewer's heading: its Vendor (a link to the Vendor's page), the
 * API's name, and a link to look the API up by that name.
 */
export function SpecHeader({ view }: { view: SpecView }) {
  return (
    <header className="grid gap-2">
      <p className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-ink-2">
        Spec viewer ·{" "}
        <a href={vendorHref(view.vendor.id)} className="text-ink">
          {view.vendor.name}
        </a>
      </p>
      <h1 className="font-caps text-4xl font-semibold uppercase leading-tight tracking-wide [overflow-wrap:anywhere] sm:text-5xl">
        {view.api.name}
      </h1>
      <p>
        <a href={lookupHref(view.lookupName)}>Look it up</a>
      </p>
    </header>
  );
}

/**
 * The print's label: the Spec's facts, its downloads, its Validity Issues
 * and its Sources.
 */
export function SpecLabel({ view }: { view: SpecView }) {
  const { spec } = view;
  return (
    <div className="grid gap-5 px-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
      <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 text-sm">
        <Term>Vendor</Term>
        <dd className="text-right">{view.vendor.name}</dd>
        <Term>Provenance</Term>
        <dd className="text-right">
          {view.provenance ? (
            <ProvenanceMark provenance={view.provenance} />
          ) : (
            "None confirmed"
          )}
        </dd>
        <Term>Verified</Term>
        <dd className="text-right">
          <VerifiedStamp verifiedAt={view.verifiedAt} stale={view.stale} />
        </dd>
        <Term>API Version</Term>
        <dd className="text-right [overflow-wrap:anywhere]">
          {spec.apiVersion ?? "Not stated"}
        </dd>
        <Term>Format</Term>
        <dd className="text-right">{specFormat(spec.specVersion)}</dd>
        <Term>Standing</Term>
        <dd className="text-right">{standing(spec)}</dd>
        <Term>Spec</Term>
        <dd className="text-right font-mono text-xs leading-5 [overflow-wrap:anywhere]">
          {spec.id}
        </dd>
      </dl>
      <div className="grid content-start gap-5">
        <Downloads view={view} />
        <ValidityIssues view={view} />
      </div>
      {view.sources.length > 0 ? (
        <div className="lg:col-span-2">
          <Sources sources={view.sources} on="print" />
        </div>
      ) : null}
    </div>
  );
}

function Term({ children }: { children: ReactNode }) {
  return (
    <dt className="font-caps uppercase tracking-wider text-print-ink-2">
      {children}
    </dt>
  );
}

/** `3.1.0` → `OpenAPI 3.1.0`; `2.0` → `Swagger 2.0`. */
export function specFormat(specVersion: string): string {
  return `${specVersion.startsWith("2.") ? "Swagger" : "OpenAPI"} ${specVersion}`;
}

function standing(spec: SpecView["spec"]): string {
  const words = [
    spec.current ? "Current" : spec.superseded ? "Superseded" : "Alternate",
  ];
  if (spec.isPreview) words.push("Preview");
  return words.join(" · ");
}

function Downloads({ view }: { view: SpecView }) {
  const { published, normalized } = view.forms;
  return (
    <section aria-labelledby="downloads" className="grid gap-2">
      <SectionHeading id="downloads">Downloads</SectionHeading>
      <ul className="grid gap-1.5 text-sm">
        <li className="flex flex-wrap items-baseline justify-between gap-x-4">
          <a href={published.url}>
            Published Form ({published.format.toUpperCase()})
          </a>
          <Size bytes={published.bytes} />
        </li>
        <li className="flex flex-wrap items-baseline justify-between gap-x-4">
          {normalized.status === "ready" ? (
            <>
              <a href={normalized.url}>Normalized Form (JSON)</a>
              <Size bytes={normalized.bytes} />
            </>
          ) : (
            <>
              <span>Normalized Form (JSON)</span>
              <span className="text-print-ink-2">
                {normalized.status === "pending" ? "Being built" : "Failed"}
              </span>
            </>
          )}
        </li>
      </ul>
    </section>
  );
}

function Size({ bytes }: { bytes: number }) {
  const { value, unit } = sizeOf(bytes);
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="font-segment text-sm">{value}</span>
      <span className="font-caps text-xs font-semibold uppercase">{unit}</span>
    </span>
  );
}

function ValidityIssues({ view }: { view: SpecView }) {
  const count = view.validityFindingCount;
  if (view.forms.normalized.status === "pending")
    return (
      <p className="text-sm text-print-ink-2">
        Validity Issues are listed once the Normalized Form is built.
      </p>
    );
  if (count === 0)
    return (
      <p className="text-sm">
        <span className="font-segment">0</span> Validity Issues: the Published
        Form validates.
      </p>
    );
  return (
    <details className="group text-sm">
      <summary className="w-fit cursor-pointer">
        <span className="font-segment">{count}</span>{" "}
        <span className="font-caps font-semibold uppercase tracking-[0.12em]">
          Validity {count === 1 ? "Issue" : "Issues"}
        </span>{" "}
        <span className="text-print-ink-2">
          in {view.validityIssues.length}{" "}
          {view.validityIssues.length === 1 ? "group" : "groups"}, as published
        </span>
      </summary>
      <ol className="mt-3 grid max-h-80 gap-2 overflow-y-auto border-t border-print-ink-2 pt-3">
        {view.validityIssues.map((issue) => (
          <li
            key={`${issue.path}\u0000${issue.message}`}
            className="grid gap-0.5"
          >
            <span className="[overflow-wrap:anywhere]">
              {issue.message}
              {issue.count > 1 ? (
                <span className="text-print-ink-2"> ×{issue.count}</span>
              ) : null}
            </span>
            <code className="font-mono text-xs text-print-ink-2 [overflow-wrap:anywhere]">
              {issue.path}
            </code>
          </li>
        ))}
      </ol>
    </details>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-print-ink-2"
    >
      {children}
    </h2>
  );
}
