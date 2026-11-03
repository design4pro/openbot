/** Local-only planning DTOs. These values are never Team API payloads. */
export type PlanningSessionRef = { generation: string };
export type PlanningSession = PlanningSessionRef & {
  localScopeId: string;
  windowDraftId: string;
  privateEpoch: string;
};
export type NativeBlocker = {
  id: string;
  kind: "cua_runtime" | "remote_screen_runtime" | "capture" | "capture_sources";
  state: "starting" | "active" | "uncertain";
};
export type PlanningErrorCode =
  | "unavailable"
  | "identity_invalid"
  | "forbidden"
  | "privacy_busy"
  | "stale_scope"
  | "not_found"
  | "revision_conflict"
  | "operation_conflict"
  | "invalid_transition"
  | "invalid_input"
  | "limit_reached"
  | "storage_failed";
export type PlanningReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: PlanningErrorCode; message: string } };
export type PlanningChange = { localScopeId: string; generation: string; objectId: string; revision: number };
export type PageRequest = { after?: { createdAt: string; id: string }; limit?: number };
export type Page<T> = { items: T[]; next: NonNullable<PageRequest["after"]> | null };
export type ProjectQuery = PageRequest & { archive?: "active" | "archived" | "all" };
export type ProjectPageQuery = PageRequest & { projectId: string };
export type TicketQuery = ProjectPageQuery & { milestoneId?: string; status?: TicketStatus };
export type MilestonePageQuery = ProjectPageQuery & { milestoneId: string };
export type TicketStatus = "todo" | "in_progress" | "done";
export type GateState = "open" | "in_review" | "released" | "changes_requested";
export type ReviewDecision = "release" | "request_changes";
export interface ProjectView {
  id: string;
  title: string;
  goal: string;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MilestoneView {
  id: string;
  projectId: string;
  title: string;
  criteria: string;
  criteriaRevision: number;
  revision: number;
  gateState: GateState;
  gateGeneration: number;
  currentReviewId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface TicketView {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  criteria: string;
  notes: string;
  status: TicketStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface ReviewView {
  id: string;
  projectId: string;
  milestoneId: string;
  criteriaSnapshot: string;
  criteriaRevision: number;
  gateGeneration: number;
  evidenceNote: string;
  submitterPrincipalId: string;
  createdAt: string;
}
export interface DecisionView {
  id: string;
  reviewId: string;
  principalId: string;
  decision: ReviewDecision;
  rationale: string;
  commandId: string;
  createdAt: string;
}
export type DraftTarget =
  | { kind: "project"; id: string | null; formId?: string }
  | { kind: "milestone"; projectId: string; id: string | null; formId?: string }
  | { kind: "ticket"; projectId: string; id: string | null; formId?: string }
  | { kind: "review"; projectId: string; milestoneId: string }
  | { kind: "decision"; projectId: string; milestoneId: string; reviewId: string };
export type ProjectForm = { title: string; goal: string };
export type MilestoneForm = { title: string; criteria: string };
export type TicketForm = {
  milestoneId: string | null;
  title: string;
  criteria: string;
  notes: string;
  status: TicketStatus;
};
export type DraftInput =
  | { target: { kind: "project"; id: string | null; formId?: string }; form: ProjectForm }
  | { target: { kind: "milestone"; projectId: string; id: string | null; formId?: string }; form: MilestoneForm }
  | { target: { kind: "ticket"; projectId: string; id: string | null; formId?: string }; form: TicketForm }
  | { target: { kind: "review"; projectId: string; milestoneId: string }; form: { evidenceNote: string } }
  | {
      target: { kind: "decision"; projectId: string; milestoneId: string; reviewId: string };
      form: { decision: ReviewDecision; rationale: string };
    };
export type DraftView = DraftInput & { id: string; windowDraftId: string; revision: number; updatedAt: string };
export type PlanningAction =
  | ({ kind: "create_project" } & ProjectForm)
  | ({ kind: "edit_project"; projectId: string; expectedRevision: number } & ProjectForm)
  | { kind: "archive_project" | "restore_project"; projectId: string; expectedRevision: number }
  | ({ kind: "create_milestone"; projectId: string; expectedRevision: number } & MilestoneForm)
  | ({ kind: "edit_milestone"; projectId: string; expectedRevision: number; milestoneId: string } & MilestoneForm)
  | ({ kind: "create_ticket"; projectId: string; expectedRevision: number } & TicketForm)
  | ({ kind: "edit_ticket"; projectId: string; expectedRevision: number; ticketId: string } & TicketForm)
  | { kind: "submit_review"; projectId: string; expectedRevision: number; milestoneId: string; evidenceNote: string }
  | {
      kind: "decide_review";
      projectId: string;
      expectedRevision: number;
      milestoneId: string;
      reviewId: string;
      gateGeneration: number;
      criteriaRevision: number;
      decision: ReviewDecision;
      rationale: string;
    }
  | ({ kind: "save_draft"; draftId: string | null; expectedDraftRevision: number | null } & DraftInput)
  | { kind: "discard_draft"; draftId: string; expectedDraftRevision: number };
export type PlanningCommand = {
  operationId: string;
  action: PlanningAction;
  consumedDraft?: { id: string; revision: number };
};
export type PlanningCommandResult = { objectId: string; revision: number; projectId: string | null };

export type PlanningRequest<T> = { session: PlanningSessionRef; input: T };
export type PlanningAvailability = {
  ready: boolean;
  reason: PlanningErrorCode | null;
  blockers: NativeBlocker[];
  privateEpoch: string | null;
};
export type PlanningPrepareExit = { privateEpoch: string; exitId: string };
export type PlanningExitConfirmation = PlanningPrepareExit & { outcome: "saved" | "discarded" | "blocked" };

/** A content key, never caller authority. Legacy targets keep their exact persisted key. */
export function planningDraftTargetKey(target: DraftTarget): string {
  switch (target.kind) {
    case "project":
      return JSON.stringify([
        target.kind,
        target.id ?? "new",
        ...(target.id === null && target.formId ? [target.formId] : []),
      ]);
    case "milestone":
    case "ticket":
      return JSON.stringify([
        target.kind,
        target.projectId,
        target.id ?? "new",
        ...(target.id === null && target.formId ? [target.formId] : []),
      ]);
    case "review":
      return JSON.stringify([target.kind, target.projectId, target.milestoneId]);
    case "decision":
      return JSON.stringify([target.kind, target.projectId, target.milestoneId, target.reviewId]);
  }
}
