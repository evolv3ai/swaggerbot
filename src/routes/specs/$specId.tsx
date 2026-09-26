import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { CircleAlert, Hourglass, Scale } from "lucide-react";
import type { ReactNode } from "react";
import { WithOnThisPage } from "~/components/shell/on-this-page";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { sizeOf } from "~/components/viewer/size";
import { Sources } from "~/components/viewer/sources";
import { SpecFrame } from "~/components/viewer/spec-frame";
import {
  SpecHeader,
  SpecSummary,
  specFormat,
} from "~/components/viewer/spec-label";
import { cn } from "~/lib/utils";
import { type SpecForm, specFormOf } from "~/server/spec-embed";
import { getSpecView } from "~/server/spec-page";
import type { SpecView } from "~/server/spec-view";

/**
 * The Spec viewer (Slice 6 backlog, D6), a docs page: the Spec's facts,
 * downloads, Validity Issues and Sources, every Spec string as text; then
 * Scalar's API reference, in a sandboxed frame under its own CSP
 * (`/embed/specs/{specId}`), in the site's theme; then the Alternate Specs.
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

const H2 =
  "mt-10 mb-3.5 scroll-mt-20 font-display text-xl font-bold tracking-[-0.01em] text-sb-text";

function SpecViewer() {
  const view = Route.useLoaderData();
  return (
    <WithOnThisPage first={{ id: "spec", label: "About this Spec" }}>
      <div className="max-w-[860px] px-4 pt-7 pb-16 sm:px-8 lg:px-14 lg:pt-11">
        <SpecHeader view={view} />
        <div className="mt-7">
          <SpecSummary view={view} />
        </div>
        {view.sources.length > 0 ? (
          <Sources sources={view.sources} headingClassName={H2} />
        ) : null}
        <section aria-labelledby="reference">
          <div className="mt-10 mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <h2
              id="reference"
              className="scroll-mt-20 font-display text-xl font-bold tracking-[-0.01em] text-sb-text"
            >
              API reference
            </h2>
            <FormSwitch view={view} />
          </div>
          <FrameArea view={view} />
        </section>
        <Alternates view={view} />
      </div>
    </WithOnThisPage>
  );
}

/**
 * Published / Normalized, as a segmented control of links: it works
 * without script, each is in the Tab order, and the one shown is
 * `aria-current`.
 */
function FormSwitch({ view }: { view: SpecView }) {
  return (
    <nav aria-label="Form">
      <ul className="flex rounded-full border border-sb-border bg-sb-bg-subtle p-1">
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
                  "flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold no-underline transition-colors duration-150",
                  active
                    ? "bg-sb-accent text-sb-text-on-accent"
                    : "text-sb-text-muted hover:bg-sb-accent-soft hover:text-sb-text",
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
        <Card className="overflow-hidden">
          <SpecFrame
            specId={view.spec.id}
            form={view.form}
            apiName={view.api.name}
          />
        </Card>
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
        <FrameNote icon={<Scale />} title="Too large to view here">
          <p>
            This {FORM_NAMES[view.form]} Form is {value} {unit}, too large to
            view here. Download it above, or read its{" "}
            <a href={view.outlineUrl} className="text-sb-accent-text">
              Spec Outline
            </a>{" "}
            (the operations and tags, as JSON).
          </p>
        </FrameNote>
      );
    }
    case "pending":
      return (
        <FrameNote icon={<Hourglass />} title="Being built">
          <p>
            The Normalized Form is being built. Reload the page in a minute, or
            view the{" "}
            <Link
              to="/specs/$specId"
              params={{ specId: view.spec.id }}
              className="text-sb-accent-text"
            >
              Published Form
            </Link>{" "}
            now.
          </p>
        </FrameNote>
      );
    case "failed":
      return (
        <FrameNote icon={<CircleAlert />} title="Couldn't be built">
          <p>
            The Normalized Form couldn't be built:{" "}
            <span className="[overflow-wrap:anywhere]">
              {normalized.status === "failed" ? normalized.error : ""}
            </span>
          </p>
          <p>
            The{" "}
            <Link
              to="/specs/$specId"
              params={{ specId: view.spec.id }}
              className="text-sb-accent-text"
            >
              Published Form
            </Link>{" "}
            is still here to view and download.
          </p>
        </FrameNote>
      );
  }
}

function FrameNote({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card
      role="status"
      className="flex min-h-40 items-start gap-3.5 px-5 py-6 text-[15px]"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-md bg-sb-accent-soft text-sb-accent-text [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <div className="grid max-w-[40em] gap-1.5">
        <p className="font-display font-bold text-sb-text">{title}</p>
        <div className="grid gap-2 text-sb-text-muted">{children}</div>
      </div>
    </Card>
  );
}

function Alternates({ view }: { view: SpecView }) {
  return (
    <section aria-labelledby="alternates">
      <h2 id="alternates" className={H2}>
        Alternate Specs
      </h2>
      {view.alternates.length === 0 ? (
        <p className="max-w-[40em] text-sb-text-muted">
          The Index holds no other Spec of this API that a Lookup would answer
          with.
        </p>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-sb-border">
            {view.alternates.map((alt) => (
              <li
                key={alt.specId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm sm:px-5"
              >
                <Link
                  to="/specs/$specId"
                  params={{ specId: alt.specId }}
                  className="font-semibold text-sb-text"
                >
                  API Version {alt.apiVersion ?? "not stated"}
                </Link>
                <span className="text-sb-text-muted">
                  {specFormat(alt.specVersion)}
                </span>
                {alt.current ? <Badge tone="success">Current</Badge> : null}
                <code className="font-mono text-xs text-sb-text-muted sm:ml-auto">
                  {alt.specId.slice(0, 12)}
                </code>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function NoSuchSpec() {
  return (
    <div className="grid max-w-[860px] gap-3 px-4 pt-7 pb-16 sm:px-8 lg:px-14 lg:pt-11">
      <h1 className="font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.01em] text-sb-text sm:text-[40px]">
        No such Spec
      </h1>
      <p className="max-w-[40em] text-[17px] text-sb-text-muted">
        The Index holds no Spec with that id. Find an API by name with{" "}
        <Link to="/" className="text-sb-text">
          Search
        </Link>
        .
      </p>
    </div>
  );
}
