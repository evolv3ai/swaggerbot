import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { revokedKeys } from "./schema";

/**
 * The Unkey key ids swagger.bot has revoked or rolled away, which
 * `createUnkeyKeys` refuses whatever Unkey's verification answers. A `Set`
 * meets it in tests; `createRevokedKeys` keeps them in the Index, so the
 * app and `scripts/keys.ts` see each other's.
 */
export type RevokedKeys = {
  add(keyId: string): unknown;
  has(keyId: string): boolean;
};

/** The revoked key ids in the Index's `revoked_keys`. */
export function createRevokedKeys(db: Db): RevokedKeys {
  return {
    add(keyId) {
      db.insert(revokedKeys).values({ keyId }).onConflictDoNothing().run();
    },
    has(keyId) {
      return (
        db
          .select({ keyId: revokedKeys.keyId })
          .from(revokedKeys)
          .where(eq(revokedKeys.keyId, keyId))
          .get() !== undefined
      );
    },
  };
}
