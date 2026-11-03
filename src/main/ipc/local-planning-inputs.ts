import type { PlanningCommand, PlanningRequest } from "@openbot/contracts/ipc";
import { z } from "zod";

// Transport bounds and exact object shapes. Domain operations own business validation.
const id = z.string().max(128);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(65536);
const title = z.string().max(512);
const status = z.enum(["todo", "in_progress", "done"]);
const decision = z.enum(["release", "request_changes"]);
const projectFields = { projectId: id, expectedRevision: revision };
const projectForm = { title, goal: text };
const milestoneForm = { title, criteria: text };
const ticketForm = { title, criteria: text, notes: text, milestoneId: id.nullable(), status };
const draftFields = {
  kind: z.literal("save_draft"),
  draftId: id.nullable(),
  expectedDraftRevision: revision.nullable(),
};
const action = z.union([
  z.strictObject({ kind: z.literal("create_project"), ...projectForm }),
  z.strictObject({ kind: z.literal("edit_project"), ...projectFields, ...projectForm }),
  z.strictObject({ kind: z.enum(["archive_project", "restore_project"]), ...projectFields }),
  z.strictObject({ kind: z.literal("create_milestone"), ...projectFields, ...milestoneForm }),
  z.strictObject({ kind: z.literal("edit_milestone"), ...projectFields, milestoneId: id, ...milestoneForm }),
  z.strictObject({ kind: z.literal("create_ticket"), ...projectFields, ...ticketForm }),
  z.strictObject({ kind: z.literal("edit_ticket"), ...projectFields, ticketId: id, ...ticketForm }),
  z.strictObject({ kind: z.literal("submit_review"), ...projectFields, milestoneId: id, evidenceNote: text }),
  z.strictObject({
    kind: z.literal("decide_review"),
    ...projectFields,
    milestoneId: id,
    reviewId: id,
    gateGeneration: revision,
    criteriaRevision: revision,
    decision,
    rationale: text,
  }),
  z.strictObject({
    ...draftFields,
    target: z
      .strictObject({ kind: z.literal("project"), id: id.nullable(), formId: id.optional() })
      .refine((target) => target.id === null || target.formId === undefined),
    form: z.strictObject(projectForm),
  }),
  z.strictObject({
    ...draftFields,
    target: z
      .strictObject({ kind: z.literal("milestone"), projectId: id, id: id.nullable(), formId: id.optional() })
      .refine((target) => target.id === null || target.formId === undefined),
    form: z.strictObject(milestoneForm),
  }),
  z.strictObject({
    ...draftFields,
    target: z
      .strictObject({ kind: z.literal("ticket"), projectId: id, id: id.nullable(), formId: id.optional() })
      .refine((target) => target.id === null || target.formId === undefined),
    form: z.strictObject(ticketForm),
  }),
  z.strictObject({
    ...draftFields,
    target: z.strictObject({ kind: z.literal("review"), projectId: id, milestoneId: id }),
    form: z.strictObject({ evidenceNote: text }),
  }),
  z.strictObject({
    ...draftFields,
    target: z.strictObject({ kind: z.literal("decision"), projectId: id, milestoneId: id, reviewId: id }),
    form: z.strictObject({ decision, rationale: text }),
  }),
  z.strictObject({ kind: z.literal("discard_draft"), draftId: id, expectedDraftRevision: revision }),
]);
const command: z.ZodType<PlanningCommand> = z.strictObject({
  operationId: id,
  action,
  consumedDraft: z.strictObject({ id, revision }).optional(),
});
const pageFields = {
  after: z.strictObject({ createdAt: z.string().max(64), id }).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
const session = z.strictObject({ generation: id });
function parse<T>(schema: z.ZodType<T>): (value: unknown) => T {
  return (value) => {
    const result = schema.safeParse(value);
    if (!result.success) throw new Error("Invalid local planning input.");
    return result.data;
  };
}
function request<T>(schema: z.ZodType<T>): (value: unknown) => PlanningRequest<T> {
  return parse(z.strictObject({ session, input: schema }));
}
export const parsePlanningEmpty = parse(z.undefined());
export const parsePlanningLeave = parse(z.strictObject({ privateEpoch: id }));
export const parsePlanningExit = parse(
  z.strictObject({ privateEpoch: id, exitId: id, outcome: z.enum(["saved", "discarded", "blocked"]) }),
);
export const parsePlanningStop = parse(z.strictObject({ activityId: id }));
export const parsePlanningProjects = request(
  z.strictObject({ ...pageFields, archive: z.enum(["active", "archived", "all"]).optional() }),
);
export const parsePlanningId = request(id);
export const parsePlanningMilestones = request(z.strictObject({ ...pageFields, projectId: id }));
export const parsePlanningTickets = request(
  z.strictObject({ ...pageFields, projectId: id, milestoneId: id.optional(), status: status.optional() }),
);
export const parsePlanningReviews = request(z.strictObject({ ...pageFields, projectId: id, milestoneId: id }));
export const parsePlanningDrafts = request(z.strictObject(pageFields));
export const parsePlanningRun = request(command);
