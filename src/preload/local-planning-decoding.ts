import type { PlanningReply } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { z } from "zod";

const id = z.string().uuid();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const generation = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const date = z.iso.datetime({ offset: true });
const title = z
  .string()
  .max(512)
  .refine((value) => [...value].length <= 256 && !/[\uD800-\uDFFF]/u.test(value));
const body = z
  .string()
  .max(65536)
  .refine((value) => [...value].length <= 32768 && !/[\uD800-\uDFFF]/u.test(value));
const status = z.enum(["todo", "in_progress", "done"]);
const decision = z.enum(["release", "request_changes"]);
const errorCode = z.enum([
  "unavailable",
  "identity_invalid",
  "forbidden",
  "privacy_busy",
  "stale_scope",
  "not_found",
  "revision_conflict",
  "operation_conflict",
  "invalid_transition",
  "invalid_input",
  "limit_reached",
  "storage_failed",
]);
const errorSchema = z.strictObject({ code: errorCode, message: z.string().max(1024) });
const sessionSchema = z.strictObject({ generation: id, localScopeId: id, windowDraftId: id, privateEpoch: id });
const projectSchema = z.strictObject({
  id,
  title,
  goal: body,
  revision,
  archivedAt: date.nullable(),
  createdAt: date,
  updatedAt: date,
});
const milestoneSchema = z.strictObject({
  id,
  projectId: id,
  title,
  criteria: body,
  criteriaRevision: revision,
  revision,
  gateState: z.enum(["open", "in_review", "released", "changes_requested"]),
  gateGeneration: generation,
  currentReviewId: id.nullable(),
  createdAt: date,
  updatedAt: date,
});
const ticketSchema = z.strictObject({
  id,
  projectId: id,
  milestoneId: id.nullable(),
  title,
  criteria: body,
  notes: body,
  status,
  revision,
  createdAt: date,
  updatedAt: date,
});
const reviewSchema = z.strictObject({
  id,
  projectId: id,
  milestoneId: id,
  criteriaSnapshot: body,
  criteriaRevision: revision,
  gateGeneration: revision,
  evidenceNote: body,
  submitterPrincipalId: id,
  createdAt: date,
});
const decisionSchema = z.strictObject({
  id,
  reviewId: id,
  principalId: id,
  decision,
  rationale: body,
  commandId: z.string().max(256),
  createdAt: date,
});
const draftFields = { id, windowDraftId: id, revision, updatedAt: date };
const draftSchema = z.union([
  z.strictObject({
    ...draftFields,
    target: z
      .strictObject({ kind: z.literal("project"), id: id.nullable(), formId: id.optional() })
      .refine((target) => target.id === null || target.formId === undefined),
    form: z.strictObject({ title, goal: body }),
  }),
  z.strictObject({
    ...draftFields,
    target: z
      .strictObject({ kind: z.literal("milestone"), projectId: id, id: id.nullable(), formId: id.optional() })
      .refine((target) => target.id === null || target.formId === undefined),
    form: z.strictObject({ title, criteria: body }),
  }),
  z.strictObject({
    ...draftFields,
    target: z
      .strictObject({ kind: z.literal("ticket"), projectId: id, id: id.nullable(), formId: id.optional() })
      .refine((target) => target.id === null || target.formId === undefined),
    form: z.strictObject({ title, criteria: body, notes: body, milestoneId: id.nullable(), status }),
  }),
  z.strictObject({
    ...draftFields,
    target: z.strictObject({ kind: z.literal("review"), projectId: id, milestoneId: id }),
    form: z.strictObject({ evidenceNote: body }),
  }),
  z.strictObject({
    ...draftFields,
    target: z.strictObject({ kind: z.literal("decision"), projectId: id, milestoneId: id, reviewId: id }),
    form: z.strictObject({ decision, rationale: body }),
  }),
]);
const blocker = z.strictObject({
  id: z.string().max(256),
  kind: z.enum(["cua_runtime", "remote_screen_runtime", "capture", "capture_sources"]),
  state: z.enum(["starting", "active", "uncertain"]),
});
const cursor = z.strictObject({ createdAt: date, id });
const page = <T>(schema: z.ZodType<T>) => z.strictObject({ items: z.array(schema).max(100), next: cursor.nullable() });
function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Invalid local planning reply.");
  return result.data;
}
function reply<T>(schema: z.ZodType<T>): (value: unknown) => PlanningReply<T> {
  return (value) => {
    if (!isDynamicRecord(value)) throw new Error("Invalid local planning reply.");
    if (
      value.ok === true &&
      Object.hasOwn(value, "value") &&
      Object.keys(value).every((key) => key === "ok" || key === "value")
    )
      return { ok: true, value: decode(schema, value.value) };
    if (value.ok === false && Object.keys(value).every((key) => key === "ok" || key === "error"))
      return { ok: false, error: decode(errorSchema, value.error) };
    throw new Error("Invalid local planning reply.");
  };
}
export const decodePlanningSessionReply = reply(sessionSchema);
export const decodePlanningProjectReply = reply(projectSchema);
export const decodePlanningProjectsReply = reply(page(projectSchema));
export const decodePlanningMilestonesReply = reply(page(milestoneSchema));
export const decodePlanningTicketsReply = reply(page(ticketSchema));
export const decodePlanningReviewsReply = reply(page(reviewSchema));
export const decodePlanningReviewReply = reply(
  z.strictObject({ review: reviewSchema, decision: decisionSchema.nullable() }),
);
export const decodePlanningDraftsReply = reply(page(draftSchema));
export const decodePlanningCommandReply = reply(z.strictObject({ objectId: id, revision, projectId: id.nullable() }));
export const decodePlanningVoidReply = reply(z.undefined());
export const decodePlanningLeaveReply = reply(z.strictObject({ exitId: id }));
export const decodePlanningAvailabilityReply = reply(
  z.strictObject({
    ready: z.boolean(),
    reason: errorCode.nullable(),
    blockers: z.array(blocker).max(128),
    privateEpoch: id.nullable(),
  }),
);
export const decodePlanningChange = (value: unknown) =>
  decode(z.strictObject({ localScopeId: id, generation: id, objectId: id, revision }), value);
export const decodePlanningPrepareExit = (value: unknown) =>
  decode(z.strictObject({ privateEpoch: id, exitId: id }), value);
