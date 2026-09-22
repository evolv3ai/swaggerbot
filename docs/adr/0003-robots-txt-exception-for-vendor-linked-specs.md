---
status: accepted
---

# One Vendor-linked Spec is fetched despite robots.txt

swagger.bot respects `robots.txt` when it crawls. It makes one narrow
exception: when a page we were allowed to fetch, on the Vendor's own
Developer Portal, links to a Spec document, that **single document** is
retrieved once even if its host's `robots.txt` disallows it. We never crawl on
from such a document, and the exception never applies to a page we only want to
read for links.

The reason is that a Vendor publishes a Spec in order for it to be used, and
then serves it from an application host whose `robots.txt` was written to keep
search engines out of an app, not to withhold the Spec. `api.val.town`
disallows `/`, which blocks its whole API host, while `docs.val.town/openapi`
links to `https://api.val.town/openapi.json` for readers to take. Treating that
blanket rule as a refusal would mean answering No Spec for an API whose Vendor
publishes and advertises one.

The limit of the argument is deliberateness. `codeberg.org` disallows
`/swagger.*.json` by name, which is a decision about that exact file rather
than a side effect of an app-wide rule; and the page that links it,
`codeberg.org/api/swagger`, is itself under a disallowed path, so we never
reach the link legitimately. Codeberg therefore stays No Spec. If a Vendor
names the Spec in `robots.txt`, or hides the linking page too, we take it at
its word.

## Consequences

- The fetcher needs a way to retrieve one URL with the robots check skipped,
  used only by the Spec-finding step and only for a URL discovered as a link on
  an allowed Vendor page. Known-path probing, portal crawling and every other
  fetch keep obeying `robots.txt`.
- The User-Agent stays honest and the per-host rate limit still applies, so a
  Vendor can still identify and throttle us.
- A Spec retrieved this way is recorded with a diagnostic saying the host's
  `robots.txt` disallowed it, so the reason is visible in the answer rather than
  buried.
- The PRD's crawling etiquette is amended to match (decided by Wes,
  2026-09-22).
