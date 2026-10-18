/**
 * The words of a question, as retrieval (`retrieve.ts`) and the chat
 * Benchmark's scorer both read them: one tokenizer and one stop list, so
 * the two never disagree about what a question asked.
 */

/**
 * Words that say nothing about which part of a Spec a question is about:
 * English function words and the words every question about an API uses.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "api",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "but",
  "by",
  "call",
  "calls",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "each",
  "endpoint",
  "endpoints",
  "example",
  "examples",
  "field",
  "fields",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "need",
  "object",
  "objects",
  "of",
  "on",
  "one",
  "or",
  "our",
  "param",
  "parameter",
  "parameters",
  "params",
  "please",
  "request",
  "requests",
  "response",
  "responses",
  "should",
  "so",
  "some",
  "spec",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "use",
  "using",
  "want",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "work",
  "works",
  "would",
  "you",
  "your",
]);

/**
 * The tokens of `text`, lowercased: split on anything but a letter or a
 * digit, and between the words of a camelCase identifier
 * (`PostCustomers` → `post`, `customers`). Stop words are kept.
 */
export function tokensOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== "");
}

/**
 * The words of a question: its tokens (`tokensOf`) of 2 characters or more
 * that are not stop words, each once, in the order they first appear.
 */
export function wordsOf(text: string): string[] {
  return [
    ...new Set(
      tokensOf(text).filter((t) => t.length >= 2 && !STOP_WORDS.has(t)),
    ),
  ];
}

/**
 * A word's stem, so that the singular and the plural meet: `customers` and
 * `customer`, `addresses` and `address`, `policies` and `policy`. Nothing
 * cleverer: a stem is only ever compared with another stem.
 */
export function stemOf(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word))
    return word.slice(0, -1);
  return word;
}
