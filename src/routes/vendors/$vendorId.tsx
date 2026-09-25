import { createFileRoute, notFound } from "@tanstack/react-router";
import { VendorApisView } from "~/components/index-browsing/vendor-apis";
import type { VendorPage } from "~/server/index-browsing";
import { getVendorPage } from "~/server/index-browsing-fns";

export const Route = createFileRoute("/vendors/$vendorId")({
  loader: async ({ params }) => {
    const page = await getVendorPage({ data: { vendorId: params.vendorId } });
    // Thrown, so the page is served with a 404.
    if (page.status === 404) throw notFound({ data: page });
    return page;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.status === 200
            ? `${loaderData.vendor.name}: its APIs · SwaggerBot`
            : loaderData?.status === 300
              ? "Several Vendors · SwaggerBot"
              : "Not in the Index · SwaggerBot",
      },
    ],
  }),
  component: Vendor,
  notFoundComponent: ({ data }) => (
    <VendorApisView
      page={(data as VendorPage | undefined) ?? { status: 404, asked: "" }}
    />
  ),
});

function Vendor() {
  return <VendorApisView page={Route.useLoaderData()} />;
}
