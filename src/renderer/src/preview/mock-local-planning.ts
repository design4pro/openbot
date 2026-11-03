import type {
  DecisionView,
  DraftView,
  MilestoneView,
  OpenBotDesktopApi,
  Page,
  PageRequest,
  PlanningChange,
  PlanningCommand,
  PlanningCommandResult,
  PlanningErrorCode,
  PlanningPrepareExit,
  PlanningReply,
  PlanningSessionRef,
  ProjectView,
  ReviewView,
  TicketView,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone, type Listener } from "./mock-support";

class PreviewPlanningFailure extends Error {
  constructor(readonly code: PlanningErrorCode) {
    super(code);
  }
}
const fail = (code: PlanningErrorCode): never => {
  throw new PreviewPlanningFailure(code);
};
const success = <T>(value: T): PlanningReply<T> => ({ ok: true, value: clone(value) });
const failure = (code: PlanningErrorCode): PlanningReply<never> => ({
  ok: false,
  error: {
    code,
    message: sourceText(
      code === "revision_conflict"
        ? "error.backend.planningRevisionConflict"
        : code === "stale_scope"
          ? "error.backend.planningStaleScope"
          : "error.backend.planningInvalidTransition",
    ),
  },
});

/** In-memory preview behavior. It is not a security boundary or native privacy evidence. */
export function createMockLocalPlanning(isLocal: () => boolean) {
  const scope = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const draftWindow = crypto.randomUUID();
  let generation = crypto.randomUUID();
  let epoch: string | null = null;
  let exit: PlanningPrepareExit | null = null;
  const projects = new Map<string, ProjectView>();
  const milestones = new Map<string, MilestoneView>();
  const tickets = new Map<string, TicketView>();
  const reviews = new Map<string, ReviewView>();
  const decisions = new Map<string, DecisionView>();
  const drafts = new Map<string, DraftView>();
  const receipts = new Map<string, { fingerprint: string; result: PlanningCommandResult }>();
  const changes = new Set<Listener<PlanningChange>>();
  const exits = new Set<Listener<PlanningPrepareExit>>();
  function session(ref: PlanningSessionRef): void {
    if (!isLocal() || !epoch) fail("unavailable");
    if (ref.generation !== generation) fail("stale_scope");
  }
  function required<T>(map: Map<string, T>, id: string): T {
    return map.get(id) ?? fail("not_found");
  }
  function page<T extends { id: string }>(values: T[], query: PageRequest): Page<T> {
    const offset = query.after ? Math.max(0, values.findIndex((value) => value.id === query.after?.id) + 1) : 0;
    const items = values.slice(offset, offset + (query.limit ?? 50));
    const last = items.at(-1);
    return {
      items,
      next:
        offset + items.length < values.length && last
          ? {
              id: last.id,
              createdAt:
                "createdAt" in last && typeof last.createdAt === "string" ? last.createdAt : new Date().toISOString(),
            }
          : null,
    };
  }
  async function read<T>(ref: PlanningSessionRef, get: () => T): Promise<PlanningReply<T>> {
    try {
      session(ref);
      return success(get());
    } catch (cause) {
      return failure(cause instanceof PreviewPlanningFailure ? cause.code : "storage_failed");
    }
  }
  function apply(command: PlanningCommand): PlanningCommandResult {
    const { action } = command;
    if ("title" in action && !action.title.trim()) fail("invalid_input");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    if (action.kind === "save_draft") {
      const previous = action.draftId ? required(drafts, action.draftId) : null;
      if (previous && previous.revision !== action.expectedDraftRevision) fail("revision_conflict");
      if (!previous && drafts.size >= 100) fail("limit_reached");
      const draft: DraftView = {
        ...clone(action),
        id: previous?.id ?? id,
        windowDraftId: draftWindow,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: now,
      };
      drafts.set(draft.id, draft);
      return { objectId: draft.id, revision: draft.revision, projectId: null };
    }
    if (action.kind === "discard_draft") {
      const draft = required(drafts, action.draftId);
      if (draft.revision !== action.expectedDraftRevision) fail("revision_conflict");
      drafts.delete(draft.id);
      return { objectId: draft.id, revision: draft.revision, projectId: null };
    }
    if (action.kind === "create_project") {
      projects.set(id, {
        id,
        title: action.title,
        goal: action.goal,
        revision: 1,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      return { objectId: id, revision: 1, projectId: id };
    }
    const project = required(projects, action.projectId);
    if (project.revision !== action.expectedRevision) fail("revision_conflict");
    if (action.kind === "restore_project" ? !project.archivedAt : project.archivedAt) fail("invalid_transition");
    const revision = project.revision + 1;
    let objectId = project.id;
    switch (action.kind) {
      case "edit_project":
        project.title = action.title;
        project.goal = action.goal;
        break;
      case "archive_project":
        project.archivedAt = now;
        break;
      case "restore_project":
        project.archivedAt = null;
        break;
      case "create_milestone":
        milestones.set(id, {
          id,
          projectId: project.id,
          title: action.title,
          criteria: action.criteria,
          criteriaRevision: 1,
          revision,
          gateState: "open",
          gateGeneration: 0,
          currentReviewId: null,
          createdAt: now,
          updatedAt: now,
        });
        objectId = id;
        break;
      case "edit_milestone": {
        const milestone = required(milestones, action.milestoneId);
        if (milestone.projectId !== project.id) fail("not_found");
        if (milestone.criteria !== action.criteria) {
          milestone.criteriaRevision++;
          milestone.gateState = "open";
          milestone.currentReviewId = null;
        }
        Object.assign(milestone, { title: action.title, criteria: action.criteria, revision, updatedAt: now });
        objectId = milestone.id;
        break;
      }
      case "create_ticket":
        tickets.set(id, {
          id,
          projectId: project.id,
          title: action.title,
          criteria: action.criteria,
          notes: action.notes,
          status: action.status,
          milestoneId: action.milestoneId,
          revision,
          createdAt: now,
          updatedAt: now,
        });
        objectId = id;
        break;
      case "edit_ticket": {
        const ticket = required(tickets, action.ticketId);
        if (ticket.projectId !== project.id) fail("not_found");
        Object.assign(ticket, {
          title: action.title,
          criteria: action.criteria,
          notes: action.notes,
          status: action.status,
          milestoneId: action.milestoneId,
          revision,
          updatedAt: now,
        });
        objectId = ticket.id;
        break;
      }
      case "submit_review": {
        const milestone = required(milestones, action.milestoneId);
        if (
          milestone.projectId !== project.id ||
          !milestone.criteria.trim() ||
          !action.evidenceNote.trim() ||
          !["open", "changes_requested"].includes(milestone.gateState)
        )
          fail("invalid_transition");
        reviews.set(id, {
          id,
          projectId: project.id,
          milestoneId: milestone.id,
          criteriaSnapshot: milestone.criteria,
          criteriaRevision: milestone.criteriaRevision,
          gateGeneration: milestone.gateGeneration + 1,
          evidenceNote: action.evidenceNote,
          submitterPrincipalId: owner,
          createdAt: now,
        });
        milestone.gateState = "in_review";
        milestone.gateGeneration++;
        milestone.currentReviewId = id;
        milestone.revision = revision;
        objectId = id;
        break;
      }
      case "decide_review": {
        const milestone = required(milestones, action.milestoneId);
        const review = required(reviews, action.reviewId);
        if (
          milestone.projectId !== project.id ||
          review.milestoneId !== milestone.id ||
          milestone.gateState !== "in_review" ||
          milestone.currentReviewId !== review.id ||
          milestone.gateGeneration !== action.gateGeneration ||
          milestone.criteriaRevision !== action.criteriaRevision ||
          decisions.has(review.id)
        )
          fail("invalid_transition");
        decisions.set(review.id, {
          id,
          reviewId: review.id,
          principalId: owner,
          decision: action.decision,
          rationale: action.rationale,
          commandId: command.operationId,
          createdAt: now,
        });
        milestone.gateState = action.decision === "release" ? "released" : "changes_requested";
        milestone.revision = revision;
        objectId = milestone.id;
        break;
      }
    }
    project.revision = revision;
    project.updatedAt = now;
    return { objectId, revision, projectId: project.id };
  }
  const api: OpenBotDesktopApi["localPlanning"] = {
    availability: async () =>
      success({ ready: isLocal(), reason: isLocal() ? null : "unavailable", blockers: [], privateEpoch: epoch }),
    enter: async () => {
      if (!isLocal()) return failure("unavailable");
      epoch ??= crypto.randomUUID();
      return success({ generation, privateEpoch: epoch, localScopeId: scope, windowDraftId: draftWindow });
    },
    leave: async (input) => {
      if (!epoch || input.privateEpoch !== epoch) return failure("forbidden");
      exit = { privateEpoch: epoch, exitId: crypto.randomUUID() };
      for (const listener of exits) listener(clone(exit));
      return success({ exitId: exit.exitId });
    },
    confirmExit: async (input) => {
      if (!exit || input.privateEpoch !== exit.privateEpoch || input.exitId !== exit.exitId)
        return failure("invalid_transition");
      exit = null;
      if (input.outcome === "blocked") return failure("invalid_transition");
      epoch = null;
      generation = crypto.randomUUID();
      return success(undefined);
    },
    stopActivity: async () => success(undefined),
    listProjects: async ({ session: ref, input }) =>
      read(ref, () =>
        page(
          [...projects.values()].filter(
            (item) =>
              input.archive === "all" ||
              (input.archive === "archived" ? item.archivedAt !== null : item.archivedAt === null),
          ),
          input,
        ),
      ),
    getProject: async ({ session: ref, input }) => read(ref, () => required(projects, input)),
    listMilestones: async ({ session: ref, input }) =>
      read(ref, () =>
        page(
          [...milestones.values()].filter((item) => item.projectId === input.projectId),
          input,
        ),
      ),
    listTickets: async ({ session: ref, input }) =>
      read(ref, () =>
        page(
          [...tickets.values()].filter(
            (item) =>
              item.projectId === input.projectId &&
              (!input.status || item.status === input.status) &&
              (!input.milestoneId || item.milestoneId === input.milestoneId),
          ),
          input,
        ),
      ),
    listReviews: async ({ session: ref, input }) =>
      read(ref, () =>
        page(
          [...reviews.values()].filter(
            (item) => item.projectId === input.projectId && item.milestoneId === input.milestoneId,
          ),
          input,
        ),
      ),
    getReview: async ({ session: ref, input }) =>
      read(ref, () => ({ review: required(reviews, input), decision: decisions.get(input) ?? null })),
    listDrafts: async ({ session: ref, input }) => read(ref, () => page([...drafts.values()], input)),
    run: async ({ session: ref, input }) =>
      read(ref, () => {
        const fingerprint = JSON.stringify(input);
        const receipt = receipts.get(input.operationId);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail("operation_conflict");
          return receipt.result;
        }
        if (exit && input.action.kind !== "save_draft") {
          exit = null;
          fail("invalid_transition");
        }
        const result = apply(input);
        if (input.consumedDraft) drafts.delete(input.consumedDraft.id);
        receipts.set(input.operationId, { fingerprint, result });
        for (const listener of changes)
          listener({ localScopeId: scope, generation, objectId: result.objectId, revision: result.revision });
        return result;
      }),
    onChanged: (listener) => {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    onPrepareExit: (listener) => {
      exits.add(listener);
      return () => exits.delete(listener);
    },
  };
  return {
    api,
    selectionStarted: () => {
      generation = crypto.randomUUID();
    },
  };
}
