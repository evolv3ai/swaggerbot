// What an "Ask this Spec" turn would send the model for a question, without
// calling one: the grounding `groundingFor` picks from a Normalized Form (one
// copied out of an Index's `spec_forms.normalized_bytes`, say), each
// document's title and bytes, the totals and the words that matched nothing.
// --text also prints each document's text.
// Usage: pnpm tsx scripts/chat-retrieve.ts [--text] <normalized.json> "<question>"
import { readFile } from "node:fs/promises";
import { groundingFor } from "../src/chat/retrieve";
import { outlineOf } from "../src/spec-forms/build";

const args = process.argv.slice(2);
const at = args.indexOf("--text");
const showText = at !== -1;
if (showText) args.splice(at, 1);
const [file, question] = args;
if (!file || !question) {
  console.error(
    'usage: pnpm tsx scripts/chat-retrieve.ts [--text] <normalized.json> "<question>"',
  );
  process.exit(2);
}

const doc = JSON.parse(await readFile(file, "utf8"));
const outline = outlineOf(doc);
const { documents, stats } = groundingFor(question, [], {
  outline,
  doc,
  apiId: "(local)",
  specId: "(local)",
});

console.log(`question: ${question}`);
for (const document of documents) {
  const size = Buffer.byteLength(document.text);
  const cut = document.text.includes('"truncated": true') ? ", truncated" : "";
  console.log(`  ${document.title}: ${size} bytes${cut}`);
  if (showText) console.log(document.text);
}
console.log(
  `total: ${stats.bytes} bytes (facts ${stats.factsBytes}, ${stats.operations} operations ${stats.operationBytes}, ${stats.schemas} schemas ${stats.schemaBytes}); truncated: ${stats.truncated}; unmatched words: ${stats.unmatchedWords.join(", ") || "none"}`,
);
