import { randomUUID } from "node:crypto";
import type { LocalProfileIdentity, ProfileIdentity } from "../database/local-profile-identity";
import { LocalProfileIdentityInvalid } from "../database/local-profile-identity";
import { LocalPlanningFailure, planningFailure } from "./local-planning-errors";

export interface LocalPlanningContext {
  readonly windowDraftId: string;
}
export type LocalPlanningOwner = ProfileIdentity & { windowDraftId: string };
/** Owns process-local authority. Object contents and serialized copies confer no access. */
export class LocalPlanningAuthority {
  readonly #identity: LocalProfileIdentity;
  readonly #contexts = new WeakMap<LocalPlanningContext, LocalPlanningOwner>();
  constructor(identity: LocalProfileIdentity) {
    this.#identity = identity;
  }
  issue(): LocalPlanningContext {
    const owner = this.#read();
    const context = Object.freeze({ windowDraftId: randomUUID() });
    this.#contexts.set(context, { ...owner, windowDraftId: context.windowDraftId });
    return context;
  }
  resolve(context: LocalPlanningContext): LocalPlanningOwner {
    const owner = this.#contexts.get(context);
    if (!owner) planningFailure("forbidden");
    const current = this.#read();
    if (owner.principalId !== current.principalId || owner.localScopeId !== current.localScopeId)
      planningFailure("forbidden");
    return owner;
  }
  #read(): ProfileIdentity {
    try {
      return this.#identity.read();
    } catch (cause) {
      if (cause instanceof LocalProfileIdentityInvalid) throw new LocalPlanningFailure({ code: "identity_invalid" });
      throw new LocalPlanningFailure({ code: "storage_failed", cause });
    }
  }
}
