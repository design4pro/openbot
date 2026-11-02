// @vitest-environment node
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: local bootstrap loses existing history, creates two owners, or commits its marker
// without the identity; foreign project references are accepted; a failed migration cannot retry.
const connections: DatabaseSync[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
});

function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  connections.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

function atVersion(version: number): DatabaseSync {
  const db = open();
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  try {
    migrateOpenBotDatabase(db);
  } catch (error) {
    if (!(error instanceof Error && error.cause instanceof Error && error.cause.message === "fixture stop"))
      throw error;
  }
  db.exec("DROP TRIGGER stop_version");
  return db;
}

function seedHistory(db: DatabaseSync): void {
  db.exec(`INSERT INTO orchestration_events
    (event_id,command_id,aggregate_type,aggregate_id,event_type,occurred_at,payload_json)
    VALUES ('kept-event','kept-command','thread','kept-thread','thread.snapshot','2026-01-01','{"private":"kept"}');
    INSERT INTO orchestration_command_receipts
    (command_id,accepted_at,first_sequence,last_sequence,result_json)
    VALUES ('kept-command','2026-01-01',1,1,'{"outcome":"kept"}');
    INSERT INTO projection_threads
    (thread_id,agent_id,title,created_at,updated_at,last_event_sequence)
    VALUES ('kept-thread','agent-kept','Kept 界','2026-01-01','2026-01-01',1);`);
}

function history(db: DatabaseSync) {
  return {
    events: db.prepare("SELECT * FROM orchestration_events WHERE event_id='kept-event'").all(),
    receipts: db.prepare("SELECT * FROM orchestration_command_receipts WHERE command_id='kept-command'").all(),
    threads: db.prepare("SELECT * FROM projection_threads WHERE thread_id='kept-thread'").all(),
  };
}

function expectIdentity(db: DatabaseSync): void {
  const row = db.prepare("SELECT * FROM local_profile_identity").get();
  expect(row?.principal_id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  expect(row?.local_scope_id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  expect(row?.principal_id).not.toBe(row?.local_scope_id);
  expect(db.prepare("SELECT COUNT(*) AS count FROM local_profile_identity").get()).toEqual({ count: 1 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM local_profile_identity_bootstrap").get()).toEqual({ count: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("local planning migration", () => {
  it.each(Array.from({ length: 42 }, (_, i) => i + 8))("preserves user history from schema %i", (version) => {
    const db = atVersion(version);
    seedHistory(db);
    // Earlier migrations can add fields. Compare v49 rows immediately before the new migration.
    if (version < 49) {
      db.exec(`CREATE TEMP TRIGGER stop_local BEFORE INSERT ON schema_migrations WHEN new.version=50
        BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
      try {
        migrateOpenBotDatabase(db);
      } catch (error) {
        if (!(error instanceof Error && error.cause instanceof Error && error.cause.message === "fixture stop"))
          throw error;
      }
      db.exec("DROP TRIGGER stop_local");
    }
    const before = history(db);
    migrateOpenBotDatabase(db);
    expect(history(db)).toEqual(before);
    expectIdentity(db);
  });

  it.each([
    { tag: "v0.1.12", markers: [3] },
    { tag: "v0.1.15", markers: [4] },
    { tag: "v0.1.15", markers: [3, 4] },
    { tag: "v0.1.18", markers: [4] },
    { tag: "v0.1.18", markers: [3, 4] },
    { tag: "v0.2.1", markers: [6] },
    { tag: "v0.2.1", markers: [3, 4, 6] },
  ])("upgrades the frozen $tag schema with markers $markers", ({ tag, markers }) => {
    const db = open();
    db.exec(readFileSync(new URL(`./released-schemas/${tag}.sql`, import.meta.url), "utf8"));
    for (const version of markers) db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(version, "then");
    seedHistory(db);
    migrateOpenBotDatabase(db);
    expect(history(db).receipts).toHaveLength(1);
    expect(history(db).threads[0]?.title).toBe("Kept 界");
    expectIdentity(db);
  });

  it("creates the same local tables on both build paths and never reinitializes identity", () => {
    const db = open();
    migrateOpenBotDatabase(db);
    expectIdentity(db);
    const before = db.prepare("SELECT * FROM local_profile_identity").all();
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT * FROM local_profile_identity").all()).toEqual(before);
    db.exec("DELETE FROM local_profile_identity");
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT * FROM local_profile_identity").all()).toEqual([]);
  });

  it("rolls back identity, planning tables and the migration marker, then retries", () => {
    const db = atVersion(49);
    seedHistory(db);
    const before = history(db);
    db.exec(`CREATE TEMP TRIGGER fail_local BEFORE INSERT ON schema_migrations WHEN new.version=50
      BEGIN SELECT RAISE(ABORT, 'fixture late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 50 failed");
    expect(history(db)).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='local_profile_identity'").all()).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=50").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_local");
    migrateOpenBotDatabase(db);
    expectIdentity(db);
  });

  it("rejects missing and future migration versions without altering existing history", () => {
    const db = atVersion(49);
    seedHistory(db);
    const before = history(db);
    db.exec("INSERT INTO schema_migrations VALUES (51,'future')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=51; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(history(db)).toEqual(before);
  });

  it("keeps projects bound to the profile and tickets bound to their own milestone", () => {
    const db = open();
    migrateOpenBotDatabase(db);
    db.exec(`INSERT INTO projection_local_projects
      (project_id,local_scope_id,owner_principal_id,title,goal,revision,created_at,updated_at,last_event_sequence)
      SELECT 'p1',local_scope_id,principal_id,'First','',1,'now','now',0 FROM local_profile_identity;
      INSERT INTO projection_local_projects
      (project_id,local_scope_id,owner_principal_id,title,goal,revision,created_at,updated_at,last_event_sequence)
      SELECT 'p2',local_scope_id,principal_id,'Second','',1,'now','now',0 FROM local_profile_identity;
      INSERT INTO projection_local_project_milestones
      (milestone_id,project_id,title,criteria,criteria_revision,revision,gate_state,gate_generation,created_at,updated_at,last_event_sequence)
      VALUES ('m1','p1','Milestone','Ready',1,1,'open',0,'now','now',0);`);
    expect(() =>
      db.exec(`INSERT INTO projection_local_project_tickets
      (ticket_id,project_id,milestone_id,title,criteria,notes,status,revision,created_at,updated_at,last_event_sequence)
      VALUES ('t1','p2','m1','Wrong project','','','todo',1,'now','now',0)`),
    ).toThrow("FOREIGN KEY constraint failed");
    expect(() => db.exec("DELETE FROM local_profile_identity")).toThrow("FOREIGN KEY constraint failed");
    expect(() => db.exec("DELETE FROM projection_local_projects WHERE project_id='p1'")).toThrow(
      "FOREIGN KEY constraint failed",
    );
  });
});
