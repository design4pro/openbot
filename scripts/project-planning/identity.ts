import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { Effect } from "effect";
import { OpenBotDatabase } from "../../src/backend/openbot-database";
import { migrateOpenBotDatabase } from "../../src/backend/openbot-database-schema";

const execute = promisify(execFile);

export async function openIdentityProfile(path: string) {
  const db = new OpenBotDatabase(path);
  await Effect.runPromise(db.initialize());
  try {
    return db.localIdentity.read();
  } finally {
    db.close();
  }
}

export async function identityCases(root: string): Promise<string[]> {
  const cases: string[] = [];
  const profile = join(root, "profile");
  const original = await openIdentityProfile(profile);
  assert.deepEqual(await openIdentityProfile(profile), original);
  cases.push("identity-reopen");
  const copied = join(root, "copied-profile");
  await cp(profile, copied, { recursive: true });
  assert.deepEqual(await openIdentityProfile(copied), original);
  cases.push("identity-copy");
  const fresh = await openIdentityProfile(join(root, "fresh-profile"));
  assert.notEqual(fresh.principalId, original.principalId);
  assert.notEqual(fresh.localScopeId, original.localScopeId);
  cases.push("identity-new-profile");

  for (const upgraded of [false, true]) {
    const concurrent = join(root, upgraded ? "concurrent-upgrade" : "concurrent-profile");
    await mkdir(concurrent, { recursive: true });
    if (upgraded) {
      const old = new DatabaseSync(join(concurrent, "openbot.db"));
      try {
        old.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
          CREATE TEMP TRIGGER stop_local BEFORE INSERT ON schema_migrations WHEN new.version=50
          BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
        assert.throws(() => migrateOpenBotDatabase(old), /migration to version 50 failed/);
      } finally {
        old.close();
      }
    }
    const args = ["--import", "tsx", process.argv[1] ?? "", "--identity-worker", concurrent];
    const settled = await Promise.allSettled([
      execute(process.execPath, args, { timeout: 30_000 }),
      execute(process.execPath, args, { timeout: 30_000 }),
    ]);
    const results = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    assert.deepEqual(JSON.parse(results[0]?.stdout ?? ""), JSON.parse(results[1]?.stdout ?? ""));
    assert.deepEqual(await openIdentityProfile(concurrent), JSON.parse(results[0]?.stdout ?? ""));
  }
  cases.push("identity-concurrent");

  for (const table of ["local_profile_identity", "local_profile_identity_bootstrap"]) {
    const corrupted = join(root, `missing-${table}`);
    await cp(profile, corrupted, { recursive: true });
    const db = new OpenBotDatabase(corrupted);
    await Effect.runPromise(db.initialize());
    try {
      db.connection.exec(`DELETE FROM ${table}`);
      assert.throws(() => db.localIdentity.read(), { code: "identity_invalid" });
      assert.equal(db.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
    } finally {
      db.close();
    }
    const reopened = new OpenBotDatabase(corrupted);
    await Effect.runPromise(reopened.initialize());
    try {
      assert.throws(() => reopened.localIdentity.read(), { code: "identity_invalid" });
      assert.equal(reopened.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
    } finally {
      reopened.close();
    }
  }
  const malformed = new OpenBotDatabase(join(root, "invalid-identity"));
  await Effect.runPromise(malformed.initialize());
  try {
    malformed.connection.exec("UPDATE local_profile_identity SET principal_id='not-a-uuid'");
    assert.throws(() => malformed.localIdentity.read(), { code: "identity_invalid" });
    assert.equal(
      malformed.connection.prepare("SELECT principal_id FROM local_profile_identity").get()?.principal_id,
      "not-a-uuid",
    );
  } finally {
    malformed.close();
  }
  cases.push("identity-corruption");
  return cases;
}
