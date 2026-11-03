import { Schema } from "effect";

export const planningErrorCode = Schema.Literals([
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
/** Private causes stay at the service boundary and never enter a local reply. */
export class LocalPlanningFailure extends Schema.TaggedError<LocalPlanningFailure>()("LocalPlanningFailure", {
  code: planningErrorCode,
  cause: Schema.optional(Schema.Defect()),
}) {}
export function planningFailure(code: typeof planningErrorCode.Type): never {
  throw new LocalPlanningFailure({ code });
}
