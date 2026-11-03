import type {
  DecisionView,
  DraftInput,
  DraftView,
  MilestoneView,
  PlanningAvailability,
  ProjectView,
  ReviewView,
  TicketView,
} from "@openbot/contracts/ipc";
import { Button, Field, Textarea } from "@openbot/ui";
import { createEffect, For, Show } from "solid-js";
import { useText } from "../../text";
import { MilestoneReview } from "./MilestoneReview";
import { ProjectForm } from "./ProjectForm";
import { TicketForm } from "./TicketForm";

export interface WorkPlanningProps {
  local: boolean;
  stale: boolean;
  admitted: boolean;
  availability: PlanningAvailability | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  notice: string | null;
  conflict: boolean;
  archived: boolean;
  projects: ProjectView[];
  project: ProjectView | null;
  milestones: MilestoneView[];
  milestone: MilestoneView | null;
  tickets: TicketView[];
  reviews: ReviewView[];
  review: { review: ReviewView; decisions: DecisionView[] } | null;
  drafts: DraftView[];
  form: DraftInput | null;
  more: Record<"projects" | "milestones" | "tickets" | "reviews" | "drafts", boolean>;
  onEnter: () => void;
  onRetry: () => void;
  onStop: (id: string) => void;
  onSelectProject: (project: ProjectView) => void;
  onSelectMilestone: (milestone: MilestoneView) => void;
  onSelectTicket: (ticket: TicketView) => void;
  onForm: (form: DraftInput) => void;
  onChange: (form: DraftInput) => void;
  onSave: () => void;
  onSaveDraft: () => void;
  onDiscardForm: () => void;
  onArchive: () => void;
  onToggleArchive: () => void;
  onRefresh: () => void;
  onRetryRevision: () => void;
  onMore: (list: keyof WorkPlanningProps["more"]) => void;
  onRecover: (draft: DraftView) => void;
  onDiscardDraft: (draft: DraftView) => void;
  onReview: (review: ReviewView) => void;
  onRationale: (text: string) => void;
  onDecide: (decision: "release" | "request_changes") => void;
}
function projectInput(input: DraftInput): Parameters<typeof ProjectForm>[0]["input"] | null {
  if (input.target.kind === "project" && "goal" in input.form) return { target: input.target, form: input.form };
  if (input.target.kind === "milestone" && "criteria" in input.form && !("status" in input.form))
    return { target: input.target, form: input.form };
  return null;
}
function ticketInput(input: DraftInput): Parameters<typeof TicketForm>[0]["input"] | null {
  return input.target.kind === "ticket" && "status" in input.form ? { target: input.target, form: input.form } : null;
}
function evidence(input: DraftInput): string {
  return "evidenceNote" in input.form ? input.form.evidenceNote : "";
}
const gateKeys = {
  open: "work.openGate",
  in_review: "work.inReview",
  released: "work.released",
  changes_requested: "work.changesRequested",
} as const;
const statusKeys = { todo: "work.todo", in_progress: "work.inProgress", done: "work.done" } as const;
export function WorkPlanning(props: WorkPlanningProps) {
  const { t } = useText();
  const draftLabel = (draft: DraftView) =>
    ("title" in draft.form
      ? draft.form.title
      : "evidenceNote" in draft.form
        ? draft.form.evidenceNote
        : draft.form.rationale) || t("work.drafts");
  let root: HTMLElement | undefined;
  const saveOnBlur = (next: EventTarget | null) => {
    if (!(next instanceof Node) || !root?.contains(next)) props.onSaveDraft();
  };
  let heading: HTMLHeadingElement | undefined;
  createEffect(
    () => props.form === null,
    (empty, previous) => {
      if (empty && previous === false) heading?.focus();
    },
  );
  const newProject = () => props.onForm({ target: { kind: "project", id: null }, form: { title: "", goal: "" } });
  const more = (list: keyof WorkPlanningProps["more"]) => (
    <Show when={props.more[list]}>
      <Button
        variant="ghost"
        disabled={props.busy || props.loading}
        aria-label={`${t("work.more")} - ${t(list === "projects" ? "work.projects" : list === "milestones" ? "work.milestones" : list === "tickets" ? "work.tickets" : list === "reviews" ? "work.reviews" : "work.drafts")}`}
        onClick={() => props.onMore(list)}
      >
        {t("work.more")}
      </Button>
    </Show>
  );
  return (
    <section
      ref={(element) => {
        root = element;
      }}
      class="work-planning"
      aria-label={t("work.title")}
    >
      <Show when={props.loading}>
        <p role="status" aria-label={t("work.busy")}>
          {t("work.busy")}
        </p>
      </Show>
      <Show when={props.error}>
        <p role="alert">{props.error}</p>
      </Show>
      <Show when={props.notice}>
        <p role="status">{props.notice}</p>
      </Show>
      <Show
        when={props.admitted}
        fallback={
          <>
            <h1>{t("work.privateTitle")}</h1>
            <p role="status">
              {!props.local || props.availability?.reason === "unavailable"
                ? t("work.unsupported")
                : t("work.explanation")}
            </p>
            <Show when={props.local}>
              <Show when={props.availability?.blockers.length}>
                <p>{t("work.blockers")}</p>
                <For each={props.availability?.blockers}>
                  {(blocker) => (
                    <div class="work-actions">
                      <span>
                        {t(
                          blocker.kind === "cua_runtime"
                            ? "work.computerControl"
                            : blocker.kind === "remote_screen_runtime"
                              ? "work.remoteViewing"
                              : "work.capture",
                        )}
                      </span>
                      <Button variant="ghost" onClick={() => props.onStop(blocker.id)}>
                        {t("work.stop")}
                      </Button>
                    </div>
                  )}
                </For>
              </Show>
              <Button disabled={props.busy || props.availability?.ready !== true} onClick={() => props.onEnter()}>
                {t("work.enter")}
              </Button>
              <Button variant="ghost" onClick={() => props.onRetry()}>
                {t("work.retry")}
              </Button>
            </Show>
          </>
        }
      >
        <header class="work-actions">
          <h1>{t("work.title")}</h1>
        </header>
        <Show when={props.stale}>
          <Button disabled={props.busy} onClick={() => props.onEnter()}>
            {t("work.renew")}
          </Button>
        </Show>
        <div class="work-columns">
          <aside class="work-list" aria-label={t("work.projects")}>
            <Button disabled={props.busy} onClick={newProject}>
              {t("work.newProject")}
            </Button>
            <Button variant="ghost" disabled={props.busy} onClick={() => props.onToggleArchive()}>
              {t(props.archived ? "work.active" : "work.archived")}
            </Button>
            <For each={props.projects}>
              {(project) => (
                <Button
                  variant="ghost"
                  disabled={props.busy}
                  aria-pressed={props.project?.id === project.id ? "true" : "false"}
                  onClick={() => props.onSelectProject(project)}
                >
                  {project.title}
                </Button>
              )}
            </For>
            {more("projects")}
            <h2>{t("work.drafts")}</h2>
            <For each={props.drafts}>
              {(draft) => (
                <article class="work-draft" aria-label={draftLabel(draft)}>
                  <p class="work-text">{draftLabel(draft)}</p>
                  <Button variant="ghost" disabled={props.busy} onClick={() => props.onRecover(draft)}>
                    {t("work.recoverDraft")}
                  </Button>
                  <Button variant="ghost" disabled={props.busy} onClick={() => props.onDiscardDraft(draft)}>
                    {t("work.discardDraft")}
                  </Button>
                </article>
              )}
            </For>
            {more("drafts")}
          </aside>
          <div class="work-detail">
            <Show when={props.project}>
              {(project) => (
                <>
                  <h2
                    ref={(element) => {
                      heading = element;
                    }}
                    tabindex={-1}
                  >
                    {project().title}
                  </h2>
                  <p class="work-text">{project().goal}</p>
                  <div class="work-actions">
                    <Button
                      variant="ghost"
                      disabled={props.busy || !!project().archivedAt}
                      onClick={() =>
                        props.onForm({
                          target: { kind: "project", id: project().id },
                          form: { title: project().title, goal: project().goal },
                        })
                      }
                    >
                      {t("work.editProject")}
                    </Button>
                    <Button variant="ghost" disabled={props.busy} onClick={() => props.onArchive()}>
                      {t(project().archivedAt ? "work.restore" : "work.archive")}
                    </Button>
                    <Button variant="ghost" disabled={props.busy} onClick={() => props.onRefresh()}>
                      {t("work.refresh")}
                    </Button>
                  </div>
                  <h3>{t("work.milestones")}</h3>
                  <Button
                    variant="ghost"
                    disabled={props.busy || !!project().archivedAt}
                    onClick={() =>
                      props.onForm({
                        target: { kind: "milestone", projectId: project().id, id: null },
                        form: { title: "", criteria: "" },
                      })
                    }
                  >
                    {t("work.newMilestone")}
                  </Button>
                  <For each={props.milestones}>
                    {(milestone) => (
                      <div class="work-actions">
                        <Button
                          variant="ghost"
                          disabled={props.busy}
                          aria-pressed={props.milestone?.id === milestone.id ? "true" : "false"}
                          onClick={() => props.onSelectMilestone(milestone)}
                        >
                          {milestone.title}
                        </Button>
                        <span>{t(gateKeys[milestone.gateState])}</span>
                      </div>
                    )}
                  </For>
                  {more("milestones")}
                  <Show when={props.milestone}>
                    {(milestone) => (
                      <section class="work-review">
                        <h3>{milestone().title}</h3>
                        <p class="work-text">{milestone().criteria}</p>
                        <Button
                          variant="ghost"
                          disabled={props.busy || !!project().archivedAt}
                          onClick={() =>
                            props.onForm({
                              target: { kind: "milestone", projectId: project().id, id: milestone().id },
                              form: { title: milestone().title, criteria: milestone().criteria },
                            })
                          }
                        >
                          {t("work.editMilestone")}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={props.busy || !!project().archivedAt}
                          onClick={() =>
                            props.onForm({
                              target: { kind: "review", projectId: project().id, milestoneId: milestone().id },
                              form: { evidenceNote: "" },
                            })
                          }
                        >
                          {t("work.submitReview")}
                        </Button>
                        <h3>{t("work.reviews")}</h3>
                        <For each={props.reviews}>
                          {(review) => (
                            <Button variant="ghost" disabled={props.busy} onClick={() => props.onReview(review)}>
                              {t("work.reviewDetails")}
                            </Button>
                          )}
                        </For>
                        {more("reviews")}
                      </section>
                    )}
                  </Show>
                  <h3>{t("work.tickets")}</h3>
                  <Button
                    variant="ghost"
                    disabled={props.busy || !!project().archivedAt}
                    onClick={() =>
                      props.onForm({
                        target: { kind: "ticket", projectId: project().id, id: null },
                        form: {
                          title: "",
                          criteria: "",
                          notes: "",
                          status: "todo",
                          milestoneId: props.milestone?.id ?? null,
                        },
                      })
                    }
                  >
                    {t("work.newTicket")}
                  </Button>
                  <For each={props.tickets}>
                    {(ticket) => (
                      <div class="work-actions">
                        <Button
                          variant="ghost"
                          disabled={props.busy || !!project().archivedAt}
                          onClick={() => props.onSelectTicket(ticket)}
                        >
                          {ticket.title}
                        </Button>
                        <span>{t(statusKeys[ticket.status])}</span>
                      </div>
                    )}
                  </For>
                  {more("tickets")}
                </>
              )}
            </Show>
            <Show when={props.form}>
              {(input) => (
                <>
                  <Show when={projectInput(input())}>
                    {(project) => (
                      <ProjectForm
                        input={project()}
                        busy={props.busy}
                        onChange={props.onChange}
                        onSave={() => {
                          props.onSave();
                        }}
                        onBlur={saveOnBlur}
                      />
                    )}
                  </Show>
                  <Show when={ticketInput(input())}>
                    {(ticket) => (
                      <TicketForm
                        input={ticket()}
                        milestones={props.milestones}
                        busy={props.busy}
                        onChange={props.onChange}
                        onSave={props.onSave}
                        onBlur={saveOnBlur}
                      />
                    )}
                  </Show>
                  <Show when={"evidenceNote" in input().form}>
                    <form
                      class="work-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        props.onSave();
                      }}
                      onFocusOut={(event) => {
                        if (
                          !(event.relatedTarget instanceof Node) ||
                          !event.currentTarget.contains(event.relatedTarget)
                        )
                          saveOnBlur(event.relatedTarget);
                      }}
                    >
                      <Field label={t("work.evidence")}>
                        <Textarea
                          value={evidence(input())}
                          disabled={props.busy}
                          onValueChange={(evidenceNote) => {
                            const form = input();
                            if (form.target.kind === "review")
                              props.onChange({ target: form.target, form: { evidenceNote } });
                          }}
                        />
                      </Field>
                      <Button type="submit" disabled={props.busy}>
                        {t("work.saveReview")}
                      </Button>
                    </form>
                  </Show>
                  <div class="work-actions">
                    <Button variant="ghost" disabled={props.busy} onClick={() => props.onSaveDraft()}>
                      {t("work.saveDraft")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={props.busy}
                      onClick={() => {
                        props.onDiscardForm();
                        heading?.focus();
                      }}
                    >
                      {t("work.discardForm")}
                    </Button>
                  </div>
                </>
              )}
            </Show>
            <Show when={props.conflict}>
              <p>{t("work.conflictHint")}</p>
              <Button variant="ghost" disabled={props.busy} onClick={() => props.onRetryRevision()}>
                {t("work.retryRevision")}
              </Button>
            </Show>
            <Show when={props.review}>
              {(detail) => (
                <MilestoneReview
                  review={detail().review}
                  decisions={detail().decisions}
                  rationale={props.form && "rationale" in props.form.form ? props.form.form.rationale : ""}
                  busy={props.busy}
                  canDecide={
                    props.form?.target.kind === "decision" &&
                    props.form.target.reviewId === detail().review.id &&
                    !props.conflict &&
                    props.milestone?.gateState === "in_review" &&
                    props.milestone.currentReviewId === detail().review.id &&
                    !props.project?.archivedAt
                  }
                  onRationale={props.onRationale}
                  onDecide={props.onDecide}
                  onBlur={saveOnBlur}
                />
              )}
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
