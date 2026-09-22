import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db";

describe("openDb", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("opens the file in WAL mode with foreign keys on", () => {
    const dir = mkdtempSync(join(tmpdir(), "swaggerbot-db-"));
    dirs.push(dir);
    const db = openDb(join(dir, "nested", "test.db"));

    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);

    db.$client.close();
  });
});
