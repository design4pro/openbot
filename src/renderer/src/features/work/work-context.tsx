import type {
  DecisionView,
  DraftInput,
  DraftView,
  MilestoneView,
  Page,
  PlanningAction,
  PlanningAvailability,
  PlanningCommand,
  PlanningReply,
  PlanningSession,
  ProjectView,
  ReviewView,
  TicketView,
} from "@openbot/contracts/ipc";
import { planningDraftTargetKey } from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import { createStore, flush, onSettled, snapshot, untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useConversationController } from "../conversation/conversation-controller-context";
import { useServers } from "../servers/servers-context";
import { type WorkPort, workPort } from "./work-port";
import type { WorkFlush } from "./work-privacy-context";

export interface WorkSelection {
  scopeId: string | null;
  projectId: string | null;
}
interface WorkProps {
  port?: WorkPort;
  selection: WorkSelection;
  registerFlush: (flush: WorkFlush) => () => void;
  enrolled: (epoch: string) => void;
}
export interface WorkState {
  local: boolean;
  stale: boolean;
  availability: PlanningAvailability | null;
  session: PlanningSession | null;
  projects: Page<ProjectView>;
  project: ProjectView | null;
  milestones: Page<MilestoneView>;
  tickets: Page<TicketView>;
  milestone: MilestoneView | null;
  ticket: TicketView | null;
  reviews: Page<ReviewView>;
  review: { review: ReviewView; decisions: DecisionView[] } | null;
  drafts: Page<DraftView>;
  form: DraftInput | null;
  expectedRevision: number | null;
  savedDraft: { id: string; revision: number } | null;
  dirty: boolean;
  archived: boolean;
  busy: boolean;
  loading: boolean;
  error: string | null;
  conflict: boolean;
  notice: string | null;
}
function empty<T>(): Page<T> {
  return { items: [], next: null };
}
const context = createSimpleContext({
  name: "Work",
  init: (props: WorkProps) => {
    const { t, errorMessage } = useText();
    const { activeServerId } = useServers();
    const agents = useAgents();
    const channels = useChannels();
    const conversation = useConversationController();
    const port = untrack(() => props.port) ?? workPort();
    const [state, setState] = createStore<WorkState>({
      local: untrack(activeServerId) === "local",
      stale: false,
      availability: null,
      session: null,
      projects: empty<ProjectView>(),
      project: null,
      milestones: empty<MilestoneView>(),
      tickets: empty<TicketView>(),
      milestone: null,
      ticket: null,
      reviews: empty<ReviewView>(),
      review: null,
      drafts: empty<DraftView>(),
      form: null,
      expectedRevision: null,
      savedDraft: null,
      dirty: false,
      archived: false,
      busy: false,
      loading: false,
      error: null,
      conflict: false,
      notice: null,
    });
    let disposed = false;
    let readSequence = 0;
    let writing: Promise<boolean> | null = null;
    let command: { fingerprint: string; value: PlanningCommand } | null = null;
    const current = (session: PlanningSession) => !disposed && state.session?.generation === session.generation;
    function value<T>(reply: PlanningReply<T>): T {
      if (!reply.ok) {
        setState((draft) => {
          draft.conflict = reply.error.code === "revision_conflict";
          if (reply.error.code === "stale_scope") draft.stale = true;
        });
        throw new Error(reply.error.message);
      }
      return reply.value;
    }
    function failed(cause: unknown): void {
      if (!disposed)
        setState((draft) => {
          draft.error = errorMessage(cause, t("work.failed"));
        });
    }
    async function availability(): Promise<void> {
      if (!state.local || disposed) return;
      try {
        const reply = await port.localPlanning.availability();
        const result = value(reply);
        if (!disposed) {
          setState((draft) => {
            draft.availability = result;
          });
          if (result.privateEpoch) props.enrolled(result.privateEpoch);
        }
      } catch (cause) {
        failed(cause);
      }
    }
    async function refresh(
      append: "projects" | "milestones" | "tickets" | "drafts" | "reviews" | null = null,
    ): Promise<void> {
      const session = state.session;
      if (!session) return;
      const sequence = ++readSequence;
      setState((draft) => {
        draft.loading = true;
      });
      const projectId = state.project?.id ?? null;
      const milestoneId = state.milestone?.id ?? null;
      const archive = state.archived ? ("archived" as const) : ("active" as const);
      const cursor = append ? snapshot(state[append].next) : null;
      try {
        const projects = value(
          await port.localPlanning.listProjects({
            session: { generation: session.generation },
            input: { archive, limit: 20, ...(append === "projects" && cursor ? { after: cursor } : {}) },
          }),
        );
        const drafts = value(
          await port.localPlanning.listDrafts({
            session: { generation: session.generation },
            input: { limit: 20, ...(append === "drafts" && cursor ? { after: cursor } : {}) },
          }),
        );
        const project = projectId
          ? value(
              await port.localPlanning.getProject({ session: { generation: session.generation }, input: projectId }),
            )
          : null;
        const milestones = projectId
          ? value(
              await port.localPlanning.listMilestones({
                session: { generation: session.generation },
                input: { projectId, limit: 20, ...(append === "milestones" && cursor ? { after: cursor } : {}) },
              }),
            )
          : empty<MilestoneView>();
        const tickets = projectId
          ? value(
              await port.localPlanning.listTickets({
                session: { generation: session.generation },
                input: { projectId, limit: 20, ...(append === "tickets" && cursor ? { after: cursor } : {}) },
              }),
            )
          : empty<TicketView>();
        const reviews =
          projectId && milestoneId
            ? value(
                await port.localPlanning.listReviews({
                  session: { generation: session.generation },
                  input: {
                    projectId,
                    milestoneId,
                    limit: 20,
                    ...(append === "reviews" && cursor ? { after: cursor } : {}),
                  },
                }),
              )
            : empty<ReviewView>();
        if (!current(session) || sequence !== readSequence) return;
        setState((draft) => {
          if (!append || append === "projects")
            draft.projects = {
              items: append ? [...draft.projects.items, ...projects.items] : projects.items,
              next: projects.next,
            };
          if (!append || append === "drafts")
            draft.drafts = {
              items: append ? [...draft.drafts.items, ...drafts.items] : drafts.items,
              next: drafts.next,
            };
          if (!append || append === "milestones")
            draft.milestones = {
              items: append ? [...draft.milestones.items, ...milestones.items] : milestones.items,
              next: milestones.next,
            };
          if (!append || append === "tickets")
            draft.tickets = {
              items: append ? [...draft.tickets.items, ...tickets.items] : tickets.items,
              next: tickets.next,
            };
          if (!append || append === "reviews")
            draft.reviews = {
              items: append ? [...draft.reviews.items, ...reviews.items] : reviews.items,
              next: reviews.next,
            };
          draft.project = project;
          if (draft.milestone)
            draft.milestone = milestones.items.find((row) => row.id === draft.milestone?.id) ?? draft.milestone;
          if (draft.ticket) draft.ticket = tickets.items.find((row) => row.id === draft.ticket?.id) ?? draft.ticket;
        });
      } catch (cause) {
        if (current(session) && sequence === readSequence) failed(cause);
      } finally {
        if (current(session) && sequence === readSequence)
          setState((draft) => {
            draft.loading = false;
          });
      }
    }
    async function enter(): Promise<void> {
      if (!state.local || state.busy) return;
      setState((draft) => {
        draft.busy = true;
        draft.error = null;
      });
      try {
        const session = value(await port.localPlanning.enter());
        if (disposed) return;
        setState((draft) => {
          draft.session = session;
          draft.stale = false;
        });
        props.enrolled(session.privateEpoch);
        if (props.selection.scopeId === session.localScopeId && props.selection.projectId) {
          const project = value(
            await port.localPlanning.getProject({
              session: { generation: session.generation },
              input: props.selection.projectId,
            }),
          );
          if (current(session))
            setState((draft) => {
              draft.project = project;
            });
        }
        flush();
        await refresh();
      } catch (cause) {
        failed(cause);
        await availability();
      } finally {
        if (!disposed)
          setState((draft) => {
            draft.busy = false;
          });
      }
    }
    async function run(action: PlanningAction, consume = false): Promise<boolean> {
      const session = state.session;
      if (!session || disposed) return false;
      const consumedDraft = consume ? state.savedDraft : null;
      const fingerprint = JSON.stringify({ action, consumedDraft });
      if (command?.fingerprint !== fingerprint)
        command = {
          fingerprint,
          value: {
            operationId: crypto.randomUUID(),
            action,
            ...(consumedDraft ? { consumedDraft: { ...consumedDraft } } : {}),
          },
        };
      try {
        const result = value(
          await port.localPlanning.run({ session: { generation: session.generation }, input: command.value }),
        );
        if (!current(session)) return false;
        command = null;
        if (action.kind === "save_draft")
          setState((draft) => {
            draft.savedDraft = { id: result.objectId, revision: result.revision };
            draft.dirty = false;
            draft.notice = t("work.draftSaved");
          });
        else if (consume)
          setState((draft) => {
            draft.form = null;
            draft.savedDraft = null;
            draft.dirty = false;
            draft.notice = t("work.saved");
          });
        if (action.kind === "create_project") {
          const project = value(
            await port.localPlanning.getProject({
              session: { generation: session.generation },
              input: result.objectId,
            }),
          );
          if (!current(session)) return false;
          setState((draft) => {
            draft.project = project;
          });
          props.selection.scopeId = session.localScopeId;
          props.selection.projectId = project.id;
        }
        flush();
        await refresh();
        return true;
      } catch (cause) {
        if (current(session)) failed(cause);
        return false;
      }
    }
    async function serialize(operation: () => Promise<boolean>): Promise<boolean> {
      if (writing) return writing;
      setState((draft) => {
        draft.busy = true;
        draft.error = null;
        draft.notice = null;
      });
      writing = operation();
      try {
        return await writing;
      } finally {
        writing = null;
        if (!disposed)
          setState((draft) => {
            draft.busy = false;
          });
      }
    }
    async function saveDraft(): Promise<boolean> {
      if (writing) {
        if (!(await writing)) return false;
      }
      if (!state.form || !state.dirty) return true;
      const form = snapshot(state.form);
      return serialize(() =>
        run({
          kind: "save_draft",
          draftId: state.savedDraft?.id ?? null,
          expectedDraftRevision: state.savedDraft?.revision ?? null,
          ...form,
        }),
      );
    }
    async function discardForm(): Promise<boolean> {
      if (writing && !(await writing)) return false;
      // This explicitly discards volatile input. A durable recovery copy is removed only by its named action.
      setState((draft) => {
        draft.form = null;
        draft.savedDraft = null;
        draft.dirty = false;
        draft.error = null;
      });
      return true;
    }
    const otherEditorOpen = () =>
      agents.agentSetupOpen() || channels.state.editing !== null || conversation.editingAgentId() !== null;
    async function beforeScopeExit(): Promise<boolean> {
      return saveDraft();
    }
    async function showForm(form: DraftInput): Promise<boolean> {
      if (!(await saveDraft()) || disposed) return false;
      const session = state.session;
      if (!session) return false;
      try {
        if ("id" in form.target && form.target.id === null && !form.target.formId)
          form.target.formId = crypto.randomUUID();
        const drafts = value(
          await port.localPlanning.listDrafts({ session: { generation: session.generation }, input: { limit: 100 } }),
        );
        if (!current(session)) return false;
        const owned = drafts.items.find(
          (draft) =>
            draft.windowDraftId === session.windowDraftId &&
            planningDraftTargetKey(draft.target) === planningDraftTargetKey(form.target),
        );
        const needsReview = !!owned && !("id" in form.target && form.target.id === null);
        setState((draft) => {
          if (owned) {
            draft.form = form;
            Object.assign(draft.form.form, owned.form);
            draft.savedDraft = { id: owned.id, revision: owned.revision };
          } else {
            draft.form = form;
            draft.savedDraft = null;
          }
          draft.dirty = false;
          draft.expectedRevision = needsReview ? null : (draft.project?.revision ?? null);
          draft.error = null;
          draft.conflict = needsReview;
          if (owned) draft.notice = t("work.draftRestored");
        });
        return true;
      } catch (cause) {
        if (current(session)) failed(cause);
        return false;
      }
    }
    function patchForm(form: DraftInput): void {
      if (state.busy) return;
      setState((draft) => {
        draft.form = form;
        draft.dirty = true;
        draft.notice = null;
      });
    }
    async function saveForm(): Promise<boolean> {
      if (writing && !(await writing)) return false;
      const form = snapshot(state.form);
      if (!form) return false;
      const fields = Object.entries(form.form).filter(([, value]) => typeof value === "string");
      if (
        fields.some(([key, text]) => typeof text === "string" && [...text].length > (key === "title" ? 256 : 32768)) ||
        ("title" in form.form && !form.form.title.trim())
      ) {
        setState((draft) => {
          draft.error = t("work.titleLimit");
        });
        return false;
      }
      let action: PlanningAction;
      const expectedRevision = state.expectedRevision;
      if (expectedRevision === null && !(form.target.kind === "project" && form.target.id === null)) {
        setState((draft) => {
          draft.conflict = true;
          draft.error = t("work.conflictHint");
        });
        return false;
      }
      if (form.target.kind === "project" && "goal" in form.form) {
        action = form.target.id
          ? { kind: "edit_project", projectId: form.target.id, expectedRevision: expectedRevision ?? 0, ...form.form }
          : { kind: "create_project", ...form.form };
      } else if (
        form.target.kind === "milestone" &&
        "title" in form.form &&
        "criteria" in form.form &&
        !("status" in form.form)
      ) {
        action = form.target.id
          ? {
              kind: "edit_milestone",
              projectId: form.target.projectId,
              milestoneId: form.target.id,
              expectedRevision: expectedRevision ?? 0,
              ...form.form,
            }
          : {
              kind: "create_milestone",
              projectId: form.target.projectId,
              expectedRevision: expectedRevision ?? 0,
              ...form.form,
            };
      } else if (form.target.kind === "ticket" && "status" in form.form) {
        action = form.target.id
          ? {
              kind: "edit_ticket",
              projectId: form.target.projectId,
              ticketId: form.target.id,
              expectedRevision: expectedRevision ?? 0,
              ...form.form,
            }
          : {
              kind: "create_ticket",
              projectId: form.target.projectId,
              expectedRevision: expectedRevision ?? 0,
              ...form.form,
            };
      } else if (form.target.kind === "review" && "evidenceNote" in form.form) {
        action = {
          kind: "submit_review",
          projectId: form.target.projectId,
          milestoneId: form.target.milestoneId,
          expectedRevision: expectedRevision ?? 0,
          ...form.form,
        };
      } else if (
        form.target.kind === "decision" &&
        "rationale" in form.form &&
        state.review?.review.id === form.target.reviewId
      ) {
        const review = state.review.review;
        action = {
          kind: "decide_review",
          projectId: form.target.projectId,
          milestoneId: form.target.milestoneId,
          reviewId: form.target.reviewId,
          expectedRevision: expectedRevision ?? 0,
          gateGeneration: review.gateGeneration,
          criteriaRevision: review.criteriaRevision,
          ...form.form,
        };
      } else return false;
      return serialize(() => run(action, true));
    }
    async function selectProject(project: ProjectView): Promise<void> {
      if (!(await saveDraft()) || disposed) return;
      setState((draft) => {
        draft.project = project;
        draft.milestone = null;
        draft.ticket = null;
        draft.review = null;
        draft.form = null;
        draft.savedDraft = null;
        draft.error = null;
      });
      props.selection.scopeId = state.session?.localScopeId ?? null;
      props.selection.projectId = project.id;
      flush();
      await refresh();
    }
    onSettled(() => {
      const unregister = props.registerFlush({
        save: async () => !otherEditorOpen() && (await saveDraft()),
        discard: async () => !otherEditorOpen() && (await discardForm()),
      });
      const unsubscribe = port.localPlanning.onChanged((change) => {
        if (state.session?.generation === change.generation && !writing) void refresh();
      });
      return () => {
        disposed = true;
        readSequence++;
        unsubscribe();
        unregister();
      };
    });
    return {
      state,
      availability,
      enter,
      refresh,
      saveDraft,
      saveForm,
      discardForm,
      showForm,
      patchForm,
      beforeScopeExit,
      selectProject,
      async stop(activityId: string) {
        try {
          value(await port.localPlanning.stopActivity({ activityId }));
          await availability();
        } catch (cause) {
          failed(cause);
        }
      },
      async toggleArchiveList() {
        if (!(await saveDraft())) return;
        setState((draft) => {
          draft.archived = !draft.archived;
        });
        flush();
        await refresh();
      },
      async archive() {
        const project = state.project;
        if (project && (await saveDraft()))
          await serialize(() =>
            run({
              kind: project.archivedAt ? "restore_project" : "archive_project",
              projectId: project.id,
              expectedRevision: project.revision,
            }),
          );
      },
      async selectMilestone(milestone: MilestoneView) {
        if (!(await saveDraft())) return;
        setState((draft) => {
          draft.milestone = milestone;
          draft.ticket = null;
          draft.review = null;
          draft.form = null;
        });
        flush();
        await refresh();
      },
      async selectTicket(ticket: TicketView) {
        await showForm({
          target: { kind: "ticket", projectId: ticket.projectId, id: ticket.id },
          form: {
            milestoneId: ticket.milestoneId,
            title: ticket.title,
            criteria: ticket.criteria,
            notes: ticket.notes,
            status: ticket.status,
          },
        });
      },
      async recover(draft: DraftView) {
        if (!(await saveDraft())) return;
        const target = snapshot(draft.target);
        const form = snapshot(draft.form);
        const session = state.session;
        if (!session) return;
        if (draft.windowDraftId !== session.windowDraftId) {
          try {
            const saved = value(
              await port.localPlanning.listDrafts({
                session: { generation: session.generation },
                input: { limit: 100 },
              }),
            );
            if (!current(session)) return;
            if (
              !("id" in target && target.id === null) &&
              saved.items.some(
                (entry) =>
                  entry.windowDraftId === session.windowDraftId &&
                  planningDraftTargetKey(entry.target) === planningDraftTargetKey(target),
              )
            ) {
              failed(new Error(t("work.draftExists")));
              return;
            }
          } catch (cause) {
            failed(cause);
            return;
          }
        }
        if ("id" in target && target.id === null && draft.windowDraftId !== session.windowDraftId)
          target.formId = crypto.randomUUID();
        const projectId = target.kind === "project" ? target.id : target.projectId;
        if (projectId) {
          try {
            const project = value(
              await port.localPlanning.getProject({ session: { generation: session.generation }, input: projectId }),
            );
            if (!current(session)) return;
            await selectProject(project);
            if (!current(session)) return;
          } catch (cause) {
            failed(cause);
            return;
          }
        }
        const milestoneId =
          "milestoneId" in target ? target.milestoneId : target.kind === "milestone" ? target.id : null;
        if (projectId && milestoneId) {
          try {
            let after: Page<MilestoneView>["next"] = null;
            let selected: MilestoneView | undefined;
            do {
              const page: Page<MilestoneView> = value(
                await port.localPlanning.listMilestones({
                  session: { generation: session.generation },
                  input: { projectId, limit: 100, ...(after ? { after } : {}) },
                }),
              );
              if (!current(session)) return;
              selected = page.items.find((milestone) => milestone.id === milestoneId);
              after = page.next;
            } while (!selected && after);
            if (!selected) throw new Error(t("work.failed"));
            setState((state) => {
              state.milestone = selected;
            });
            flush();
          } catch (cause) {
            failed(cause);
            return;
          }
        }
        let restored = false;
        if (target.kind === "project" && "goal" in form) restored = await showForm({ target, form });
        else if (target.kind === "milestone" && "criteria" in form && !("status" in form))
          restored = await showForm({ target, form });
        else if (target.kind === "ticket" && "status" in form) restored = await showForm({ target, form });
        else if (target.kind === "review" && "evidenceNote" in form) restored = await showForm({ target, form });
        else if (target.kind === "decision" && "rationale" in form) {
          try {
            const detail = value(
              await port.localPlanning.getReview({
                session: { generation: session.generation },
                input: target.reviewId,
              }),
            );
            if (!current(session)) return;
            setState((state) => {
              state.review = { review: detail.review, decisions: detail.decision ? [detail.decision] : [] };
            });
            restored = await showForm({ target, form });
          } catch (cause) {
            failed(cause);
            return;
          }
        }
        if (!restored) return;
        setState((state) => {
          state.dirty = true;
          if (!("id" in target && target.id === null)) {
            state.expectedRevision = null;
            state.conflict = true;
          }
          state.notice = t("work.draftRestored");
        });
      },
      async discardDraft(draft: DraftView) {
        await serialize(() => run({ kind: "discard_draft", draftId: draft.id, expectedDraftRevision: draft.revision }));
      },
      async showReview(review: ReviewView) {
        const session = state.session;
        if (!session || !(await saveDraft())) return;
        try {
          const detail = value(
            await port.localPlanning.getReview({ session: { generation: session.generation }, input: review.id }),
          );
          if (!current(session)) return;
          setState((draft) => {
            draft.review = { review: detail.review, decisions: detail.decision ? [detail.decision] : [] };
          });
          await showForm({
            target: {
              kind: "decision",
              projectId: review.projectId,
              milestoneId: review.milestoneId,
              reviewId: review.id,
            },
            form: { decision: "release", rationale: "" },
          });
        } catch (cause) {
          failed(cause);
        }
      },
      rationale(text: string) {
        const form = state.form;
        if (form?.target.kind === "decision" && "rationale" in form.form)
          patchForm({ target: snapshot(form.target), form: { ...snapshot(form.form), rationale: text } });
      },
      async decide(decision: "release" | "request_changes") {
        if (writing && !(await writing)) return;
        const form = state.form;
        const review = state.review?.review;
        if (
          form?.target.kind !== "decision" ||
          !("rationale" in form.form) ||
          !review ||
          state.expectedRevision === null
        )
          return;
        const rationale = form.form.rationale;
        const result = await serialize(() =>
          run(
            {
              kind: "decide_review",
              projectId: review.projectId,
              milestoneId: review.milestoneId,
              reviewId: review.id,
              gateGeneration: review.gateGeneration,
              criteriaRevision: review.criteriaRevision,
              expectedRevision: state.expectedRevision ?? 0,
              decision,
              rationale,
            },
            true,
          ),
        );
        const session = state.session;
        if (result && session) {
          try {
            const detail = value(
              await port.localPlanning.getReview({ session: { generation: session.generation }, input: review.id }),
            );
            if (current(session))
              setState((draft) => {
                draft.review = { review: detail.review, decisions: detail.decision ? [detail.decision] : [] };
              });
          } catch (cause) {
            failed(cause);
          }
        }
      },
      retryRevision() {
        setState((draft) => {
          draft.expectedRevision = draft.project?.revision ?? null;
          draft.conflict = false;
          draft.error = null;
        });
      },
    };
  },
});
export const WorkProvider = context.provider;
export const useWork = context.use;
