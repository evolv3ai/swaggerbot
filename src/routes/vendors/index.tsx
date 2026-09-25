import { createFileRoute } from "@tanstack/react-router";
import { VendorListView } from "~/components/index-browsing/vendor-list";
import { getVendorsPage } from "~/server/index-browsing-fns";

/**
 * A search value as the router parsed it (it reads `5` as a number),
 * passed on unchanged: turning it into text here makes the router write
 * it back JSON-quoted and redirect. The server function makes it text.
 */
function raw(value: unknown): string | number | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number") return value;
  return undefined;
}

export const Route = createFileRoute("/vendors/")({
  validateSearch: (search: Record<string, unknown>) => ({
    query: raw(search.query),
    cursor: raw(search.cursor),
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
