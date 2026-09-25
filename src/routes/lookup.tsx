import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LookupView, titleOf } from "~/components/lookup/views";
import type { LookupPage } from "~/server/lookup-page";
import { LookupSearch } from "~/server/lookup-search";

/**
 * The page's answer, read on the server: the Lookup with no key, so from the
 * Index only (`answerLookupPage`). Server-only modules are imported inside
 * the handler, keeping them out of the client bundle.
 */
const getLookupPage = createServerFn({ method: "GET" })
  .inputValidator((search: unknown) => LookupSearch.parse(search))
  .handler(async ({ data }): Promise<LookupPage> => {
    const [
      { getRequest },
      { answerLookupPage },
      { gate, getApp },
      { freshnessDaysOf },
      { publicBaseUrlOf },
    ] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("~/server/lookup-page"),
      import("~/server/app-instance"),
      import("~/lookup/app"),
      import("~/spec-forms/outcome"),
    ]);
    return answerLookupPage(data, {
      getApp,
      gate,
      request: getRequest(),
      freshnessDays: freshnessDaysOf(process.env),
      publicBaseUrl: publicBaseUrlOf(process.env),
    });
  });

export const Route = createFileRoute("/lookup")({
  validateSearch: (search) => LookupSearch.parse(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getLookupPage({ data: deps }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: `${titleOf(loaderData)} · SwaggerBot` }]
      : undefined,
  }),
  component: LookupResult,
});

function LookupResult() {
  const page = Route.useLoaderData();
  return <LookupView page={page} />;
}
