# Changelog

The `swaggerbot` CLI's releases. Each is published to npm from a `cli-v<version>` tag.

## 0.1.1

- The `bin` path in `package.json` no longer has a leading `./`, so `npm publish` stops warning that it was invalid and removed. It never was removed: npm only rewrote the path, and 0.1.0's `swaggerbot` command works.

## 0.1.0

The first release, published to npm by hand.

- `lookup`: a name to one API and its Current Spec, with its Outcome and Provenance.
- `spec`: download a Spec by name, apiId or Spec id, as published or in its Normalized Form.
- `outline`, `operation` and `schema`: navigate a Spec without downloading it.
- `vendors` and `vendor`: see what the Index holds.
- `login`, `logout` and `key`: store, forget and show an API key.
- `--json` on every command, and exit codes that tell the Outcomes apart.
