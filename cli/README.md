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
- `--json` prints the Outcome exactly as the HTTP API answers it, for `jq` and programs.

A name the Index already answers needs no key. Finding a new one on the live web is Discovery, which does: get one at <https://swaggerbot.dev/keys> and pass it with `--key <key>` or `SWAGGERBOT_API_KEY`.

Exit codes: `0` Resolved, `1` any other Outcome, `2` usage error, `3` the request failed (no key, quota used, the service unreachable).

Global flags: `--url <origin>` (or `SWAGGERBOT_URL`) points the CLI at another swagger.bot; `--no-color` (or `NO_COLOR`) turns colour off; `--version`; `--help`.

## License

MIT. Source: <https://github.com/evolv3ai/swaggerbot>.
