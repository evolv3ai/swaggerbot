import { createServerFn } from "@tanstack/react-start";
import type { AskView } from "./ask-view";
import { type SpecForm, specFormOf } from "./spec-form";
import type { SpecView } from "./spec-view";

/** The Spec viewer's facts, and what its "Ask this Spec" section shows. */
export type SpecPage = SpecView & { ask: AskView };

/**
 * The Spec viewer's facts (`specView`), read on the server, with the
 * person's Ask this Spec state (`askViewOf`). Null for an unknown Spec.
 * Server-only modules are imported inside the handler, keeping them out of
 * the client bundle.
 */
export const getSpecView = createServerFn({ method: "GET" })
  .inputValidator((input: { specId: string; form: SpecForm }) => ({
    specId: String(input.specId),
    form: specFormOf(input.form),
  }))
  .handler(async ({ data }): Promise<SpecPage | null> => {
    const [
      { getApp, getChat },
      { specView },
      { freshnessDaysOf },
      { currentUser, signInConfigured },
      { askViewOf, schemaNamesOf },
      { createSpecForms },
      { normalizedCache, openNormalized },
      { setResponseHeader },
    ] = await Promise.all([
      import("./app-instance"),
      import("./spec-view"),
      import("~/lookup/app"),
      import("./auth"),
      import("./ask-view"),
      import("~/index-store/spec-forms"),
      import("~/spec-forms/operation-http"),
      import("@tanstack/react-start/server"),
    ]);
    const { db, lookup } = getApp();
    const view = specView(db, lookup, data.specId, data.form, {
      freshnessDays: freshnessDaysOf(process.env),
    });
    if (!view) return null;
    const chat = getChat();
    const user = currentUser();
    // A signed-in person's page carries their meter: no cache may keep it.
    if (user) setResponseHeader("cache-control", "private, no-store");
    const ask = await askViewOf({
      chatOn: chat !== undefined,
      signInOn: signInConfigured(),
      user,
      normalized: view.forms.normalized.status,
      meter: (userId) =>
        chat?.gate.meter(userId) ?? { used: 0, limit: 0, resetsAt: "" },
      outline: () => {
        const stored = createSpecForms(db).getOutline(view.spec.id);
        return stored.status === "ready" ? stored.outline : undefined;
      },
      // Read through the cache the turn itself reads, so the first question
      // finds the Normalized Form parsed.
      schemaNames: async () => {
        const opened = await openNormalized(view.api.id, view.spec.id, {
          db,
          lookup,
          cache: normalizedCache,
        });
        return "doc" in opened ? schemaNamesOf(opened.doc) : [];
      },
    });
    return { ...view, ask };
  });
