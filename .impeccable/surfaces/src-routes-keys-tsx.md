---
version: 1
slug: "src-routes-keys-tsx"
primary_target: "src/routes/keys.tsx"
related_targets: ["src/components/keys/keys-view.tsx"]
---

# Your API key (`/keys`)

**Scope and mode:** one docs page in the shell (Slice 7 #3, WTR-150). Operate: a developer gets, sees, rolls or revokes their one key. It extends Search's surface (`src-routes-index-tsx.md`) and its established world; no direction round.

**Audience, job, proof:** the evaluator who has decided to wire swagger.bot in, and the developer whose agent hit a 401 on Discovery. They leave with a key in their clipboard and the `curl` and `claude mcp add` lines already filled in. Proof is their own key's live figures: its start, created day, today's credits of the limit and when they reset, in words ("resets at midnight UTC, in 5 h").

**States:** signed out (what a key unlocks, the quota, "Sign in to get a key"); signed in without a key ("Create your key"); the once-only secret (the view's one outlined box, focused when it appears, "Store it now: it won't be shown again"); with a key (a content card of facts, Roll… and Revoke…, each confirmed inline in the card, not in a dialog); keys unreachable (503, Try again); without Unkey or WorkOS, issued by hand with the `mailto:`.

**Constraints:** the secret is only ever in the answer that issued it and the page's own state, never in loader data, a URL, storage or a log. The page takes no key id from the browser. One primary action per view (Sign in, or Create); Roll and Revoke are secondary. No new component: Card edges, `CodeBlock`, `Button`, the `H2` headings.

**Unresolved:** there is no danger button in the kit, so Revoke is secondary; build the kit's `danger` button if a second destructive action appears.
