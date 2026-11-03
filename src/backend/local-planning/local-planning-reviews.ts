import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PlanningCommandResult } from "@openbot/contracts/ipc";
import type { LocalPlanningRecords } from "../database/local-planning-records";
import type { LocalPlanningOwner } from "./local-planning-authority";
import { planningFailure } from "./local-planning-errors";
import type { LocalPlanningAction } from "./local-planning-schemas";

type ReviewAction = Extract<LocalPlanningAction, { kind: "submit_review" | "decide_review" }>;

/** Owns version-bound review transitions inside the command owner's transaction. No execution side effects. */
export function applyLocalPlanningReview(
  db: DatabaseSync,
  records: LocalPlanningRecords,
  owner: LocalPlanningOwner,
  action: ReviewAction,
  objectId: string,
  sequence: number,
  now: string,
  commandId: string,
): PlanningCommandResult {
  const milestone = records.milestone(owner, action.projectId, action.milestoneId);
  const revision = action.expectedRevision + 1;
  if (action.kind === "submit_review") {
    if (!milestone.criteria.trim() || !action.evidenceNote.trim()) planningFailure("invalid_input");
    if (milestone.gateState !== "open" && milestone.gateState !== "changes_requested")
      planningFailure("invalid_transition");
    if (milestone.gateGeneration === Number.MAX_SAFE_INTEGER) planningFailure("limit_reached");
    const generation = milestone.gateGeneration + 1;
    db.prepare(
      "INSERT INTO local_project_reviews(review_id,project_id,milestone_id,criteria_snapshot,criteria_revision,gate_generation,evidence_note,submitter_principal_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      objectId,
      action.projectId,
      action.milestoneId,
      milestone.criteria,
      milestone.criteriaRevision,
      generation,
      action.evidenceNote,
      owner.principalId,
      now,
    );
    db.prepare(
      "UPDATE projection_local_project_milestones SET gate_state='in_review',gate_generation=?,current_review_id=?,revision=?,updated_at=?,last_event_sequence=? WHERE project_id=? AND milestone_id=?",
    ).run(generation, objectId, revision, now, sequence, action.projectId, action.milestoneId);
  } else {
    if (
      milestone.gateState !== "in_review" ||
      milestone.currentReviewId !== action.reviewId ||
      milestone.gateGeneration !== action.gateGeneration ||
      milestone.criteriaRevision !== action.criteriaRevision
    )
      planningFailure("invalid_transition");
    const { review, decision } = records.review(owner, action.reviewId);
    if (
      decision ||
      review.projectId !== action.projectId ||
      review.milestoneId !== action.milestoneId ||
      review.gateGeneration !== action.gateGeneration ||
      review.criteriaRevision !== action.criteriaRevision ||
      review.criteriaSnapshot !== milestone.criteria
    )
      planningFailure("invalid_transition");
    db.prepare(
      "INSERT INTO local_project_decisions(decision_id,review_id,principal_id,decision,rationale,command_id,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(randomUUID(), action.reviewId, owner.principalId, action.decision, action.rationale, commandId, now);
    db.prepare(
      "UPDATE projection_local_project_milestones SET gate_state=?,revision=?,updated_at=?,last_event_sequence=? WHERE project_id=? AND milestone_id=?",
    ).run(
      action.decision === "release" ? "released" : "changes_requested",
      revision,
      now,
      sequence,
      action.projectId,
      action.milestoneId,
    );
  }
  db.prepare(
    "UPDATE projection_local_projects SET revision=?,updated_at=?,last_event_sequence=? WHERE project_id=?",
  ).run(revision, now, sequence, action.projectId);
  return { objectId, revision, projectId: action.projectId };
}
