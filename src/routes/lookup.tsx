import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LookupView, titleOf } from "~/components/lookup/views";
import type { LookupPage } from "~/server/lookup-page";
import { lookupPageResponse } from "~/server/lookup-page-response";
import { LookupSearch } from "~/server/lookup-search";

/**
 * The page's answer, read on the server: the Lookup with no key, so from the
 * Index only (`answerLookupPage`), served with its view's status
 * (`lookupPageResponse`). Server-only modules are imported inside
 * the handler, keeping them out of the client bundle.
 */
const getLookupPage = createServerFn({ method: "GET" })
  .inputValidator((search: unknown) => LookupSearch.parse(search))
  .handler(async ({ data }): Promise<LookupPage> => {
    const [
      { getRequest, setResponseStatus },
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
    const page = await answerLookupPage(data, {
      getApp,
      gate,
      request: getRequest(),
      freshnessDays: freshnessDaysOf(process.env),
      publicBaseUrl: publicBaseUrlOf(process.env),
    });
    // The page's status (`pageStatus`, src/start.ts); its headers are the
    // route's `headers`, below.
    setResponseStatus(lookupPageResponse(page).status);
    return page;
  });

export const Route = createFileRoute("/lookup")({
  validateSearch: (search) => LookupSearch.parse(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getLookupPage({ data: deps }),
  headers: ({ loaderData }) =>
    loaderData ? lookupPageResponse(loaderData).headers : undefined,
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
