import { Effect, Schema } from "effect";

export type PublicActivityKind = "capture" | "capture_sources" | "cua_runtime" | "remote_screen_runtime";
export interface PublicActivityLease {
  releaseVerified(): void;
  markUncertain(): void;
}
interface PublicActivity {
  kind: PublicActivityKind;
  uncertain: boolean;
}
export interface PrivatePlanningAdmissionOptions {
  checkQuiescent(): Effect.Effect<void, PrivatePlanningError>;
  /** Synchronous observation of the current registry, after all private deliveries are fenced. */
  privateRenderersDestroyed(): boolean;
}

export class PrivatePlanningError extends Schema.TaggedError<PrivatePlanningError>()("PrivatePlanningError", {
  code: Schema.Literal("privacy_busy"),
}) {}

const busy = () => new PrivatePlanningError({ code: "privacy_busy" });

/** Owns atomic exclusion of private exposure and app-mediated native viewing/control lifetimes. */
export class PrivatePlanningAdmission {
  readonly #options: PrivatePlanningAdmissionOptions;
  readonly #activities = new Map<string, PublicActivity>();
  #phase: "public" | "entering-private" | "private" = "public";
  #epoch = 0;

  constructor(options: PrivatePlanningAdmissionOptions) {
    this.#options = options;
  }

  snapshot() {
    return {
      phase: this.#phase,
      epoch: this.#epoch,
      activities: [...this.#activities].map(([id, value]) => ({ id, kind: value.kind, uncertain: value.uncertain })),
    };
  }

  readonly acquirePublic = Effect.fn("PrivatePlanningAdmission.acquirePublic")(function* (
    this: PrivatePlanningAdmission,
    id: string,
    kind: PublicActivityKind,
  ): Effect.fn.Return<PublicActivityLease, PrivatePlanningError> {
    if (this.#phase !== "public" || this.#activities.has(id)) return yield* busy();
    const activity: PublicActivity = { kind, uncertain: false };
    this.#activities.set(id, activity);
    return {
      releaseVerified: () => {
        if (this.#activities.get(id) === activity) this.#activities.delete(id);
      },
      markUncertain: () => {
        if (this.#activities.get(id) === activity) activity.uncertain = true;
      },
    };
  });

  readonly enterPrivate = Effect.fn("PrivatePlanningAdmission.enterPrivate")(function* (
    this: PrivatePlanningAdmission,
  ): Effect.fn.Return<void, PrivatePlanningError> {
    if (this.#phase === "private") return;
    if (this.#phase !== "public" || this.#activities.size > 0) return yield* busy();
    // Reserve before the first asynchronous inspection so public work cannot race the check.
    this.#phase = "entering-private";
    let committed = false;
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#options.checkQuiescent();
      this.#phase = "private";
      this.#epoch++;
      committed = true;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!committed) this.#phase = "public";
        }),
      ),
    );
  });

  readonly finishPrivateExit = Effect.fn("PrivatePlanningAdmission.finishPrivateExit")(function* (
    this: PrivatePlanningAdmission,
  ): Effect.fn.Return<void, PrivatePlanningError> {
    if (this.#phase === "public") return;
    if (this.#phase !== "private" || !this.#options.privateRenderersDestroyed()) return yield* busy();
    // No asynchronous step is allowed between the registry observation and releasing exclusion.
    this.#phase = "public";
  });
}
