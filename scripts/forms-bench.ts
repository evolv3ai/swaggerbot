/**
 * Build each Spec file's forms and time it:
 * `pnpm tsx scripts/forms-bench.ts [--out <dir>] <file>…`.
 * Prints each step's timing, the finding counts and the peak RSS so far, per
 * file. JSON or YAML is picked by extension. With `--out`, each Normalized
 * Form is also written as `<dir>/<basename>.normalized.json`.
 *
 * For the reviewer, on real large Specs (not committed). External `$ref`s are
 * not fetched.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSpecForms, type SpecFormsStep } from "~/spec-forms/build";

const USAGE = "usage: pnpm tsx scripts/forms-bench.ts [--out <dir>] <file>…";

const args = process.argv.slice(2);
let outDir: string | undefined;
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--out") {
    outDir = args[++i];
    if (!outDir) {
      console.error(USAGE);
      process.exit(2);
    }
  } else if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else {
    files.push(arg);
  }
}
if (files.length === 0) {
  console.error(USAGE);
  process.exit(2);
}
if (outDir) await mkdir(outDir, { recursive: true });

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
let failed = false;

for (const file of files) {
  const ext = extname(file).toLowerCase();
  const format = ext === ".yaml" || ext === ".yml" ? "yaml" : "json";
  const bytes = new Uint8Array(await readFile(file));
  const timings: [SpecFormsStep, number][] = [];
  const start = performance.now();
  let last = start;
  console.log(`${file} (${format}, ${mb(bytes.byteLength)})`);
  try {
    const forms = await buildSpecForms({
      bytes,
      format,
      sourceUrl: pathToFileURL(resolve(file)).href,
      onStep: (step) => {
        const now = performance.now();
        timings.push([step, now - last]);
        last = now;
      },
    });
    for (const [step, ms] of timings)
      console.log(`  ${step.padEnd(20)} ${(ms / 1000).toFixed(3)} s`);
    console.log(
      `  ${"total".padEnd(20)} ${((performance.now() - start) / 1000).toFixed(3)} s`,
    );
    console.log(
      `  normalized ${forms.normalizedSpecVersion}, ${mb(forms.normalized.byteLength)}; ` +
        `validity findings ${forms.validityFindingCount} in ${forms.validityIssues.length} groups; ` +
        `normalized findings ${forms.normalizedFindingCount}; ` +
        `${forms.outline.operations.length} operations, ${forms.outline.tags.length} tags`,
    );
    for (const issue of forms.validityIssues.slice(0, 5))
      console.log(`    ${issue.count} × ${issue.message} (${issue.path})`);
    if (outDir) {
      const name = basename(file, extname(file));
      const out = join(outDir, `${name}.normalized.json`);
      await writeFile(out, forms.normalized);
      console.log(`  wrote ${out}`);
    }
  } catch (error) {
    failed = true;
    console.log(`  failed: ${error instanceof Error ? error.message : error}`);
  }
  console.log(`  peak RSS ${mb(process.resourceUsage().maxRSS * 1024)}`);
}

process.exit(failed ? 1 : 0);
