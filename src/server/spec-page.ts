import { createServerFn } from "@tanstack/react-start";
import { type SpecForm, specFormOf } from "./spec-embed";
import type { SpecView } from "./spec-view";

/**
 * The Spec viewer's facts (`specView`), read on the server. Null for an
 * unknown Spec. Server-only modules are imported inside the handler,
 * keeping them out of the client bundle.
 */
export const getSpecView = createServerFn({ method: "GET" })
  .inputValidator((input: { specId: string; form: SpecForm }) => ({
    specId: String(input.specId),
    form: specFormOf(input.form),
  }))
  .handler(async ({ data }): Promise<SpecView | null> => {
    const [{ getApp }, { specView }, { freshnessDaysOf }] = await Promise.all([
      import("./app-instance"),
      import("./spec-view"),
      import("~/lookup/app"),
    ]);
    const { db, lookup } = getApp();
    return specView(db, lookup, data.specId, data.form, {
      freshnessDays: freshnessDaysOf(process.env),
    });
  });
