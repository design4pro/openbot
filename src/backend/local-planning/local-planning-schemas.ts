import { Schema } from "effect";

export const planningId = Schema.String.check(Schema.isUUID());
export const planningRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const planningText = Schema.String.check(Schema.makeFilter((value) => !/[\uD800-\uDFFF]/u.test(value)));
export const planningTitleText = planningText.check(Schema.isMaxCodePoints(256));
export const planningTitle = planningTitleText.check(Schema.isPattern(/\S/u));
export const planningBody = planningText.check(Schema.isMaxCodePoints(32768));
const status = Schema.Literals(["todo", "in_progress", "done"]);
const decision = Schema.Literals(["release", "request_changes"]);
const nullableId = Schema.NullOr(planningId);
const projectFields = { projectId: planningId, expectedRevision: planningRevision };
const projectForm = { title: planningTitle, goal: planningBody };
const milestoneForm = { title: planningTitle, criteria: planningBody };
const ticketForm = {
  title: planningTitle,
  criteria: planningBody,
  notes: planningBody,
  milestoneId: nullableId,
  status,
};
const draftFields = {
  kind: Schema.Literal("save_draft"),
  draftId: nullableId,
  expectedDraftRevision: Schema.NullOr(planningRevision),
};
export const draftInputSchema = Schema.Union([
  Schema.Struct({
    target: Schema.Struct({
      kind: Schema.Literal("project"),
      id: nullableId,
      formId: Schema.optional(planningId),
    }).check(Schema.makeFilter((target) => target.id === null || target.formId === undefined)),
    form: Schema.Struct({ title: planningTitleText, goal: planningBody }),
  }),
  Schema.Struct({
    target: Schema.Struct({
      kind: Schema.Literal("milestone"),
      projectId: planningId,
      id: nullableId,
      formId: Schema.optional(planningId),
    }).check(Schema.makeFilter((target) => target.id === null || target.formId === undefined)),
    form: Schema.Struct({ title: planningTitleText, criteria: planningBody }),
  }),
  Schema.Struct({
    target: Schema.Struct({
      kind: Schema.Literal("ticket"),
      projectId: planningId,
      id: nullableId,
      formId: Schema.optional(planningId),
    }).check(Schema.makeFilter((target) => target.id === null || target.formId === undefined)),
    form: Schema.Struct({ ...ticketForm, title: planningTitleText }),
  }),
  Schema.Struct({
    target: Schema.Struct({ kind: Schema.Literal("review"), projectId: planningId, milestoneId: planningId }),
    form: Schema.Struct({ evidenceNote: planningBody }),
  }),
  Schema.Struct({
    target: Schema.Struct({
      kind: Schema.Literal("decision"),
      projectId: planningId,
      milestoneId: planningId,
      reviewId: planningId,
    }),
    form: Schema.Struct({ decision, rationale: planningBody }),
  }),
]);
const draftActions = draftInputSchema.members.map((member) => Schema.Struct({ ...draftFields, ...member.fields }));
export const planningActionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create_project"), ...projectForm }),
  Schema.Struct({ kind: Schema.Literal("edit_project"), ...projectFields, ...projectForm }),
  Schema.Struct({ kind: Schema.Literals(["archive_project", "restore_project"]), ...projectFields }),
  Schema.Struct({ kind: Schema.Literal("create_milestone"), ...projectFields, ...milestoneForm }),
  Schema.Struct({
    kind: Schema.Literal("edit_milestone"),
    ...projectFields,
    milestoneId: planningId,
    ...milestoneForm,
  }),
  Schema.Struct({ kind: Schema.Literal("create_ticket"), ...projectFields, ...ticketForm }),
  Schema.Struct({ kind: Schema.Literal("edit_ticket"), ...projectFields, ticketId: planningId, ...ticketForm }),
  Schema.Struct({
    kind: Schema.Literal("submit_review"),
    ...projectFields,
    milestoneId: planningId,
    evidenceNote: planningBody,
  }),
  Schema.Struct({
    kind: Schema.Literal("decide_review"),
    ...projectFields,
    milestoneId: planningId,
    reviewId: planningId,
    gateGeneration: planningRevision,
    criteriaRevision: planningRevision,
    decision,
    rationale: planningBody,
  }),
  ...draftActions,
  Schema.Struct({
    kind: Schema.Literal("discard_draft"),
    draftId: planningId,
    expectedDraftRevision: planningRevision,
  }),
]);
export const planningCommandSchema = Schema.Struct({
  operationId: planningId,
  action: planningActionSchema,
  consumedDraft: Schema.optional(Schema.Struct({ id: planningId, revision: planningRevision })),
});
export type LocalPlanningCommand = typeof planningCommandSchema.Type;
export type LocalPlanningAction = typeof planningActionSchema.Type;
const timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u),
  Schema.makeFilter(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(`${s.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === s.slice(0, 10),
  ),
);
const pageFields = {
  after: Schema.optional(Schema.Struct({ createdAt: timestamp, id: planningId })),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))),
};
export const pageRequestSchema = Schema.Struct(pageFields);
export const projectQuerySchema = Schema.Struct({
  ...pageFields,
  archive: Schema.optional(Schema.Literals(["active", "archived", "all"])),
});
export const projectPageSchema = Schema.Struct({ ...pageFields, projectId: planningId });
export const ticketQuerySchema = Schema.Struct({
  ...pageFields,
  projectId: planningId,
  milestoneId: Schema.optional(planningId),
  status: Schema.optional(status),
});
export const milestonePageSchema = Schema.Struct({ ...pageFields, projectId: planningId, milestoneId: planningId });
