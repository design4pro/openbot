import { randomUUID } from "node:crypto";
import type {
  MilestonePageQuery,
  PageRequest,
  PlanningAvailability,
  PlanningChange,
  PlanningCommand,
  PlanningExitConfirmation,
  PlanningPrepareExit,
  PlanningRequest,
  PlanningSession,
  PlanningSessionRef,
  ProjectPageQuery,
  ProjectQuery,
  TicketQuery,
} from "@openbot/contracts/ipc";
import { Deferred, Effect, Exit, Result } from "effect";
import type { LocalPlanningAuthority, LocalPlanningContext } from "../backend/local-planning/local-planning-authority";
import { LocalPlanningFailure } from "../backend/local-planning/local-planning-errors";
import type { LocalPlanningService } from "../backend/local-planning/local-planning-service";
import type { LocalPlanningWindows, PlanningRenderer, PlanningSender } from "./local-planning-windows";
import type { PrivatePlanningAdmission } from "./private-planning-admission";
import type { PrivatePlanningNative } from "./private-planning-native";

interface SessionEntry {
  contents: PlanningRenderer;
  context: LocalPlanningContext;
  session: PlanningSession;
  readable: boolean;
}
interface PendingExit {
  id: string;
  epoch: string;
  members: Set<PlanningRenderer>;
  acknowledged: Set<PlanningRenderer>;
  done: Deferred.Deferred<void, LocalPlanningFailure>;
  closing: boolean;
  deadline: ReturnType<typeof setTimeout> | null;
}
export interface LocalPlanningMainOptions {
  authority: LocalPlanningAuthority;
  domain: LocalPlanningService;
  windows: LocalPlanningWindows;
  admission: PrivatePlanningAdmission;
  native: PrivatePlanningNative;
  isLocal(): boolean;
  supported(): Effect.Effect<boolean>;
  prepareExit(contents: PlanningRenderer, value: PlanningPrepareExit): void;
  changed(contents: PlanningRenderer, value: PlanningChange): void;
}
const fail = (code: LocalPlanningFailure["code"]) => new LocalPlanningFailure({ code });
function boundaryFailure(cause: unknown): LocalPlanningFailure {
  return cause instanceof LocalPlanningFailure ? cause : fail("forbidden");
}

