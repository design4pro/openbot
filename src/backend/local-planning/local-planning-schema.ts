import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// Both database build paths use this DDL. Identity bootstrap runs only in their transaction.
export const LOCAL_PLANNING_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS local_profile_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    principal_id TEXT NOT NULL UNIQUE,
    local_scope_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    UNIQUE(principal_id,local_scope_id)
  );
  CREATE TABLE IF NOT EXISTS local_profile_identity_bootstrap (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    initialized_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projection_local_projects (
    project_id TEXT PRIMARY KEY,
    local_scope_id TEXT NOT NULL,
    owner_principal_id TEXT NOT NULL,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>=1),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    FOREIGN KEY(owner_principal_id,local_scope_id) REFERENCES local_profile_identity(principal_id,local_scope_id)
  );
  CREATE INDEX IF NOT EXISTS local_projects_page
    ON projection_local_projects(owner_principal_id,local_scope_id,created_at,project_id);
  CREATE TABLE IF NOT EXISTS projection_local_project_milestones (
    milestone_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projection_local_projects(project_id),
    title TEXT NOT NULL,
    criteria TEXT NOT NULL,
    criteria_revision INTEGER NOT NULL CHECK(criteria_revision>=1),
    revision INTEGER NOT NULL CHECK(revision>=1),
    gate_state TEXT NOT NULL CHECK(gate_state IN ('open','in_review','released','changes_requested')),
    gate_generation INTEGER NOT NULL CHECK(gate_generation>=0),
    current_review_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    UNIQUE(project_id,milestone_id),
    FOREIGN KEY(project_id,milestone_id,current_review_id)
      REFERENCES local_project_reviews(project_id,milestone_id,review_id) DEFERRABLE INITIALLY DEFERRED
  );
  CREATE INDEX IF NOT EXISTS local_milestones_page
    ON projection_local_project_milestones(project_id,created_at,milestone_id);
  CREATE TABLE IF NOT EXISTS projection_local_project_tickets (
    ticket_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projection_local_projects(project_id),
    milestone_id TEXT,
    title TEXT NOT NULL,
    criteria TEXT NOT NULL,
    notes TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done')),
    revision INTEGER NOT NULL CHECK(revision>=1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    FOREIGN KEY(project_id,milestone_id) REFERENCES projection_local_project_milestones(project_id,milestone_id)
  );
  CREATE INDEX IF NOT EXISTS local_tickets_page
    ON projection_local_project_tickets(project_id,created_at,ticket_id);
  CREATE TABLE IF NOT EXISTS local_project_reviews (
    review_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    criteria_snapshot TEXT NOT NULL,
    criteria_revision INTEGER NOT NULL CHECK(criteria_revision>=1),
    gate_generation INTEGER NOT NULL CHECK(gate_generation>=1),
    evidence_note TEXT NOT NULL,
    submitter_principal_id TEXT NOT NULL REFERENCES local_profile_identity(principal_id),
    created_at TEXT NOT NULL,
    UNIQUE(project_id,milestone_id,review_id),
    FOREIGN KEY(project_id,milestone_id) REFERENCES projection_local_project_milestones(project_id,milestone_id)
  );
  CREATE INDEX IF NOT EXISTS local_reviews_page ON local_project_reviews(project_id,milestone_id,created_at,review_id);
  CREATE TABLE IF NOT EXISTS local_project_decisions (
    decision_id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL UNIQUE REFERENCES local_project_reviews(review_id),
    principal_id TEXT NOT NULL REFERENCES local_profile_identity(principal_id),
    decision TEXT NOT NULL CHECK(decision IN ('release','request_changes')),
    rationale TEXT NOT NULL,
    command_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_project_command_keys (
    principal_id TEXT NOT NULL,
    local_scope_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    command_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    aggregate_type TEXT NOT NULL CHECK(aggregate_type IN ('local-project','local-planning-draft')),
    aggregate_id TEXT NOT NULL,
    PRIMARY KEY(principal_id,local_scope_id,operation_id),
    FOREIGN KEY(principal_id,local_scope_id) REFERENCES local_profile_identity(principal_id,local_scope_id)
  );
  CREATE TABLE IF NOT EXISTS local_project_drafts (
    draft_id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL,
    local_scope_id TEXT NOT NULL,
    window_draft_id TEXT NOT NULL,
    target_key TEXT NOT NULL,
    target_json TEXT NOT NULL CHECK(json_valid(target_json)),
    form_json TEXT NOT NULL CHECK(json_valid(form_json)),
    revision INTEGER NOT NULL CHECK(revision>=1),
    byte_count INTEGER NOT NULL CHECK(byte_count>=0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(local_scope_id,window_draft_id,target_key),
    FOREIGN KEY(principal_id,local_scope_id) REFERENCES local_profile_identity(principal_id,local_scope_id)
  );
  CREATE INDEX IF NOT EXISTS local_drafts_page ON local_project_drafts(principal_id,local_scope_id,created_at,draft_id);
`;

/** Called only inside the new migration or the fresh-database transaction, never during a read. */
export function initializeLocalProfile(db: DatabaseSync, createdAt: string): void {
  db.prepare(
    "INSERT INTO local_profile_identity(singleton,principal_id,local_scope_id,created_at) VALUES(1,?,?,?)",
  ).run(randomUUID(), randomUUID(), createdAt);
  db.prepare("INSERT INTO local_profile_identity_bootstrap(singleton,initialized_at) VALUES(1,?)").run(createdAt);
}
