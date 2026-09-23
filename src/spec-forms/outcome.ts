import type { Spec } from "~/domain/catalog";
import {
  type BareOutcome,
  MAX_OUTCOME_VALIDITY_ISSUES,
  type Outcome,
  type SpecAnswer,
} from "~/domain/outcome";
import type { ValidityIssue } from "~/domain/spec-forms";
import type { SpecFormsRepo, SpecValidity } from "~/index-store/spec-forms";

/** What `withSpecForms` reads of the stored forms: the small columns only. */
export type OutcomeForms = Pick<SpecFormsRepo, "getValidity">;

/**
 * The download URL of a Spec's `form`: `GET /api/specs/{specId}/published`
 * or `…/normalized`, under `baseUrl` (`PUBLIC_BASE_URL`, e.g.
 * `https://swaggerbot.dev`). Without one it is a path starting with `/api/`.
 */
export function downloadUrl(
  specId: string,
  form: "published" | "normalized",
  baseUrl = "",
): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/specs/${specId}/${form}`;
}

/** `spec` with its download URLs and its Normalized Form's status. */
export function specAnswer(
  spec: Spec,
  forms: OutcomeForms,
  baseUrl?: string,
): SpecAnswer {
  return answer(spec, forms.getValidity(spec.id), baseUrl);
}

function answer(
  spec: Spec,
  { status }: SpecValidity,
  baseUrl: string | undefined,
): SpecAnswer {
  return {
    ...spec,
    downloads: {
      published: downloadUrl(spec.id, "published", baseUrl),
      normalized: downloadUrl(spec.id, "normalized", baseUrl),
    },
    normalized: status,
  };
}

/**
 * The Spec an Outcome answers with, and its Validity Issues as the Outcome
 * carries them: the `MAX_OUTCOME_VALIDITY_ISSUES` groups with the highest
 * `count`, and the total count of findings (0 while its forms are pending).
 */
function answered(
  spec: Spec,
  forms: OutcomeForms,
  baseUrl: string | undefined,
): {
  spec: SpecAnswer;
  validityIssues: ValidityIssue[];
  validityIssueCount: number;
} {
  const validity = forms.getValidity(spec.id);
  return {
    spec: answer(spec, validity, baseUrl),
    validityIssues: [...validity.validityIssues]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_OUTCOME_VALIDITY_ISSUES),
    validityIssueCount: validity.validityFindingCount,
  };
}

/**
 * The Outcome a Caller receives: every Spec in it (the Current Spec, each
 * Alternate, an Unconfirmed Spec) with its download URLs and its Normalized
 * Form's status, and the Validity Issues of the Spec it answers with. Reads
 * only the small columns of the stored forms, never the Normalized Form.
 */
export function withSpecForms(
  outcome: BareOutcome,
  forms: OutcomeForms,
  baseUrl?: string,
): Outcome {
  switch (outcome.outcome) {
    case "Resolved": {
      const { spec, ...validity } = answered(
        outcome.currentSpec,
        forms,
        baseUrl,
      );
      return {
        ...outcome,
        currentSpec: spec,
        alternateSpecs: outcome.alternateSpecs.map((s) =>
          specAnswer(s, forms, baseUrl),
        ),
        ...validity,
      };
    }
    case "Unconfirmed":
      return { ...outcome, ...answered(outcome.spec, forms, baseUrl) };
    default:
      return outcome;
  }
}
