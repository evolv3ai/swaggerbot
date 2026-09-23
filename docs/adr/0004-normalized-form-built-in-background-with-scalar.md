---
status: accepted
---

# The Normalized Form is built with Scalar, stored, and built in the background

A Spec's Normalized Form is swagger.bot's derivative of it: converted to one
current OpenAPI version, bundled into one JSON document (`CONTEXT.md`). Slice 4
also needs each Spec's Validity Issues and its Spec Outline. Four things were
decided together (Wes, 2026-09-23).

**The library is `@scalar/openapi-parser`, and the target is OpenAPI 3.1.** It
upgrades Swagger 2.0 and OpenAPI 3.0 to 3.1, validates, and dereferences in one
maintained package; `@scalar/json-magic` bundles external references through a
plugin, which is where our own fetcher plugs in. It is the family of the Scalar
viewer the Slice 6 web UI embeds. The alternatives were weaker:
`swagger2openapi` has had no release since 2022 and targets 3.0; Redocly
bundles but doesn't convert Swagger 2; `@apidevtools/swagger-parser` doesn't
convert at all. 3.1 is "current OpenAPI" in the glossary's sense.

**The forms are stored in the Index, not computed per request.** The largest
Specs in production are several megabytes (Cloudflare's is 26 MB, 2,241 paths),
and outlines and operations are read far more often than Specs are found.

**They are built by an in-process background worker, one Spec at a time.** A
spike on 2026-09-23 (Scalar 0.29.5, Node 24) built Cloudflare's Spec in about
1.2 s (parse 0.14 s, upgrade 0.21 s, validate 0.36 s, dereference 0.55 s) but
peaked at about 830 MB RSS. The container has 2 GB. Building inside the Lookup
would add seconds to a Discovery whose p90 is already 14.2–14.6 s against a
15 s target, and two builds side by side could exhaust memory. So a Lookup
answers at once, the Spec's Normalized Form is reported as `pending`, and the
worker builds it shortly after, as ADR 0002 already does for Verification.

**Downloads are open, addressed by Spec id.** A Spec id is the sha256 of its
Published Form, so a download URL names content that never changes and can be
cached as immutable. Answers from the Index are open to anyone under the per-IP
rate limit (PRD "Access"), and the forms of a Spec in the Index are part of that
answer.

## Consequences

- **Validity Issues are measured on the Published Form**, validated at its own
  version: they describe what the Vendor published. The same spike showed that
  Scalar's upgrader leaves Swagger 2 fields behind: Kubernetes' 2.0 Spec has one
  finding as published, and 1,202 after `upgrade`, all an operation-level
  `schemes` it failed to remove. Such leftovers are ours to strip. A finding
  that remains on the Normalized Form is our defect, recorded for the operator
  and never reported to a Caller as a Validity Issue.
- `upgrade` mutates the document it is given; the builder works on a copy.
- External `$ref`s are resolved only on the Spec's own origin, through the
  polite fetcher (robots.txt, rate limit, honest User-Agent). Any other external
  reference stays unresolved and is reported as a Validity Issue. swagger.bot
  still never fetches a URL a Caller supplies.
- A build is synchronous work on the server's event loop, about a second for
  the largest Spec. It happens once per new Spec, so it is accepted for v1, on
  the condition that Index answers keep p90 < 200 ms while builds run (measured
  during the first backfill); if they don't, the build moves to a worker thread.
- The Index roughly doubles in size (the Normalized Form is minified JSON,
  usually smaller than the Published Form), which Litestream replicates as usual.
