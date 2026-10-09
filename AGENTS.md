# swagger.bot

swagger.bot turns the name of an API into a verified OpenAPI/Swagger Spec with its Provenance, or says honestly why it can't. It is a single TanStack Start app (HTTP API, MCP endpoint and web UI) with the Index in SQLite.

## Read before working

- [`docs/PRD.md`](docs/PRD.md): what to build and why.
- [`CONTEXT.md`](CONTEXT.md): the glossary. Use its terms exactly in code, types and docs.
- [`docs/adr/`](docs/adr/): decisions already made.
- [`docs/development.md`](docs/development.md): layout, commands, test rules, environment variables.
- [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md): for UI work.

## Rules that are easy to break

- Before opening a PR, all green: `pnpm check` and `pnpm build`.
- No test may call a real external service. Fake it (see `docs/development.md`).
- Never commit `.env`, `.env.local`, `data/` or a database file.
- Don't edit `docs/PRD.md`, `CONTEXT.md` or `docs/adr/` as part of a change; if the design is wrong or silent, say so in the PR description.

## Maintaining this file

Keep this file for knowledge useful to almost every future session. Point to the authoritative doc instead of repeating it. Prefer rewriting or pruning over appending.
