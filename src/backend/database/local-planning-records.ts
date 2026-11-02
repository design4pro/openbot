import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  DecisionView,
  MilestonePageQuery,
  MilestoneView,
  Page,
  PageRequest,
  ProjectQuery,
  ProjectView,
  ReviewView,
  TicketQuery,
  TicketView,
} from "@openbot/contracts/ipc";
import type { LocalPlanningOwner } from "../local-planning/local-planning-authority";
import { planningFailure } from "../local-planning/local-planning-errors";
import type { DatabaseCore, OrchestrationEventInput } from "./database-core";
import {
  checkedColumn,
  databaseRow,
  databaseRows,
  optionalStringColumn as nullable,
  requiredNumberColumn as number,
  requiredStringColumn as text,
} from "./database-rows";

type Row = NonNullable<ReturnType<typeof databaseRow>>;
export const ownerPredicate = "p.owner_principal_id=? AND p.local_scope_id=?";
export const ownerValues = (owner: LocalPlanningOwner) => [owner.principalId, owner.localScopeId];
export function projectView(row: Row): ProjectView {
  return {
    id: text(row, "project_id"),
    title: text(row, "title"),
    goal: text(row, "goal"),
    revision: number(row, "revision"),
    archivedAt: nullable(row, "archived_at"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
export function milestoneView(row: Row): MilestoneView {
  return {
    id: text(row, "milestone_id"),
    projectId: text(row, "project_id"),
    title: text(row, "title"),
    criteria: text(row, "criteria"),
    criteriaRevision: number(row, "criteria_revision"),
    revision: number(row, "revision"),
    gateState: checkedColumn(row, "gate_state", ["open", "in_review", "released", "changes_requested"]),
    gateGeneration: number(row, "gate_generation"),
    currentReviewId: nullable(row, "current_review_id"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
export function ticketView(row: Row): TicketView {
  return {
    id: text(row, "ticket_id"),
    projectId: text(row, "project_id"),
    milestoneId: nullable(row, "milestone_id"),
    title: text(row, "title"),
    criteria: text(row, "criteria"),
    notes: text(row, "notes"),
    status: checkedColumn(row, "status", ["todo", "in_progress", "done"]),
    revision: number(row, "revision"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
export function reviewView(row: Row): ReviewView {
  return {
    id: text(row, "review_id"),
    projectId: text(row, "project_id"),
    milestoneId: text(row, "milestone_id"),
    criteriaSnapshot: text(row, "criteria_snapshot"),
    criteriaRevision: number(row, "criteria_revision"),
    gateGeneration: number(row, "gate_generation"),
    evidenceNote: text(row, "evidence_note"),
    submitterPrincipalId: text(row, "submitter_principal_id"),
    createdAt: text(row, "created_at"),
  };
}
export function decisionView(row: Row): DecisionView {
  return {
    id: text(row, "decision_id"),
    reviewId: text(row, "review_id"),
    principalId: text(row, "principal_id"),
    decision: checkedColumn(row, "decision", ["release", "request_changes"]),
    rationale: text(row, "rationale"),
    commandId: text(row, "command_id"),
    createdAt: text(row, "created_at"),
  };
}
export function requiredPlanningRow(value: unknown): Row {
  return databaseRow(value) ?? planningFailure("not_found");
}

/** Keyset order uses the same columns as the local projection indexes. */
export function planningPage<T extends { id: string; createdAt: string }>(
  db: DatabaseSync,
  table: string,
  alias: string,
  id: string,
  where: string,
  values: SQLInputValue[],
  page: PageRequest,
  decode: (row: Row) => T,
): Page<T> {
  const limit = page.limit ?? 50;
  const cursor = page.after ? ` AND (${alias}.created_at,${alias}.${id})>(?,?)` : "";
  const parameters = page.after ? [...values, page.after.createdAt, page.after.id, limit + 1] : [...values, limit + 1];
  const rows = databaseRows(
    db
      .prepare(
        `SELECT ${alias}.* FROM ${table} WHERE ${where}${cursor} ORDER BY ${alias}.created_at,${alias}.${id} LIMIT ?`,
      )
      .all(...parameters),
  );
  const items = rows.slice(0, limit).map(decode);
  const last = items.at(-1);
  return { items, next: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}

/** Owns local planning SQL reads and delegates writes to the existing transaction owner. Never imports the facade. */
export class LocalPlanningRecords {
  readonly #core: DatabaseCore;
  constructor(core: DatabaseCore) {
    this.#core = core;
  }
  dispatchChecked<T>(
    commandId: string,
    events: OrchestrationEventInput[],
    check: (db: DatabaseSync, replay: boolean) => void,
    project: (db: DatabaseSync, sequences: number[]) => T,
  ): T {
    return this.#core.dispatchChecked(commandId, events, check, project);
  }
  project(owner: LocalPlanningOwner, id: string): ProjectView {
    return projectView(
      requiredPlanningRow(
        this.#core.connection
          .prepare(`SELECT p.* FROM projection_local_projects p WHERE ${ownerPredicate} AND p.project_id=?`)
          .get(...ownerValues(owner), id),
      ),
    );
  }
  milestone(owner: LocalPlanningOwner, projectId: string, id: string): MilestoneView {
    return milestoneView(
      requiredPlanningRow(
        this.#core.connection
          .prepare(
            `SELECT m.* FROM projection_local_project_milestones m JOIN projection_local_projects p USING(project_id) WHERE ${ownerPredicate} AND m.project_id=? AND m.milestone_id=?`,
          )
          .get(...ownerValues(owner), projectId, id),
      ),
    );
  }
  ticket(owner: LocalPlanningOwner, projectId: string, id: string): TicketView {
    return ticketView(
      requiredPlanningRow(
        this.#core.connection
          .prepare(
            `SELECT t.* FROM projection_local_project_tickets t JOIN projection_local_projects p USING(project_id) WHERE ${ownerPredicate} AND t.project_id=? AND t.ticket_id=?`,
          )
          .get(...ownerValues(owner), projectId, id),
      ),
    );
  }
  projects(owner: LocalPlanningOwner, query: ProjectQuery): Page<ProjectView> {
    const archive = query.archive ?? "active";
    const filter = archive === "all" ? "" : ` AND p.archived_at IS ${archive === "active" ? "" : "NOT "}NULL`;
    return planningPage(
      this.#core.connection,
      "projection_local_projects p",
      "p",
      "project_id",
      ownerPredicate + filter,
      ownerValues(owner),
      query,
      projectView,
    );
  }
  milestones(
    owner: LocalPlanningOwner,
    query: MilestonePageQuery | (PageRequest & { projectId: string }),
  ): Page<MilestoneView> {
    this.project(owner, query.projectId);
    return planningPage(
      this.#core.connection,
      "projection_local_project_milestones m JOIN projection_local_projects p USING(project_id)",
      "m",
      "milestone_id",
      `${ownerPredicate} AND m.project_id=?`,
      [...ownerValues(owner), query.projectId],
      query,
      milestoneView,
    );
  }
  tickets(owner: LocalPlanningOwner, query: TicketQuery): Page<TicketView> {
    this.project(owner, query.projectId);
    let where = `${ownerPredicate} AND t.project_id=?`;
    const values: SQLInputValue[] = [...ownerValues(owner), query.projectId];
    if (query.milestoneId) {
      this.milestone(owner, query.projectId, query.milestoneId);
      where += " AND t.milestone_id=?";
      values.push(query.milestoneId);
    }
    if (query.status) {
      where += " AND t.status=?";
      values.push(query.status);
    }
    return planningPage(
      this.#core.connection,
      "projection_local_project_tickets t JOIN projection_local_projects p USING(project_id)",
      "t",
      "ticket_id",
      where,
      values,
      query,
      ticketView,
    );
  }
  reviews(owner: LocalPlanningOwner, query: MilestonePageQuery): Page<ReviewView> {
    this.milestone(owner, query.projectId, query.milestoneId);
    return planningPage(
      this.#core.connection,
      "local_project_reviews r JOIN projection_local_projects p USING(project_id)",
      "r",
      "review_id",
      `${ownerPredicate} AND r.project_id=? AND r.milestone_id=?`,
      [...ownerValues(owner), query.projectId, query.milestoneId],
      query,
      reviewView,
    );
  }
  review(owner: LocalPlanningOwner, id: string): { review: ReviewView; decision: DecisionView | null } {
    const db = this.#core.connection;
    const review = reviewView(
      requiredPlanningRow(
        db
          .prepare(
            `SELECT r.* FROM local_project_reviews r JOIN projection_local_projects p USING(project_id) WHERE ${ownerPredicate} AND r.review_id=?`,
          )
          .get(...ownerValues(owner), id),
      ),
    );
    const decision = databaseRow(db.prepare("SELECT * FROM local_project_decisions WHERE review_id=?").get(id));
    return { review, decision: decision ? decisionView(decision) : null };
  }
}