/** Owns main-issued sessions, response fencing and two-phase private exit. No Team API or account authority. */
export class LocalPlanningMainService {
  readonly #options: LocalPlanningMainOptions;
  readonly #sessions = new Map<PlanningRenderer, SessionEntry>();
  #generation = randomUUID();
  #privateEpoch: string | null = null;
  #exit: PendingExit | null = null;
  constructor(options: LocalPlanningMainOptions) {
    this.#options = options;
  }
  requireSender(event: PlanningSender): PlanningRenderer {
    return this.#options.windows.requireSender(event);
  }
  invalidateScopes(): void {
    this.#generation = randomUUID();
    for (const entry of this.#sessions.values()) entry.readable = false;
  }
  rendererGone(contents: PlanningRenderer): void {
    this.invalidateScopes();
    this.#sessions.delete(contents);
    this.#options.windows.unregisterMain(contents);
    if (!this.#exit?.closing) this.#abortExit();
  }
  readonly availability = Effect.fn("LocalPlanningMain.availability")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
  ): Effect.fn.Return<PlanningAvailability, LocalPlanningFailure> {
    const contents = yield* this.#sender(event);
    const privateEpoch = this.#sessions.get(contents)?.session.privateEpoch ?? null;
    if (!this.#options.isLocal() || !(yield* this.#options.supported()))
      return { ready: false, reason: "unavailable", blockers: [], privateEpoch };
    const blockers = this.#options.native.blockers();
    const transient = this.#options.admission
      .snapshot()
      .activities.filter((item) => item.kind === "capture" || item.kind === "capture_sources")
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        state: item.uncertain ? ("uncertain" as const) : ("active" as const),
      }));
    const busy = blockers.length > 0 || transient.length > 0;
    return { ready: !busy, reason: busy ? "privacy_busy" : null, blockers: [...blockers, ...transient], privateEpoch };
  });
  readonly enter = Effect.fn("LocalPlanningMain.enter")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
  ): Effect.fn.Return<PlanningSession, LocalPlanningFailure> {
    const contents = yield* this.#sender(event);
    if (!this.#options.isLocal() || !(yield* this.#options.supported())) return yield* fail("unavailable");
    if (this.#exit?.closing) return yield* fail("invalid_transition");
    this.#abortExit();
    const generation = this.#generation;
    const existing = this.#sessions.get(contents);
    const context =
      existing?.context ?? (yield* Effect.try({ try: () => this.#options.authority.issue(), catch: boundaryFailure }));
    yield* Effect.try({ try: () => this.#options.authority.resolve(context), catch: boundaryFailure });
    const startedPublic = this.#options.admission.snapshot().phase === "public";
    let enrolled = false;
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#options.admission.enterPrivate().pipe(Effect.mapError(() => fail("privacy_busy")));
      yield* this.#sender(event);
      if (generation !== this.#generation || !this.#options.isLocal()) return yield* fail("stale_scope");
      const owner = yield* Effect.try({ try: () => this.#options.authority.resolve(context), catch: boundaryFailure });
      const privateEpoch = this.#privateEpoch ?? randomUUID();
      const session: PlanningSession = {
        generation,
        privateEpoch,
        localScopeId: owner.localScopeId,
        windowDraftId: context.windowDraftId,
      };
      yield* Effect.try({ try: () => this.#options.windows.enroll(contents, privateEpoch), catch: boundaryFailure });
      this.#privateEpoch = privateEpoch;
      this.#sessions.set(contents, { contents, context, session, readable: true });
      enrolled = true;
      return session;
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => {
          if (!startedPublic || enrolled) return Effect.void;
          // The admission owner still verifies that no private WebContents remain before release.
          return this.#options.admission.finishPrivateExit().pipe(Effect.catch(() => Effect.void));
        }),
      ),
    );
  });
  readonly stopActivity = Effect.fn("LocalPlanningMain.stopActivity")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    input: { activityId: string },
  ) {
    yield* this.#sender(event);
    if (!this.#options.isLocal()) return yield* fail("unavailable");
    yield* this.#options.native.stopOwnedActivity(input.activityId).pipe(Effect.mapError(() => fail("privacy_busy")));
  });
  readonly leave = Effect.fn("LocalPlanningMain.leave")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    input: { privateEpoch: string },
  ) {
    yield* this.#epochEntry(event, input.privateEpoch);
    if (this.#exit?.closing) return yield* fail("invalid_transition");
    this.#abortExit();
    const members = new Set(
      [...this.#sessions.values()]
        .filter((entry) => entry.session.privateEpoch === input.privateEpoch && !entry.contents.isDestroyed())
        .map((entry) => entry.contents),
    );
    const exit: PendingExit = {
      id: randomUUID(),
      epoch: input.privateEpoch,
      members,
      acknowledged: new Set(),
      done: Deferred.makeUnsafe(),
      closing: false,
      deadline: null,
    };
    this.#exit = exit;
    exit.deadline = setTimeout(() => {
      if (this.#exit === exit && !exit.closing) this.#abortExit();
    }, 30000);
    exit.deadline.unref();
    for (const contents of members) this.#options.prepareExit(contents, { privateEpoch: exit.epoch, exitId: exit.id });
    return { exitId: exit.id };
  });
  readonly confirmExit = Effect.fn("LocalPlanningMain.confirmExit")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    input: PlanningExitConfirmation,
  ): Effect.fn.Return<void, LocalPlanningFailure> {
    const entry = yield* this.#epochEntry(event, input.privateEpoch);
    const exit = this.#exit;
    if (!exit || exit.id !== input.exitId || !exit.members.has(entry.contents))
      return yield* fail("invalid_transition");
    if (input.outcome === "blocked") {
      if (!exit.closing) this.#abortExit();
      return yield* fail("invalid_transition");
    }
    exit.acknowledged.add(entry.contents);
    if (!exit.closing && exit.acknowledged.size === exit.members.size) {
      exit.closing = true;
      if (exit.deadline) clearTimeout(exit.deadline);
      exit.deadline = null;
      this.invalidateScopes();
      const destroyed = yield* Effect.result(
        Effect.tryPromise({
          try: () => this.#options.windows.destroyPrivate(exit.epoch),
          catch: () => fail("privacy_busy"),
        }),
      );
      if (Result.isFailure(destroyed)) {
        this.#abortExit(destroyed.failure);
        return yield* destroyed.failure;
      }
      const released = yield* Effect.result(
        this.#options.admission.finishPrivateExit().pipe(Effect.mapError(() => fail("privacy_busy"))),
      );
      if (Result.isFailure(released)) {
        this.#abortExit(released.failure);
        return yield* released.failure;
      }
      this.#sessions.clear();
      this.#privateEpoch = null;
      this.#exit = null;
      Deferred.doneUnsafe(exit.done, Exit.void);
    }
    yield* Deferred.await(exit.done);
  });
  readonly listProjects = Effect.fn("LocalPlanningMain.listProjects")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<ProjectQuery>,
  ) {
    return yield* this.#withSession(event, request.session, (context) =>
      this.#options.domain.listProjects(context, request.input),
    );
  });
  readonly getProject = Effect.fn("LocalPlanningMain.getProject")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<string>,
  ) {
    return yield* this.#withSession(event, request.session, (context) =>
      this.#options.domain.getProject(context, request.input),
    );
  });
  readonly listMilestones = Effect.fn("LocalPlanningMain.listMilestones")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<ProjectPageQuery>,
  ) {
    return yield* this.#withSession(event, request.session, (context) =>
      this.#options.domain.listMilestones(context, request.input),
    );
  });
  readonly listTickets = Effect.fn("LocalPlanningMain.listTickets")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<TicketQuery>,
  ) {
    return yield* this.#withSession(event, request.session, (context) =>
      this.#options.domain.listTickets(context, request.input),
    );
  });
  readonly listReviews = Effect.fn("LocalPlanningMain.listReviews")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<MilestonePageQuery>,
  ) {
    return yield* this.#withSession(event, request.session, (context) =>
      this.#options.domain.listReviews(context, request.input),
    );
  });
  readonly getReview = Effect.fn("LocalPlanningMain.getReview")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<string>,
  ) {
    return yield* this.#withSession(event, request.session, (context) =>
      this.#options.domain.getReview(context, request.input),
    );
  });
  readonly listDrafts = Effect.fn("LocalPlanningMain.listDrafts")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<PageRequest>,
  ) {
    return yield* this.#withSession(event, request.session, (context) =>
      this.#options.domain.listDrafts(context, request.input),
    );
  });
  readonly run = Effect.fn("LocalPlanningMain.run")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    request: PlanningRequest<PlanningCommand>,
  ) {
    const value = yield* this.#withSession(event, request.session, (context) =>
      Effect.gen({ self: this }, function* () {
        const sender = this.#options.windows.requireSender(event);
        if (this.#exit && (request.input.action.kind !== "save_draft" || this.#exit.acknowledged.has(sender))) {
          this.#abortExit();
          return yield* fail("invalid_transition");
        }
        return yield* this.#options.domain.run(context, request.input);
      }),
    );
    if (request.session.generation === this.#generation && this.#options.isLocal()) {
      for (const entry of this.#sessions.values()) {
        if (!entry.readable || entry.session.generation !== this.#generation) continue;
        try {
          this.requireSender({ sender: entry.contents, senderFrame: entry.contents.mainFrame });
        } catch {
          continue;
        }
        this.#options.changed(entry.contents, {
          localScopeId: entry.session.localScopeId,
          generation: entry.session.generation,
          objectId: value.objectId,
          revision: value.revision,
        });
      }
    }
    return value;
  });
  readonly #sender = Effect.fn("LocalPlanningMain.sender")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
  ) {
    return yield* Effect.try({ try: () => this.requireSender(event), catch: boundaryFailure });
  });
  readonly #epochEntry = Effect.fn("LocalPlanningMain.epochEntry")(function* (
    this: LocalPlanningMainService,
    event: PlanningSender,
    epoch: string,
  ) {
    const contents = yield* this.#sender(event);
    const entry = this.#sessions.get(contents);
    if (!entry || epoch !== this.#privateEpoch || entry.session.privateEpoch !== epoch) return yield* fail("forbidden");
    return entry;
  });
  #session(event: PlanningSender, reference: PlanningSessionRef): SessionEntry {
    const contents = this.requireSender(event);
    const entry = this.#sessions.get(contents);
    if (!entry) throw fail("forbidden");
    if (
      !entry.readable ||
      reference.generation !== this.#generation ||
      reference.generation !== entry.session.generation
    )
      throw fail("stale_scope");
    if (!this.#options.isLocal() || this.#options.admission.snapshot().phase !== "private") throw fail("unavailable");
    return entry;
  }
  readonly #withSession = Effect.fn("LocalPlanningMain.withSession")(function* <A>(
    this: LocalPlanningMainService,
    event: PlanningSender,
    reference: PlanningSessionRef,
    operation: (context: LocalPlanningContext) => Effect.Effect<A, LocalPlanningFailure>,
  ) {
    const entry = yield* Effect.try({ try: () => this.#session(event, reference), catch: boundaryFailure });
    const value = yield* operation(entry.context);
    yield* Effect.try({ try: () => this.#session(event, reference), catch: boundaryFailure });
    return value;
  });
  #abortExit(reason: LocalPlanningFailure = fail("invalid_transition")): void {
    const exit = this.#exit;
    if (!exit) return;
    this.#exit = null;
    if (exit.deadline) clearTimeout(exit.deadline);
    Deferred.doneUnsafe(exit.done, Exit.fail(reason));
  }
}
