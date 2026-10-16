# swaggerbot

The [swagger.bot](https://swaggerbot.dev) CLI: the name of an API in, its verified OpenAPI/Swagger Spec with its Provenance out, or an honest reason why not.

## Install

Node 20 or later.

```sh
npm install -g swaggerbot
# or run it without installing
npx swaggerbot lookup "Val Town"
```

## `lookup`

```sh
swaggerbot lookup <name> [--api-version V] [--community] [--fresh] [--json]
```

Resolves `<name>` to exactly one API and its Current Spec, and prints one line: the Outcome (Resolved, Ambiguous, Unconfirmed, No Spec or Unknown), the Spec's URL and its Provenance where there is one.

```
$ swaggerbot lookup "Val Town"
Resolved  Val API (val.town/api)  Official  https://swaggerbot.dev/api/specs/4b446f57…/published  verified 2026-09-24
```

- `--api-version V` asks for the Spec of that API Version instead of the Current Spec.
- `--community` allows a Community Spec when no Official, Endorsed or Mirror one exists.
- `--fresh` demands a Verification against the live web before answering. Needs an API key.
- `--json` prints the answer exactly as the HTTP API gives it, for `jq` and programs: the Outcome, or on a failed request the HTTP API's error body too. When no answer came at all (unreachable, timed out) it prints `{"status":0,"error":"…"}`.

A name the Index already answers needs no key. Finding a new one on the live web is Discovery, which does: get one at <https://swaggerbot.dev/keys>, then either store it with `swaggerbot login` or pass it with `--key <key>` or `SWAGGERBOT_API_KEY`.

Exit codes: `0` Resolved, `1` any other Outcome, `2` usage error, `3` the request failed (no key, quota used, the service unreachable).

## `login`, `logout` and `key`

```sh
swaggerbot login [--key <key>]
swaggerbot key
swaggerbot logout
```

`login` checks a key with the service (at no cost to its credits) and stores it, so later commands send it without `--key`. The key comes from `--key`, else `login` asks for it: typed hidden at a terminal, or read from the pipe (`echo "$KEY" | swaggerbot login`). It is stored only when the service says it is live; a key that isn't is said so and stored nowhere.

```
$ swaggerbot login
API key (hidden):
Signed in to https://swaggerbot.dev as key_abcd2345: 87 credits left today
$ swaggerbot key
key_abcd2345  87 credits left today of 100  resets at 00:00 UTC, in 5 h
$ swaggerbot logout
Signed out of https://swaggerbot.dev: the stored key is forgotten
```

`key` shows the key in use: its id, the credits left today and when they reset. `logout` forgets the stored key, and says so when there was none.

The key a command sends is `--key`, else `SWAGGERBOT_API_KEY`, else the one `login` stored for the swagger.bot it talks to. Stored keys live in a config file, readable only by you (`0600`): `$XDG_CONFIG_HOME/swaggerbot/config.json` (`~/.config/swaggerbot/config.json`), `%APPDATA%\swaggerbot\config.json` on Windows, or wherever `SWAGGERBOT_CONFIG` points. Each key is kept under the origin it was checked with and sent to that origin only: `--url` pointing elsewhere never receives it. The key is never printed or written anywhere else.

With `--json`, `login` and `key` print the service's answer (`{ "id", "remaining"?, "limit"?, "resetsAt"? }`) as is, and `logout` prints `{ "url", "removed" }`.

Global flags: `--url <origin>` (or `SWAGGERBOT_URL`) points the CLI at another swagger.bot; `--no-color` (or `NO_COLOR`) turns colour off; `--version`; `--help`.
