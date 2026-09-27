import type { Db } from "./db";
import { createKeys, type KeyStore } from "./keys";
import {
  createUnkeyClient,
  createUnkeyKeys,
  type UnkeyClient,
} from "./unkey-keys";

/**
 * Unkey's API and root key from the environment, when both are set, and
 * the API's keyspace (`UNKEY_KEYSPACE_ID`, `ks_…`) that verification is
 * limited to, when that is set too.
 */
export function unkeyConfigOf(
  env: Record<string, string | undefined>,
): { rootKey: string; apiId: string; keyspaceId?: string } | undefined {
  const rootKey = env.UNKEY_ROOT_KEY?.trim();
  const apiId = env.UNKEY_API_ID?.trim();
  const keyspaceId = env.UNKEY_KEYSPACE_ID?.trim() || undefined;
  return rootKey && apiId ? { rootKey, apiId, keyspaceId } : undefined;
}

/**
 * The key store the app runs on (D9): Unkey when `UNKEY_ROOT_KEY` and
 * `UNKEY_API_ID` are set, else the keys in the Index. Logs which, once per
 * call: `keys: unkey` or `keys: local`.
 */
export function createKeyStore(
  db: Db,
  env: Record<string, string | undefined> = process.env,
  {
    log = console.log,
    unkeyClient = createUnkeyClient,
  }: {
    log?: (message: string) => void;
    unkeyClient?: (rootKey: string) => UnkeyClient;
  } = {},
): KeyStore {
  const unkey = unkeyConfigOf(env);
  if (!unkey) {
    log("keys: local");
    return createKeys(db, env);
  }
  log("keys: unkey");
  return createUnkeyKeys({
    client: unkeyClient(unkey.rootKey),
    apiId: unkey.apiId,
    keyspaceId: unkey.keyspaceId,
    env,
  });
}
