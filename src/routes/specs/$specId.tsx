import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ProvenanceMark } from "~/components/darkroom/provenance-mark";
import { VerifiedStamp } from "~/components/darkroom/stamp";
import { sizeOf } from "~/components/viewer/size";
import { SpecFrame } from "~/components/viewer/spec-frame";
import { cn } from "~/lib/utils";
import { type SpecForm, specFormOf } from "~/server/spec-embed";
import { getSpecView } from "~/server/spec-page";
import type { SpecView } from "~/server/spec-view";

/**
 * The Spec viewer (Slice 6 backlog, D6): a Spec as a print. Our frame, the
 * label, carries its facts, every Spec string as text; the image is Scalar,
 * in a sandboxed frame under its own CSP (`/embed/specs/{specId}`).
 */
export const Route = createFileRoute("/specs/$specId")({
  validateSearch: (search: Record<string, unknown>): { form?: "normalized" } =>
    specFormOf(search.form) === "normalized" ? { form: "normalized" } : {},
  loaderDeps: ({ search }) => ({ form: specFormOf(search.form) }),
  loader: async ({ params, deps }) => {
    const view = await getSpecView({
      data: { specId: params.specId, form: deps.form },
    });
    if (!view) throw notFound();
    return view;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.api.name} Spec · SwaggerBot`
          : "No such Spec · SwaggerBot",
      },
    ],
  }),
  component: SpecViewer,
  notFoundComponent: NoSuchSpec,
});

const FORM_NAMES: Record<SpecForm, string> = {
  published: "Published",
  normalized: "Normalized",
};

function SpecViewer() {
  const view = Route.useLoaderData();
  return (
    <div className="grid gap-8 px-4 pt-8 pb-12 sm:px-8 lg:pt-12">
      <header className="grid gap-2">
        <p className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-ink-2">
          Spec viewer · {view.vendor.name}
        </p>
        <h1 className="font-caps text-4xl font-semibold uppercase leading-tight tracking-wide [overflow-wrap:anywhere] sm:text-5xl">
          {view.api.name}
        </h1>
      </header>
      <article
        aria-label={`The ${view.api.name} Spec`}
        className="grid gap-5 rounded-[3px] bg-print p-3 text-print-ink shadow-[0_6px_18px_-6px_rgb(0_0_0/0.45)] sm:p-5"
      >
        <SpecLabel view={view} />
        <FormSwitch view={view} />
        <FrameArea view={view} />
      </article>
      <Alternates view={view} />
    </div>
  );
}

/** The print's label: the Spec's facts, its downloads and its Validity Issues. */
function SpecLabel({ view }: { view: SpecView }) {
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
function specFormat(specVersion: string): string {
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

/** Published / Normalized: links, so the switch works without script. */
function FormSwitch({ view }: { view: SpecView }) {
  return (
    <nav aria-label="Form" className="px-1">
      <ul className="flex flex-wrap gap-2">
        {(["published", "normalized"] as const).map((form) => {
          const active = form === view.form;
          return (
            <li key={form}>
              <Link
                to="/specs/$specId"
                params={{ specId: view.spec.id }}
                search={form === "normalized" ? { form } : {}}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-[3px] border px-3 py-1.5 font-caps text-sm font-semibold uppercase tracking-[0.14em] no-underline",
                  active
                    ? "border-print-ink bg-strip-5 text-print"
                    : "border-print-ink hover:bg-strip-2",
                )}
              >
                {FORM_NAMES[form]} Form
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Scalar in its frame, or why it isn't shown. */
function FrameArea({ view }: { view: SpecView }) {
  const { normalized } = view.forms;
  switch (view.frame) {
    case "show":
      return (
        <SpecFrame
          specId={view.spec.id}
          form={view.form}
          apiName={view.api.name}
        />
      );
    case "too-large": {
      const bytes =
        view.form === "published"
          ? view.forms.published.bytes
          : normalized.status === "ready"
            ? normalized.bytes
            : 0;
      const { value, unit } = sizeOf(bytes);
      return (
        <FrameNote>
          <p>
            This {FORM_NAMES[view.form]} Form is {value} {unit}, too large to
            view here. Download it above, or read its{" "}
            <a href={view.outlineUrl}>Spec Outline</a> (the operations and tags,
            as JSON).
          </p>
        </FrameNote>
      );
    }
    case "pending":
      return (
        <FrameNote>
          <p>
            The Normalized Form is being built. Reload the page in a minute, or
            view the{" "}
            <Link to="/specs/$specId" params={{ specId: view.spec.id }}>
              Published Form
            </Link>{" "}
            now.
          </p>
        </FrameNote>
      );
    case "failed":
      return (
        <FrameNote>
          <p>
            The Normalized Form couldn't be built:{" "}
            <span className="[overflow-wrap:anywhere]">
              {normalized.status === "failed" ? normalized.error : ""}
            </span>
          </p>
        </FrameNote>
      );
  }
}

function FrameNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="grid min-h-40 content-center gap-2 rounded-[2px] border border-print-ink px-4 py-6 text-base"
    >
      {children}
    </div>
  );
}

function Alternates({ view }: { view: SpecView }) {
  return (
    <section aria-labelledby="alternates" className="grid gap-3">
      <h2
        id="alternates"
        className="font-caps text-2xl font-semibold uppercase tracking-wide"
      >
        Alternate Specs
      </h2>
      {view.alternates.length === 0 ? (
        <p className="text-sm text-ink-2">
          The Index holds no other Spec of this API that a Lookup would answer
          with.
        </p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {view.alternates.map((alt) => (
            <li
              key={alt.specId}
              className="flex flex-wrap items-baseline gap-x-3"
            >
              <Link to="/specs/$specId" params={{ specId: alt.specId }}>
                API Version {alt.apiVersion ?? "not stated"}
              </Link>
              <span className="text-ink-2">
                {specFormat(alt.specVersion)}
                {alt.current ? " · Current" : ""}
              </span>
              <code className="font-mono text-xs text-ink-2">
                {alt.specId.slice(0, 12)}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
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

function NoSuchSpec() {
  return (
    <div className="grid max-w-[34rem] gap-4 px-4 pt-8 sm:px-8 lg:pt-12">
      <h1 className="font-caps text-4xl font-semibold uppercase tracking-wide">
        No such Spec
      </h1>
      <p className="text-lg text-ink-2">
        The Index holds no Spec with that id. Find an API by name with{" "}
        <Link to="/">Search</Link>.
      </p>
    </div>
  );
}
