import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
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
