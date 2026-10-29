# Releasing the CLI

The `swaggerbot` npm package (`cli/`) is staged on npm by `.github/workflows/release-cli.yml` when a `cli-v<version>` tag is pushed, through npm trusted publishing (OIDC, with provenance; there is no `NPM_TOKEN`). The release goes live only when a maintainer approves it on npmjs.com.

1. Bump `version` in `cli/package.json`.
2. Add the version's entry at the top of `cli/CHANGELOG.md`.
3. Merge that to `main`, then, with the captain's word, tag the merge commit `cli-v<version>` (`git tag cli-v0.2.0`).
4. Push the tag: `git push origin cli-v0.2.0`.
5. The run uploads the release to the package's **Staged Packages** on npmjs.com. A green run means the upload finished, not that the release is live: it waits there until it is approved.
6. The captain approves the version in Staged Packages (or `npm stage approve <stage-id>`; approving asks for 2FA).
7. Check it is live: `npm view swaggerbot version` prints the new version, and `npx swaggerbot@<version> --version` prints it too.

The workflow runs `pnpm check` and `pnpm build:cli`, fails unless the tag's version is `cli/package.json`'s (`src/cli/release.ts`) and the bundle's `--version` prints it, checks that npm has `npm stage` (npm 11.15.0 or later; Node 24's bundled npm has it), then runs `npm stage publish --provenance --access public` in `cli/`.

To try it without uploading, run the workflow by hand (Actions → Release CLI → Run workflow) with the tag to check and `dry-run` on; `gh workflow run release-cli.yml --ref <branch> -f tag=cli-v<version> -f dry-run=true` does the same.

npm must trust the workflow first: on npmjs.com, the package's settings name the repository `evolv3ai/swaggerbot` and the workflow `release-cli.yml` as its trusted publisher, with the permissions `npm publish` and `npm stage publish`, so it allows both direct and staged publishing. The workflow uses `npm stage publish` by choice, so every release waits for a maintainer's approval. Before `npm publish` was allowed too, the first 0.1.1 run used a plain `npm publish` and failed after signing provenance with `403 Forbidden - PUT https://registry.npmjs.org/swaggerbot - OIDC permission denied for this action`; nothing was published. See npm's [staged publishing](https://docs.npmjs.com/staged-publishing) and [`npm stage`](https://docs.npmjs.com/cli/v11/commands/npm-stage) docs.
