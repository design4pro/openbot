import { Schema } from "effect";
import type { DatabaseCore } from "./database-core";

const uuid = Schema.String.check(Schema.isUUID(4));
const profileIdentity = Schema.Struct({
  principalId: uuid,
  localScopeId: uuid,
  createdAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  initializedAt: Schema.String,
});
export type ProfileIdentity = Pick<typeof profileIdentity.Type, "principalId" | "localScopeId" | "createdAt">;

export class LocalProfileIdentityInvalid extends Schema.TaggedError<LocalProfileIdentityInvalid>()(
  "LocalProfileIdentityInvalid",
  { code: Schema.Literal("identity_invalid") },
) {}

/** Owns the durable profile principal read. Never creates or repairs a missing identity. */
export class LocalProfileIdentity {
  readonly #core: DatabaseCore;

  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  read(): ProfileIdentity {
    const row = this.#core.connection
      .prepare(`SELECT
      identity.principal_id AS principalId, identity.local_scope_id AS localScopeId,
      identity.created_at AS createdAt, bootstrap.initialized_at AS initializedAt
      FROM local_profile_identity identity JOIN local_profile_identity_bootstrap bootstrap
      ON identity.singleton=bootstrap.singleton WHERE identity.singleton=1`)
      .get();
    try {
      const decoded = Schema.decodeUnknownSync(profileIdentity)(row);
      if (decoded.principalId === decoded.localScopeId || decoded.createdAt !== decoded.initializedAt)
        throw new LocalProfileIdentityInvalid({ code: "identity_invalid" });
      return { principalId: decoded.principalId, localScopeId: decoded.localScopeId, createdAt: decoded.createdAt };
    } catch {
      throw new LocalProfileIdentityInvalid({ code: "identity_invalid" });
    }
  }
}
