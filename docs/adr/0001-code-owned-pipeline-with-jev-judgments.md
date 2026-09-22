---
status: accepted
---

# Code-owned pipeline with Jev judgments

Resolution is a deterministic pipeline written in code: code retrieves candidates (registries, search, crawled links, fetched specs), and TypeSafe's Jev (a System One model) makes the narrow semantic judgments — which API a name means, which candidate or link is the spec, how authoritative a source is, whether a fetched spec matches the request. Low-confidence judgments are not escalated server-side: they are returned to the caller as an unresolved result (candidates, probabilities, reasons), because the typical caller — an agent over MCP — is itself a reasoning model holding more intent context than we do; human curation of the Index may follow later. We chose this over the original PRD's agentic design (LangGraph JS orchestration, Stagehand-driven browsing, OpenRouter LLM calls in the hot path) because it keeps each lookup cheap, fast and predictable, and turns "confidence" into calibrated probabilities that can be combined in code and evaluated against a labelled set.

## Consequences

- LangGraph JS is dropped; there is no agent loop choosing its own next step.
- Browser automation becomes a fallback for JS-rendered pages rather than a primary discovery strategy.
- Jev is never asked to generate text, count, compare dates, or read whole specs (64k context); code does those, and only extracted fields are sent as state.
- No server-side reasoning LLM in v1, so TanStack AI is not used; revisit if callers demonstrably cannot handle unresolved results.
- Jev sits behind a narrow judgment interface so the vendor can be swapped.
