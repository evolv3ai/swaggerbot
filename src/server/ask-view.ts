import type { SpecOutline } from "~/domain/spec-forms";
import type { SignedInUser } from "./auth";
import type { ChatMeter } from "./chat-gate";
import type { SpecView } from "./spec-view";

/**
 * What the Spec viewer's "Ask this Spec" section shows (Slice 9 #6, D5):
 * - `off`: the feature is off (no model configured, or no sign-in on this
 *   site); the section isn't rendered.
 * - `signed-out`: what it does and "Sign in to ask".
 * - `pending` / `failed`: the Normalized Form isn't built yet, or couldn't be.
 * - `ready`: the question form, with the person's meter and three suggested
 *   questions built from the Spec Outline.
 */
export type AskView =
  | { state: "off" }
  | { state: "signed-out" }
  | { state: "pending" }
  | { state: "failed" }
  | {
      state: "ready";
      meter: Pick<ChatMeter, "used" | "limit">;
      suggestions: string[];
    };

export type AskViewDeps = {
  /** Whether the chat is configured (`getChat()`). */
  chatOn: boolean;
  /** Whether sign-in is configured: without it nobody can ask. */
  signInOn: boolean;
  user: SignedInUser | null;
  normalized: SpecView["forms"]["normalized"]["status"];
  meter: (userId: string) => ChatMeter;
  outline: () => SpecOutline | undefined;
  /** The Normalized Form's `components.schemas` names, in its order. */
  schemaNames: () => Promise<string[]>;
};

/** The section's state for the person on this request. */
export async function askViewOf(deps: AskViewDeps): Promise<AskView> {
  if (!deps.chatOn || !deps.signInOn) return { state: "off" };
  if (!deps.user) return { state: "signed-out" };
  if (deps.normalized !== "ready") return { state: deps.normalized };
  const outline = deps.outline();
  if (!outline) return { state: "pending" };
  const { used, limit } = deps.meter(deps.user.id);
  return {
    state: "ready",
    meter: { used, limit },
    suggestions: suggestedQuestions(outline, await deps.schemaNames()),
  };
}

/** A Spec name longer than this makes no suggestion: a chip is one line. */
const MAX_SUGGESTED_NAME = 40;

/**
 * Up to three questions to start from: "How do I authenticate?" when the
 * Spec has a security scheme, "List the {largest tag} operations" and "What
 * does {a schema} look like?", the schema named like the largest tag when
 * there is one (`customer` for `Customers`), else the first.
 */
export function suggestedQuestions(
  outline: Pick<SpecOutline, "securitySchemes" | "tags">,
  schemaNames: readonly string[],
): string[] {
  const fits = (name: string) =>
    name.trim().length > 0 && name.length <= MAX_SUGGESTED_NAME;
  const tag = outline.tags
    .filter((t) => t.operationCount > 0 && fits(t.name))
    .reduce<SpecOutline["tags"][number] | undefined>(
      (best, t) =>
        best === undefined || t.operationCount > best.operationCount ? t : best,
      undefined,
    );
  const names = schemaNames.filter(fits);
  const singular = tag?.name.toLowerCase().replace(/s$/, "");
  const schema = names.find((n) => n.toLowerCase() === singular) ?? names.at(0);
  return [
    outline.securitySchemes.length > 0 ? "How do I authenticate?" : null,
    tag ? `List the ${tag.name} operations` : null,
    schema ? `What does ${schema} look like?` : null,
  ].filter((q): q is string => q !== null);
}

/** `components.schemas`' names of a Normalized Form, in its order. */
export function schemaNamesOf(doc: unknown): string[] {
  const schemas = (doc as { components?: { schemas?: unknown } } | null)
    ?.components?.schemas;
  return schemas && typeof schemas === "object" && !Array.isArray(schemas)
    ? Object.keys(schemas)
    : [];
}
