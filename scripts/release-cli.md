# Releasing the CLI

The `swaggerbot` npm package (`cli/`) is published by `.github/workflows/release-cli.yml` when a `cli-v<version>` tag is pushed, through npm trusted publishing (OIDC, with provenance; there is no `NPM_TOKEN`).

1. Bump `version` in `cli/package.json`.
2. Add the version's entry at the top of `cli/CHANGELOG.md`.
3. Merge that to `main`, then tag the merge commit `cli-v<version>` (`git tag cli-v0.2.0`).
4. Push the tag: `git push origin cli-v0.2.0`.

The workflow runs `pnpm check` and `pnpm build:cli`, fails unless the tag's version is `cli/package.json`'s (`src/cli/release.ts`) and the bundle's `--version` prints it, then runs `npm publish --provenance --access public` in `cli/`.

To try it without publishing, run the workflow by hand (Actions → Release CLI → Run workflow) with the tag to check and `dry-run` on; `gh workflow run release-cli.yml --ref <branch> -f tag=cli-v<version> -f dry-run=true` does the same.

npm must trust the workflow first: on npmjs.com, the package's settings name the repository `evolv3ai/swaggerbot` and the workflow `release-cli.yml` as its trusted publisher.
