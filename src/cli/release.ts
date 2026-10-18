// The release workflow's version check (.github/workflows/release-cli.yml):
// a `cli-v<version>` tag publishes only the version `cli/package.json` says.
// Run as `tsx src/cli/release.ts <tag>`; it prints the version, or exits 1.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** What a release tag checked against the package's version came to. */
export type ReleaseCheck =
  | { ok: true; version: string }
  | { ok: false; error: string };

/** The tag must be `cli-v` followed by exactly the package's version. */
export function checkReleaseTag(tag: string, version: string): ReleaseCheck {
  if (!tag.startsWith("cli-v")) {
    return { ok: false, error: `${tag} is not a cli-v<version> tag.` };
  }
  const tagged = tag.slice("cli-v".length);
  if (tagged !== version) {
    return {
      ok: false,
      error: `${tag} is version ${tagged}, but cli/package.json is ${version}.`,
    };
  }
  return { ok: true, version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkgPath = fileURLToPath(
    new URL("../../cli/package.json", import.meta.url),
  );
  const { version } = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    version: string;
  };
  const result = checkReleaseTag(process.argv[2] ?? "", version);
  if (result.ok) {
    process.stdout.write(`${result.version}\n`);
  } else {
    process.stderr.write(`error  ${result.error}\n`);
    process.exitCode = 1;
  }
}
