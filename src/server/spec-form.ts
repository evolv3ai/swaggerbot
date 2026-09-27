/**
 * A Spec's forms as the viewer names them. Kept apart from `spec-embed`
 * (which reads the Index) so the viewer page's client code can import it:
 * a browser bundle must not reach the repo and its `node:crypto`.
 */

/** Which of a Spec's forms a viewer shows. */
export type SpecForm = "published" | "normalized";

/** `?form=` as the viewer reads it: `normalized`, or else the Published Form. */
export function specFormOf(value: unknown): SpecForm {
  return value === "normalized" ? "normalized" : "published";
}
