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

## `spec`

```sh
swaggerbot spec <name | apiId | specId> [--form published|normalized] [--api-version V] [-o FILE] [--force] [--no-wait] [--json]
```

Downloads a Spec: the file itself, without copying a URL from `lookup`.

- A Spec id (64 hex characters) is downloaded as is, with no Lookup.
- An apiId (it has a `/`, like `stripe.com/stripe-api`) gives that API's Current Spec.
- A name is looked up. Only a Resolved answer is downloaded: its Current Spec, or with `--api-version V` its Spec of that API Version (if it has none, `spec` says which API Versions it has). Any other Outcome is printed as `lookup` prints it, with its exit code, and nothing is downloaded.

`--form published` (the default) is the Spec byte for byte as its Source published it; its sha256 must be its Spec id, or `spec` says so, keeps nothing and exits 1. `--form normalized` is the Normalized Form (OpenAPI 3.1 JSON). While it is being built `spec` waits, as the service asks, up to 2 minutes, saying "Normalized Form being built…"; `--no-wait` exits 1 at once instead. A Normalized Form that couldn't be built is said so, exit 1.

The bytes go to `-o FILE`; else to stdout when it is a pipe (`swaggerbot spec stripe.com/stripe-api | jq .info`); else, at a terminal, to the file the service names, in the current directory, never overwriting one that is there without `--force`. A file is said on stderr: `Wrote stripe-api-a1b2c3d4e5f6.json (6.1 MB)`.

`--json` prints what was written, on stdout, once it is: `{ "specId", "apiId", "form", "path", "bytes", "sha256" }` (`apiId` is `null` for a Spec id, which names no API). As stdout can't carry both the bytes and that, `--json` needs `-o FILE` or a terminal.

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

The key a command sends is `--key`, else `SWAGGERBOT_API_KEY`, else the one `login` stored for the swagger.bot it talks to. The stored key is read only when a command needs one: `key`, `--fresh`, and a `lookup` the Index can't answer, which is then sent again with it. Stored keys live in a config file, readable only by you (`0600`): `$XDG_CONFIG_HOME/swaggerbot/config.json` (`~/.config/swaggerbot/config.json`), `%APPDATA%\swaggerbot\config.json` on Windows, or wherever `SWAGGERBOT_CONFIG` points. Each key is kept under the origin it was checked with and sent to that origin only: `--url` pointing elsewhere never receives it. The key is never printed or written anywhere else. A config file that isn't JSON is read as holding no key, with a warning on stderr, and the next `login` or `logout` replaces it.

With `--json`, `login` and `key` print the service's answer (`{ "id", "remaining"?, "limit"?, "resetsAt"? }`) as is, and `logout` prints `{ "url", "removed" }`.

Global flags: `--url <origin>` (or `SWAGGERBOT_URL`) points the CLI at another swagger.bot; `--no-color` (or `NO_COLOR`) turns colour off; `--version`; `--help`.

## Exit codes

`0` Resolved, or the command did what it was asked; `3` Ambiguous; `4` Unconfirmed; `5` No Spec; `6` Unknown; `1` refused or failed (no key, quota used, the service unreachable, a download that isn't its Spec); `2` usage error. `--json` exits the same.
