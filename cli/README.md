# swaggerbot

[swagger.bot](https://swaggerbot.dev) turns the name of an API into a verified OpenAPI/Swagger Spec with its Provenance: where the Spec came from and when it was last checked. When it can't, it says honestly why: the name is Ambiguous, the API has No Spec, or it is Unknown.

This is its command line: the name of an API in, the Spec or the reason out.

## Install

Node 20 or later.

```sh
npm install -g swaggerbot
# or run it without installing
npx swaggerbot lookup "Val Town"
```

## `login`

A name the Index already answers needs no key. Finding a new one on the live web (Discovery), `--fresh` and `key` do: get one at <https://swaggerbot.dev/keys>, then store it:

```sh
swaggerbot login            # asks for the key, hidden; or: echo "$KEY" | swaggerbot login
swaggerbot key              # the key in use and its credits left today
swaggerbot logout           # forget the stored key
```

`login` checks the key with the service (at no cost to its credits) and stores it only when it is live. A command sends `--key <key>`, else `SWAGGERBOT_API_KEY`, else the stored key.

## Commands

| Command | What it does | Example |
|---|---|---|
| `lookup <name>` | Resolves a name to one API and its Current Spec, and prints the Outcome, the Spec's URL and its Provenance. `--api-version V`, `--community`, `--fresh`. | `swaggerbot lookup "Val Town"` |
| `spec <name \| apiId \| specId>` | Downloads a Spec, as its Source published it or (`--form normalized`) as OpenAPI 3.1 JSON; to `-o FILE`, a pipe, or a file in the current directory. | `swaggerbot spec stripe.com/stripe-api \| jq .info` |
| `outline <name \| apiId>` | The Spec Outline: title, servers, security, tags and a table of operations. `--tag T`, `--query Q`, `--all`. | `swaggerbot outline stripe.com/stripe-api --query customers` |
| `operation <name \| apiId> <method> <path>` | One operation, with every `$ref` it reaches inlined. | `swaggerbot operation stripe.com/stripe-api post /v1/customers` |
| `schema <name \| apiId> <schemaName>` | One schema of `components.schemas`, inlined the same way. | `swaggerbot schema stripe.com/stripe-api customer` |
| `vendors [<query>]` | The Vendors in the Index, by name. | `swaggerbot vendors str` |
| `vendor <vendor>` | One Vendor's APIs, each with its Current Spec and download URLs. | `swaggerbot vendor stripe.com` |
| `login`, `key`, `logout` | Store, show and forget an API key (above). | `swaggerbot key` |

An apiId has a `/` (`stripe.com/stripe-api`) and is used as is; a name is looked up first, and only a Resolved answer goes on. `swaggerbot --help` lists every flag.

```
$ swaggerbot lookup "Val Town"
Resolved  Val API (val.town/api)  Official  https://swaggerbot.dev/api/specs/4b446f57…/published  verified 2026-09-24
```

## `--json` and exit codes

`--json` prints the service's answer unchanged, for `jq` and programs, and on a failed request its error body too. When no answer came at all (unreachable, timed out) it prints `{"status":0,"error":"…"}`. `spec --json` prints what it wrote: `{ "specId", "apiId", "form", "path", "bytes", "sha256" }`.

| Exit | Meaning |
|---|---|
| `0` | Resolved, or the command did what it was asked |
| `3` | Ambiguous |
| `4` | Unconfirmed |
| `5` | No Spec |
| `6` | Unknown |
| `1` | Refused or failed: no key, quota used, the service unreachable, a download that isn't its Spec |
| `2` | Usage error |

`--json` exits the same.

## The config file

`login` stores keys in a config file readable only by you (`0600`): `$XDG_CONFIG_HOME/swaggerbot/config.json` (`~/.config/swaggerbot/config.json`), `%APPDATA%\swaggerbot\config.json` on Windows, or wherever `SWAGGERBOT_CONFIG` points. Each key is kept under the origin it was checked with and sent to that origin only. The key is never printed or written anywhere else.

## `--url`

`--url <origin>` (or `SWAGGERBOT_URL`) points the CLI at another swagger.bot than `https://swaggerbot.dev`, such as one running locally. A key stored for one origin is never sent to another. The other global flags are `--no-color` (or `NO_COLOR`), `--version` and `--help`.

## More

- The documentation: <https://swaggerbot.dev/docs#cli>
- The repository: <https://github.com/evolv3ai/swaggerbot>
