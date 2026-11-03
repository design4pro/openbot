import type { PlanningErrorCode, PlanningReply } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import type { LocalPlanningFailure } from "../../backend/local-planning/local-planning-errors";
import type { LocalPlanningMainService } from "../local-planning-service";
import { authorizedHandler, type IpcGroupHandlers } from "./define-ipc-group";
import * as inputs from "./local-planning-inputs";

const errorKeys = {
  unavailable: "error.backend.planningUnavailable",
  identity_invalid: "error.backend.planningIdentityInvalid",
  forbidden: "error.backend.planningForbidden",
  privacy_busy: "error.backend.planningPrivacyBusy",
  stale_scope: "error.backend.planningStaleScope",
  not_found: "error.backend.planningNotFound",
  revision_conflict: "error.backend.planningRevisionConflict",
  operation_conflict: "error.backend.planningOperationConflict",
  invalid_transition: "error.backend.planningInvalidTransition",
  invalid_input: "error.backend.planningInvalidInput",
  limit_reached: "error.backend.planningLimitReached",
  storage_failed: "error.backend.planningStorageFailed",
} as const;
function message(code: PlanningErrorCode): string {
  return sourceText(errorKeys[code]);
}
async function reply<A>(operation: Effect.Effect<A, LocalPlanningFailure>): Promise<PlanningReply<A>> {
  const result = await Effect.runPromise(Effect.result(operation));
  return Result.isSuccess(result)
    ? { ok: true, value: result.success }
    : { ok: false, error: { code: result.failure.code, message: message(result.failure.code) } };
}
export interface LocalPlanningIpcDependencies {
  localPlanning: LocalPlanningMainService;
}
export function localPlanningIpcHandlers({
  localPlanning,
}: LocalPlanningIpcDependencies): Pick<IpcGroupHandlers, "localPlanning"> {
  const authorize = (event: IpcMainInvokeEvent) => {
    localPlanning.requireSender(event);
  };
  return {
    localPlanning: {
      availability: authorizedHandler(authorize, inputs.parsePlanningEmpty, (event) =>
        reply(localPlanning.availability(event)),
      ),
      enter: authorizedHandler(authorize, inputs.parsePlanningEmpty, (event) => reply(localPlanning.enter(event))),
      leave: authorizedHandler(authorize, inputs.parsePlanningLeave, (event, input) =>
        reply(localPlanning.leave(event, input)),
      ),
      confirmExit: authorizedHandler(authorize, inputs.parsePlanningExit, (event, input) =>
        reply(localPlanning.confirmExit(event, input)),
      ),
      stopActivity: authorizedHandler(authorize, inputs.parsePlanningStop, (event, input) =>
        reply(localPlanning.stopActivity(event, input)),
      ),
      listProjects: authorizedHandler(authorize, inputs.parsePlanningProjects, (event, input) =>
        reply(localPlanning.listProjects(event, input)),
      ),
      getProject: authorizedHandler(authorize, inputs.parsePlanningId, (event, input) =>
        reply(localPlanning.getProject(event, input)),
      ),
      listMilestones: authorizedHandler(authorize, inputs.parsePlanningMilestones, (event, input) =>
        reply(localPlanning.listMilestones(event, input)),
      ),
      listTickets: authorizedHandler(authorize, inputs.parsePlanningTickets, (event, input) =>
        reply(localPlanning.listTickets(event, input)),
      ),
      listReviews: authorizedHandler(authorize, inputs.parsePlanningReviews, (event, input) =>
        reply(localPlanning.listReviews(event, input)),
      ),
      getReview: authorizedHandler(authorize, inputs.parsePlanningId, (event, input) =>
        reply(localPlanning.getReview(event, input)),
      ),
      listDrafts: authorizedHandler(authorize, inputs.parsePlanningDrafts, (event, input) =>
        reply(localPlanning.listDrafts(event, input)),
      ),
      run: authorizedHandler(authorize, inputs.parsePlanningRun, (event, input) =>
        reply(localPlanning.run(event, input)),
      ),
    },
  };
}
