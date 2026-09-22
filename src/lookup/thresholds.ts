/**
 * The probabilities a Lookup turns Judge answers into Outcomes with. These
 * are starting points, to be tuned on the Benchmark; pass overrides to
 * `createLookup`.
 */
export type Thresholds = {
  /** `whichApi` says `"none"` at least this likely → Unknown. */
  none: number;
  /** The top Candidate must be at least this likely to be identified… */
  apiPick: number;
  /** …and ahead of the second by at least this much; otherwise Ambiguous. */
  apiMargin: number;
  /** An Ambiguous answer lists the Candidates at least this likely. */
  ambiguousFloor: number;
  /** `specDescribesApi` at least this likely, from an Official Source → Resolved. */
  describes: number;
  /** Below `describes` but at least this likely → Unconfirmed; below → No Spec. */
  doubt: number;
  /**
   * `isVendorName` at least this likely for the top Candidate's Vendor, when
   * `whichApi` settled nothing → Ambiguous over that Vendor's APIs.
   */
  vendorName: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  none: 0.6,
  apiPick: 0.75,
  apiMargin: 0.3,
  ambiguousFloor: 0.1,
  describes: 0.8,
  doubt: 0.4,
  vendorName: 0.7,
};
