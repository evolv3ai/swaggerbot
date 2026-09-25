import { createFileRoute } from "@tanstack/react-router";
import { VendorListView } from "~/components/index-browsing/vendor-list";
import { getVendorsPage } from "~/server/index-browsing-fns";

/** A search value as the router parsed it (it reads `5` as a number), as text. */
function text(value: unknown): string | undefined {
  return value === undefined || value === null || value === ""
    ? undefined
    : String(value);
}

export const Route = createFileRoute("/vendors/")({
  validateSearch: (search: Record<string, unknown>) => ({
    query: text(search.query),
    cursor: text(search.cursor),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getVendorsPage({ data: deps }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.query
          ? `Vendors matching “${loaderData.query}” · SwaggerBot`
          : "Vendors in the Index · SwaggerBot",
      },
    ],
  }),
  component: Vendors,
});

function Vendors() {
  return <VendorListView page={Route.useLoaderData()} />;
}
