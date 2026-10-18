import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { PROVENANCE_TIERS } from "../domain/provenance";

// Timestamps are ISO-8601 text in UTC, as written by `new Date().toISOString()`.
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const apis = sqliteTable(
  "apis",
  {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendors.id),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("apis_vendor_id_idx").on(t.vendorId)],
);

export const specs = sqliteTable(
  "specs",
  {
    /** Lowercase hex sha256 of `published_bytes`. */
    id: text("id").primaryKey(),
    apiId: text("api_id")
      .notNull()
      .references(() => apis.id),
    specVersion: text("spec_version").notNull(),
    apiVersion: text("api_version"),
    isPreview: integer("is_preview", { mode: "boolean" })
      .notNull()
      .default(false),
    format: text("format", { enum: ["json", "yaml"] }).notNull(),
    byteLength: integer("byte_length").notNull(),
    publishedBytes: blob("published_bytes", { mode: "buffer" }).notNull(),
    /**
     * When a Lookup confirmed that this Spec describes its API; null while it
     * is only Unconfirmed. Only a confirmed Spec is answered Resolved from the Index.
     */
    confirmedAt: text("confirmed_at"),
    /**
     * When every Source of this Spec was seen serving something else, or
     * nothing; null while any may still serve it. A Superseded Spec is kept
     * but never returned by default.
     */
    supersededAt: text("superseded_at"),
    /** How many paths it has; null for a Spec stored before this was kept. */
    pathCount: integer("path_count"),
    /** Its Vendor marks it deprecated at the start of its title or description. */
    deprecated: integer("deprecated", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * Its place among the Choice's origin URLs when it was found at one;
     * null otherwise. Among Specs of one API Version, the earliest is Current.
     */
    originRank: integer("origin_rank"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("specs_api_id_idx").on(t.apiId)],
);

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    specId: text("spec_id")
      .notNull()
      .references(() => specs.id),
    url: text("url").notNull(),
    provenance: text("provenance", { enum: PROVENANCE_TIERS }).notNull(),
    firstSeenAt: text("first_seen_at").notNull().default(now),
    lastVerifiedAt: text("last_verified_at").notNull().default(now),
  },
  (t) => [uniqueIndex("sources_spec_id_url_uq").on(t.specId, t.url)],
);

export const apiNames = sqliteTable(
  "api_names",
  {
    /** A name as `normalizeName` leaves it. */
    nameNormalized: text("name_normalized").primaryKey(),
    apiId: text("api_id")
      .notNull()
      .references(() => apis.id),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("api_names_api_id_idx").on(t.apiId)],
);

export const apiKeys = sqliteTable("api_keys", {
  /** `key_` + 8 base32 characters; safe to show. */
  id: text("id").primaryKey(),
  /** Who the key was issued to. */
  owner: text("owner").notNull(),
  /** Lowercase hex sha256 of the secret; the secret itself is never stored. */
  keyHash: text("key_hash").notNull().unique(),
  /** Discovery or `fresh` Lookups a UTC day; null means the default. */
  dailyQuota: integer("daily_quota"),
  createdAt: text("created_at").notNull().default(now),
  /** When it was revoked; null while it is live. */
  revokedAt: text("revoked_at"),
});

export const apiKeyUsage = sqliteTable(
  "api_key_usage",
  {
    keyId: text("key_id")
      .notNull()
      .references(() => apiKeys.id),
    /** A UTC day, `YYYY-MM-DD`. */
    day: text("day").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.day] })],
);

/** The background Verification queue (ADR 0002): one row per name. */
export const verifications = sqliteTable("verifications", {
  /** A name as `normalizeName` leaves it. */
  nameNormalized: text("name_normalized").primaryKey(),
  /** The spelling from the Lookup that last queued it; the worker looks this up. */
  name: text("name").notNull(),
  requestedAt: text("requested_at").notNull().default(now),
  /** When the worker took it; null while it waits. */
  startedAt: text("started_at"),
  /** When it last finished, or gave up; null while it waits or runs. */
  finishedAt: text("finished_at"),
  /** Failed runs since it was queued. */
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

/**
 * A Spec's Normalized Form, Validity Issues and Spec Outline, built in the
 * background (ADR 0004): at most one row per Spec. A Spec with no row, or a
 * `building` row a stopped process left behind, is pending.
 */
export const specForms = sqliteTable("spec_forms", {
  specId: text("spec_id")
    .primaryKey()
    .references(() => specs.id),
  status: text("status", { enum: ["building", "ready", "failed"] }).notNull(),
  /** The Normalized Form, as minified JSON. */
  normalizedBytes: blob("normalized_bytes", { mode: "buffer" }),
  normalizedSpecVersion: text("normalized_spec_version"),
  /** `ValidityIssue[]` as JSON: every group of findings on the Published Form. */
  validityIssues: text("validity_issues"),
  validityFindingCount: integer("validity_finding_count"),
  /** Findings left on the Normalized Form: our defect, not a Validity Issue. */
  normalizedFindingCount: integer("normalized_finding_count"),
  /** `SpecOutline` as JSON. */
  outline: text("outline"),
  /** Failed builds so far. */
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  startedAt: text("started_at"),
  builtAt: text("built_at"),
  /**
   * Whether a build fetches external references, which picks the worker's
   * lane; `null` until a build has found out.
   */
  externalRefs: integer("external_refs", { mode: "boolean" }),
  /**
   * The `FORMS_BUILDER_VERSION` that built the stored forms; `null`, from
   * before the column existed, is older than any version.
   */
  builderVersion: integer("builder_version"),
});

/** Questions a signed-in person asked Ask this Spec, per UTC day (Slice 9, D4). */
export const chatUsage = sqliteTable(
  "chat_usage",
  {
    /** The person's WorkOS user id. */
    userId: text("user_id").notNull(),
    /** A UTC day, `YYYY-MM-DD`. */
    day: text("day").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/**
 * One row per Ask this Spec turn (Slice 9, D8): what it cost and how it
 * ended. `question` and `answer` stay null unless `CHAT_LOG_TEXT=1`; never
 * a key or a secret. Rows older than 90 days are deleted.
 */
export const chatTurns = sqliteTable(
  "chat_turns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: text("at").notNull().default(now),
    specId: text("spec_id").notNull(),
    apiId: text("api_id").notNull(),
    /** The person's WorkOS user id. */
    userId: text("user_id").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    /** Input tokens not read from the cache. */
    inputTokens: integer("input_tokens").notNull().default(0),
    /** Input tokens read from the cache. */
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull(),
    operationsSent: integer("operations_sent").notNull().default(0),
    schemasSent: integer("schemas_sent").notNull().default(0),
    bytesSent: integer("bytes_sent").notNull().default(0),
    citations: integer("citations").notNull().default(0),
    /** The model's `stop_reason`; null when the turn ended in an error first. */
    stopReason: text("stop_reason"),
    /** With a `refusal` stop reason, its category when one was given. */
    refusalCategory: text("refusal_category"),
    /** The error's class, when the turn failed; never its message. */
    error: text("error"),
    question: text("question"),
    answer: text("answer"),
  },
  (t) => [index("chat_turns_at_idx").on(t.at)],
);
