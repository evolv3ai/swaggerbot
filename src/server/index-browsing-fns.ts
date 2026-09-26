import { createServerFn } from "@tanstack/react-start";
import type { VendorPage, VendorsPage } from "./index-browsing";

/** A search or path value as the route hands it on: a string, or nothing. */
function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

/**
 * The `/vendors` page: one page of the Vendor list (`vendorsPage`), read
 * on the server, served with its status (a bad cursor is a 400).
 * Server-only modules are imported inside the handler,
 * keeping them out of the client bundle.
 */
export const getVendorsPage = createServerFn({ method: "GET" })
  .inputValidator((input: { query?: unknown; cursor?: unknown }) => ({
    query: text(input.query),
    cursor: text(input.cursor),
  }))
  .handler(async ({ data }): Promise<VendorsPage> => {
    const [{ setResponseStatus }, { getApp }, { vendorsPage }] =
      await Promise.all([
        import("@tanstack/react-start/server"),
        import("./app-instance"),
        import("./index-browsing"),
      ]);
    const page = vendorsPage(getApp().db, data);
    setResponseStatus(page.status);
    return page;
  });

/**
 * The `/vendors/{vendorId}` page: the Vendor and its APIs
 * (`vendorPage`, over `answerVendorApis`), read on the server.
 */
export const getVendorPage = createServerFn({ method: "GET" })
  .inputValidator((input: { vendorId: string }) => ({
    vendorId: String(input.vendorId),
  }))
  .handler(async ({ data }): Promise<VendorPage> => {
    const [{ getApp }, { vendorPage }, { freshnessDaysOf }] = await Promise.all(
      [
        import("./app-instance"),
        import("./index-browsing"),
        import("~/lookup/app"),
      ],
    );
    return vendorPage(data.vendorId, getApp(), {
      freshnessDays: freshnessDaysOf(process.env),
    });
  });
