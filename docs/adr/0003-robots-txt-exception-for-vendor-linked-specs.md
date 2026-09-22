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

## Amendment: a known path on the Vendor's own API host (Wes, 2026-09-22)

The exception above is written around a **link**, and that assumption has aged
badly. Checked live on 2026-09-22, `docs.val.town/openapi` — the very page this
ADR was built on — is now a Scalar single-page app: 2,654 bytes, two `<a href>`s,
and `api.val.town` present only inside the Scalar configuration. A crawl of it
finds nothing. `fly.io/docs/machines/api/` is the same shape, and so are a
growing number of Developer Portals, because reference documentation is
increasingly rendered from a Spec the page never links in its HTML.

The reasoning that justified the exception doesn't depend on the link, though.
It rests on the Vendor publishing a Spec in order for it to be used, while
serving it from an application host whose `robots.txt` was written to keep
search engines out of an app. That is just as true when we find the Spec by
probing a **known path** on the Vendor's own API host as when we follow a link
to it.

So the exception widens: **a single Spec document at a known path on the
Vendor's own API host is retrieved once even when that host's `robots.txt`
disallows it**, under the same limits as before — one document, one fetch, never
crawled on from, the honest User-Agent and the per-host rate limit still
applying, and the answer still recording that `robots.txt` disallowed it.

What does **not** widen is deliberateness, and that is still where the line is.
A Vendor that names the Spec file in `robots.txt`, as Codeberg does with
`/swagger.*.json`, is refusing that file specifically rather than shuttering an
app, and we take it at its word. Codeberg stays No Spec. The exception also
still applies only to the Vendor's **own** API host, never to a third party's.
