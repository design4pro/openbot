import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DraftInput, DraftTarget, PlanningCommandResult } from "@openbot/contracts/ipc";
import { databaseRow, requiredStringColumn } from "../database/database-rows";
import type { LocalPlanningDrafts } from "../database/local-planning-drafts";
import type { LocalPlanningRecords } from "../database/local-planning-records";
import type { LocalPlanningAuthority, LocalPlanningContext, LocalPlanningOwner } from "./local-planning-authority";
import { planningFailure } from "./local-planning-errors";
import { applyLocalPlanningReview } from "./local-planning-reviews";
import type { LocalPlanningAction, LocalPlanningCommand } from "./local-planning-schemas";

/** Fixed tuples keep object-key order out of command identity. Optional fields use null. */
function actionTuple(action: LocalPlanningAction): unknown[] {
  switch (action.kind) {
    case "create_project":
      return [action.kind, action.title, action.goal];
    case "edit_project":
      return [action.kind, action.projectId, action.expectedRevision, action.title, action.goal];
    case "archive_project":
    case "restore_project":
      return [action.kind, action.projectId, action.expectedRevision];
    case "create_milestone":
      return [action.kind, action.projectId, action.expectedRevision, action.title, action.criteria];
    case "edit_milestone":
      return [
        action.kind,
        action.projectId,
        action.expectedRevision,
        action.milestoneId,
        action.title,
        action.criteria,
      ];
    case "create_ticket":
      return [
        action.kind,
        action.projectId,
        action.expectedRevision,
        action.milestoneId,
        action.title,
        action.criteria,
        action.notes,
        action.status,
      ];
    case "edit_ticket":
      return [
        action.kind,
        action.projectId,
        action.expectedRevision,
        action.ticketId,
        action.milestoneId,
        action.title,
        action.criteria,
        action.notes,
        action.status,
      ];
    case "submit_review":
      return [action.kind, action.projectId, action.expectedRevision, action.milestoneId, action.evidenceNote];
    case "decide_review":
      return [
        action.kind,
        action.projectId,
        action.expectedRevision,
        action.milestoneId,
        action.reviewId,
        action.gateGeneration,
        action.criteriaRevision,
        action.decision,
        action.rationale,
      ];
    case "save_draft":
      return [action.kind, action.draftId, action.expectedDraftRevision, ...draftTuple(action)];
    case "discard_draft":
      return [action.kind, action.draftId, action.expectedDraftRevision];
  }
}
function draftTuple(input: DraftInput): unknown[] {
  switch (input.target.kind) {
    case "project":
      return [
        input.target.kind,
        input.target.id,
        "title" in input.form ? input.form.title : null,
        "goal" in input.form ? input.form.goal : null,
        ...(input.target.formId ? [input.target.formId] : []),
      ];
    case "milestone":
      return [
        input.target.kind,
        input.target.projectId,
        input.target.id,
        "title" in input.form ? input.form.title : null,
        "criteria" in input.form ? input.form.criteria : null,
        ...(input.target.formId ? [input.target.formId] : []),
      ];
    case "ticket":
      return [
        input.target.kind,
        input.target.projectId,
        input.target.id,
        "milestoneId" in input.form ? input.form.milestoneId : null,
        "title" in input.form ? input.form.title : null,
        "criteria" in input.form ? input.form.criteria : null,
        "notes" in input.form ? input.form.notes : null,
        "status" in input.form ? input.form.status : null,
        ...(input.target.formId ? [input.target.formId] : []),
      ];
    case "review":
      return [
        input.target.kind,
        input.target.projectId,
        input.target.milestoneId,
        "evidenceNote" in input.form ? input.form.evidenceNote : null,
      ];
    case "decision":
      return [
        input.target.kind,
        input.target.projectId,
        input.target.milestoneId,
        input.target.reviewId,
        "decision" in input.form ? input.form.decision : null,
        "rationale" in input.form ? input.form.rationale : null,
      ];
  }
}
const hash = (tuple: unknown[]) => createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
export interface LocalPlanningCommandsOptions {
  authority: LocalPlanningAuthority;
  records: LocalPlanningRecords;
  drafts: LocalPlanningDrafts;
}
/** Owns checked command execution and metadata-only events in one existing core transaction. */
export class LocalPlanningCommands {
  readonly #options: LocalPlanningCommandsOptions;
  constructor(options: LocalPlanningCommandsOptions) {
    this.#options = options;
  }
  run(context: LocalPlanningContext, command: LocalPlanningCommand): PlanningCommandResult {
    const { authority, records, drafts } = this.#options;
    const owner = authority.resolve(context);
    const action = command.action;
    const commandId = `local-planning:${hash([owner.principalId, owner.localScopeId, command.operationId])}`;
    const fingerprint = hash([
      actionTuple(action),
      command.consumedDraft ? [command.consumedDraft.id, command.consumedDraft.revision] : null,
    ]);
    const draftAction = action.kind === "save_draft" || action.kind === "discard_draft";
    if (draftAction && command.consumedDraft) planningFailure("invalid_input");
    const objectId =
      action.kind === "create_project" ||
      action.kind === "create_milestone" ||
      action.kind === "create_ticket" ||
      action.kind === "submit_review"
        ? randomUUID()
        : action.kind === "save_draft"
          ? (action.draftId ?? randomUUID())
          : action.kind === "discard_draft"
            ? action.draftId
            : action.kind === "edit_milestone" || action.kind === "decide_review"
              ? action.milestoneId
              : action.kind === "edit_ticket"
                ? action.ticketId
                : action.projectId;
    const aggregateType = draftAction ? "local-planning-draft" : "local-project";
    const aggregateId = draftAction ? objectId : action.kind === "create_project" ? objectId : action.projectId;
    const now = new Date().toISOString();
    const eventRevision =
      action.kind === "create_project"
        ? 1
        : action.kind === "save_draft"
          ? (action.expectedDraftRevision ?? 0) + 1
          : action.kind === "discard_draft"
            ? action.expectedDraftRevision
            : action.expectedRevision + 1;
    return records.dispatchChecked(
      commandId,
      [
        {
          aggregateType,
          aggregateId,
          eventType: `local-planning:${action.kind}`,
          payload: { objectId, revision: eventRevision },
          occurredAt: now,
        },
      ],
      (db, replay) => {
        // This check runs under the write lock even on the receipt path.
        authority.resolve(context);
        const key = databaseRow(
          db
            .prepare(
              "SELECT command_id,fingerprint,aggregate_type,aggregate_id FROM local_project_command_keys WHERE principal_id=? AND local_scope_id=? AND operation_id=?",
            )
            .get(owner.principalId, owner.localScopeId, command.operationId),
        );
        if (key && requiredStringColumn(key, "fingerprint") !== fingerprint) planningFailure("operation_conflict");
        if (Boolean(key) !== replay || (key && requiredStringColumn(key, "command_id") !== commandId))
          planningFailure("storage_failed");
        if (replay) {
          if (key && requiredStringColumn(key, "aggregate_type") === "local-project")
            records.project(owner, requiredStringColumn(key, "aggregate_id"));
          return;
        }
        this.#checkNew(db, owner, action);
        if (command.consumedDraft) {
          const consumed = drafts.requireWindow(db, owner, command.consumedDraft.id, command.consumedDraft.revision);
          if (!this.#matchesAction(consumed.target, action)) planningFailure("invalid_input");
        }
      },
      (db, sequences) => {
        const sequence = sequences[0];
        if (sequence === undefined) planningFailure("storage_failed");
        const result = this.#apply(db, owner, action, objectId, sequence, now, commandId);
        if (command.consumedDraft) drafts.discard(db, owner, command.consumedDraft.id, command.consumedDraft.revision);
        db.prepare(
          "INSERT INTO local_project_command_keys(principal_id,local_scope_id,operation_id,command_id,fingerprint,aggregate_type,aggregate_id) VALUES(?,?,?,?,?,?,?)",
        ).run(
          owner.principalId,
          owner.localScopeId,
          command.operationId,
          commandId,
          fingerprint,
          aggregateType,
          aggregateId,
        );
        return result;
      },
    );
  }
  #target(owner: LocalPlanningOwner, target: DraftTarget): void {
    const { records } = this.#options;
    if (target.kind === "project") {
      if (target.id) records.project(owner, target.id);
      return;
    }
    records.project(owner, target.projectId);
    if (target.kind === "milestone" && target.id) records.milestone(owner, target.projectId, target.id);
    if (target.kind === "ticket" && target.id) records.ticket(owner, target.projectId, target.id);
    if (target.kind === "review" || target.kind === "decision")
      records.milestone(owner, target.projectId, target.milestoneId);
    if (target.kind === "decision") {
      const { review } = records.review(owner, target.reviewId);
      if (review.projectId !== target.projectId || review.milestoneId !== target.milestoneId)
        planningFailure("not_found");
    }
  }
  #checkNew(db: DatabaseSync, owner: LocalPlanningOwner, action: LocalPlanningAction): void {
    const { records, drafts } = this.#options;
    if (action.kind === "create_project") return;
    if (action.kind === "save_draft") {
      this.#target(owner, action.target);
      if ("milestoneId" in action.form && action.form.milestoneId && "projectId" in action.target)
        records.milestone(owner, action.target.projectId, action.form.milestoneId);
      const projectId = action.target.kind === "project" ? action.target.id : action.target.projectId;
      if (projectId && records.project(owner, projectId).archivedAt) planningFailure("invalid_transition");
      return;
    }
    if (action.kind === "discard_draft") {
      drafts.requireRevision(db, owner, action.draftId, action.expectedDraftRevision);
      return;
    }
    const project = records.project(owner, action.projectId);
    if (project.revision !== action.expectedRevision) planningFailure("revision_conflict");
    if (action.expectedRevision === Number.MAX_SAFE_INTEGER) planningFailure("limit_reached");
    if (action.kind === "restore_project") {
      if (!project.archivedAt) planningFailure("invalid_transition");
      return;
    }
    if (project.archivedAt) planningFailure("invalid_transition");
    if (action.kind === "edit_milestone" || action.kind === "submit_review" || action.kind === "decide_review")
      records.milestone(owner, action.projectId, action.milestoneId);
    if (action.kind === "edit_ticket") records.ticket(owner, action.projectId, action.ticketId);
    if ((action.kind === "create_ticket" || action.kind === "edit_ticket") && action.milestoneId)
      records.milestone(owner, action.projectId, action.milestoneId);
  }
  #matchesAction(target: DraftTarget, action: LocalPlanningAction): boolean {
    switch (target.kind) {
      case "project":
        return target.id === null
          ? action.kind === "create_project"
          : action.kind === "edit_project" && action.projectId === target.id;
      case "milestone":
        return action.kind === "create_milestone"
          ? target.id === null && action.projectId === target.projectId
          : action.kind === "edit_milestone" &&
              action.projectId === target.projectId &&
              action.milestoneId === target.id;
      case "ticket":
        return action.kind === "create_ticket"
          ? target.id === null && action.projectId === target.projectId
          : action.kind === "edit_ticket" && action.projectId === target.projectId && action.ticketId === target.id;
      case "review":
        return (
          action.kind === "submit_review" &&
          action.projectId === target.projectId &&
          action.milestoneId === target.milestoneId
        );
      case "decision":
        return (
          action.kind === "decide_review" &&
          action.projectId === target.projectId &&
          action.milestoneId === target.milestoneId &&
          action.reviewId === target.reviewId
        );
    }
  }
  #apply(
    db: DatabaseSync,
    owner: LocalPlanningOwner,
    action: LocalPlanningAction,
    objectId: string,
    sequence: number,
    now: string,
    commandId: string,
  ): PlanningCommandResult {
    if (action.kind === "save_draft") {
      const saved = this.#options.drafts.save(
        db,
        owner,
        action,
        action.draftId,
        action.expectedDraftRevision,
        now,
        objectId,
      );
      return { objectId: saved.id, revision: saved.revision, projectId: null };
    }
    if (action.kind === "discard_draft") {
      this.#options.drafts.discard(db, owner, action.draftId, action.expectedDraftRevision);
      return { objectId: action.draftId, revision: action.expectedDraftRevision, projectId: null };
    }
    const revision = action.kind === "create_project" ? 1 : action.expectedRevision + 1;
    const projectId = action.kind === "create_project" ? objectId : action.projectId;
    switch (action.kind) {
      case "create_project":
        db.prepare(
          "INSERT INTO projection_local_projects(project_id,local_scope_id,owner_principal_id,title,goal,revision,created_at,updated_at,last_event_sequence) VALUES(?,?,?,?,?,1,?,?,?)",
        ).run(objectId, owner.localScopeId, owner.principalId, action.title, action.goal, now, now, sequence);
        break;
      case "edit_project":
        db.prepare("UPDATE projection_local_projects SET title=?,goal=? WHERE project_id=?").run(
          action.title,
          action.goal,
          projectId,
        );
        break;
      case "archive_project":
        db.prepare("UPDATE projection_local_projects SET archived_at=? WHERE project_id=?").run(now, projectId);
        break;
      case "restore_project":
        db.prepare("UPDATE projection_local_projects SET archived_at=NULL WHERE project_id=?").run(projectId);
        break;
      case "create_milestone":
        db.prepare(
          "INSERT INTO projection_local_project_milestones(milestone_id,project_id,title,criteria,criteria_revision,revision,gate_state,gate_generation,created_at,updated_at,last_event_sequence) VALUES(?,?,?,?,1,?,'open',0,?,?,?)",
        ).run(objectId, projectId, action.title, action.criteria, revision, now, now, sequence);
        break;
      case "edit_milestone": {
        const old = this.#options.records.milestone(owner, projectId, action.milestoneId);
        const changed = old.criteria !== action.criteria;
        if (changed && old.criteriaRevision === Number.MAX_SAFE_INTEGER) planningFailure("limit_reached");
        db.prepare(
          "UPDATE projection_local_project_milestones SET title=?,criteria=?,criteria_revision=?,revision=?,gate_state=?,current_review_id=?,updated_at=?,last_event_sequence=? WHERE milestone_id=? AND project_id=?",
        ).run(
          action.title,
          action.criteria,
          old.criteriaRevision + (changed ? 1 : 0),
          revision,
          changed && old.gateState !== "open" ? "changes_requested" : old.gateState,
          changed ? null : old.currentReviewId,
          now,
          sequence,
          action.milestoneId,
          projectId,
        );
        break;
      }
      case "create_ticket":
        db.prepare(
          "INSERT INTO projection_local_project_tickets(ticket_id,project_id,milestone_id,title,criteria,notes,status,revision,created_at,updated_at,last_event_sequence) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          objectId,
          projectId,
          action.milestoneId,
          action.title,
          action.criteria,
          action.notes,
          action.status,
          revision,
          now,
          now,
          sequence,
        );
        break;
      case "edit_ticket":
        db.prepare(
          "UPDATE projection_local_project_tickets SET milestone_id=?,title=?,criteria=?,notes=?,status=?,revision=?,updated_at=?,last_event_sequence=? WHERE ticket_id=? AND project_id=?",
        ).run(
          action.milestoneId,
          action.title,
          action.criteria,
          action.notes,
          action.status,
          revision,
          now,
          sequence,
          action.ticketId,
          projectId,
        );
        break;
      case "submit_review":
      case "decide_review":
        return applyLocalPlanningReview(db, this.#options.records, owner, action, objectId, sequence, now, commandId);
    }
    db.prepare(
      "UPDATE projection_local_projects SET revision=?,updated_at=?,last_event_sequence=? WHERE project_id=?",
    ).run(revision, now, sequence, projectId);
    return { objectId, revision, projectId };
  }
}
