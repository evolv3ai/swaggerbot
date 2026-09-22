# swagger.bot

swagger.bot resolves the name of an app, service or developer API to a verified, machine-readable API description (OpenAPI or Swagger) published on the public web.

## Language

### Catalog

**Vendor**:
The organization that publishes one or more APIs.
_Avoid_: Company, provider, service

**API**:
One distinct programmable surface published by a Vendor, identified independently of the names people use for it (e.g. Jira Cloud Platform REST and Confluence are separate APIs of one Vendor).
_Avoid_: Service, app, product

**Spec**:
One OpenAPI or Swagger document describing an API, identified by its content rather than where it was found. Version and format belong to the Spec, not the API: an API has many Specs over time and across formats.
_Avoid_: Swagger file, definition, schema

**Published Form**:
A Spec exactly as its Source serves it. This is what is returned by default, because it is the form that can be traced back to the Vendor.
_Avoid_: Raw spec, original

**Normalized Form**:
swagger.bot's derivative of a Spec, converted to a single current OpenAPI version and format and bundled into one document. Returned only on request.
_Avoid_: Converted spec, canonical spec

**Validity Issue**:
A way in which a Spec departs from the OpenAPI or Swagger standard. Validity Issues are reported alongside a Spec and never prevent it from being returned.
_Avoid_: Validation error, verification failure

**Spec Outline**:
A compact table of contents of a Spec — its tags, operations with their summaries, and authentication schemes — derived mechanically from the Normalized Form so a Caller can navigate a Spec without reading all of it.
_Avoid_: Summary, TOC, overview

**API Version**:
The version of an API that a Spec describes (e.g. Jira REST v3, Stripe 2024-06-20). Several API Versions of one API can be live at once.
_Avoid_: Spec version, release

**Preview Version**:
An API Version the Vendor labels as beta, preview or experimental. Never current.
_Avoid_: Beta spec, unstable version

**Current Spec**:
The Spec of the API Version the Vendor recommends; when the Vendor gives no recommendation, the highest non-preview API Version. It is what a Lookup returns by default.
_Avoid_: Latest spec, default spec

**Alternate Spec**:
A Spec for another live, non-preview API Version of the same API, returned alongside the Current Spec. Alternates are never a sign of ambiguity: ambiguity concerns only which API was meant.
_Avoid_: Other versions, secondary spec

**Superseded Spec**:
A Spec describing an API Version the Vendor no longer offers or recommends. It is kept but never returned by default.
_Avoid_: Old spec, stale spec, deprecated spec

### Provenance

**Source**:
A location where a Spec was found. One Spec may have several Sources.
_Avoid_: Origin, URL, hit

**Provenance**:
How strongly a Source is backed by the Vendor, as one of four ordered tiers: Official, Endorsed, Mirror, Community. A Spec's Provenance is that of its best Source.
_Avoid_: Confidence, trust score, authority

**Official**:
Provenance of a Source hosted at a location the Vendor controls (its domains, its code-hosting organization).

**Endorsed**:
Provenance of a Source hosted elsewhere but linked to from the Vendor's own documentation.

**Mirror**:
Provenance of a Source that is a third-party copy of an Official or Endorsed Spec.
_Avoid_: Copy, cache

**Community**:
Provenance of a Spec authored by a third party with no Official or Endorsed original. A Lookup returns a Community Spec only when the Caller opts in.
_Avoid_: Unofficial, reverse-engineered

### Resolution

**Lookup**:
A request to resolve a name to exactly one API and its Spec. A Lookup never silently picks between plausible APIs; when the name is ambiguous it returns the candidate APIs instead of a Spec.
_Avoid_: Search, query, discovery request

**Caller**:
Whoever makes a Lookup: an agent over MCP, a program over the HTTP API, or a person in the web UI.
_Avoid_: User, client, consumer

**Discovery**:
The work of finding and judging Candidates on the live web, done when the Index cannot answer a Lookup. Discovery, like a Verification the Caller demands, requires an identified Caller; answers from the Index do not.
_Avoid_: Search, crawl, resolution

**Candidate**:
An API, Source or Spec that retrieval has proposed but that has not yet been judged.
_Avoid_: Hit, result, match

**Developer Portal**:
The Vendor's own documentation site for its APIs; the primary place Official Sources are sought.
_Avoid_: Docs site, API site

**Outcome**:
The kind of answer a Lookup gives; exactly one of Resolved, Ambiguous, Unconfirmed, No Spec, Unknown.
_Avoid_: Status, result type

**Resolved**:
Outcome where the name identifies one API and its Current Spec is confirmed to describe that API.

**Ambiguous**:
Outcome where the name could plausibly mean several APIs; the candidate APIs are returned instead of a Spec.

**Unconfirmed**:
Outcome where the API is identified and a Spec was found, but it could not be confirmed that the Spec describes that API (e.g. an internal or test-fixture Spec). The Spec is returned with the reasons for doubt.
_Avoid_: Tentative, low-confidence

**No Spec**:
Outcome where the API is identified but no Spec exists at an allowed Provenance.
_Avoid_: Not found

**Unknown**:
Outcome where the name cannot be matched to any API.
_Avoid_: Not found

**Index**:
swagger.bot's accumulated record of Vendors, APIs, Specs and Sources, built up by Lookups. A Lookup answers from the Index when it can.
_Avoid_: Cache, database, directory

**Verification**:
Confirming against the live web that a Source still serves its Spec and that the Current Spec is still current. Every answer states when it was last verified.
_Avoid_: Refresh, recheck, validation

**Stale**:
An Index entry whose last Verification is older than the freshness window. A Stale entry is still returned, and triggers a background Verification; a Caller may instead demand a fresh Verification before answering.
_Avoid_: Expired, outdated

### Quality

**Benchmark**:
A labelled set of names, each with its expected Outcome and, when Resolved, the correct API and Current Spec Source. It is the measure against which all judgment thresholds are set.
_Avoid_: Test set, eval set, golden set

**False Resolution**:
A Lookup that answers Resolved with the wrong API or a Spec that does not describe it. The error swagger.bot most strives to avoid; an Ambiguous or Unconfirmed answer is always preferred to one.
_Avoid_: False positive, wrong answer
