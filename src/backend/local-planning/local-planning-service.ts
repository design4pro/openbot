import type {
  MilestonePageQuery,
  PageRequest,
  PlanningCommand,
  ProjectPageQuery,
  ProjectQuery,
  TicketQuery,
} from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import type { LocalPlanningAuthority, LocalPlanningContext, LocalPlanningOwner } from "./local-planning-authority";
import { LocalPlanningCommands, type LocalPlanningCommandsOptions } from "./local-planning-commands";
import { LocalPlanningFailure } from "./local-planning-errors";
import {
  milestonePageSchema,
  pageRequestSchema,
  planningCommandSchema,
  planningId,
  projectPageSchema,
  projectQuerySchema,
  ticketQuerySchema,
} from "./local-planning-schemas";

/** Owns local domain authorization and validation. No account, provider, network or renderer dependency. */
export class LocalPlanningService {
  readonly #options: LocalPlanningCommandsOptions;
  readonly #commands: LocalPlanningCommands;
  readonly #authority: LocalPlanningAuthority;
  constructor(options: LocalPlanningCommandsOptions) {
    this.#options = options;
    this.#authority = options.authority;
    this.#commands = new LocalPlanningCommands(options);
  }
  readonly #read = Effect.fn("LocalPlanningService.read")(function* <A>(
    this: LocalPlanningService,
    context: LocalPlanningContext,
    operation: (owner: LocalPlanningOwner) => A,
  ) {
    return yield* Effect.try({ try: () => operation(this.#authority.resolve(context)), catch: toFailure });
  });
  readonly listProjects = Effect.fn("LocalPlanningService.listProjects")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    query: ProjectQuery,
  ) {
    const input = yield* decode(projectQuerySchema, query);
    return yield* this.#read(context, (owner) => this.#options.records.projects(owner, input));
  });
  readonly getProject = Effect.fn("LocalPlanningService.getProject")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    projectId: string,
  ) {
    const id = yield* decode(planningId, projectId);
    return yield* this.#read(context, (owner) => this.#options.records.project(owner, id));
  });
  readonly listMilestones = Effect.fn("LocalPlanningService.listMilestones")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    query: ProjectPageQuery,
  ) {
    const input = yield* decode(projectPageSchema, query);
    return yield* this.#read(context, (owner) => this.#options.records.milestones(owner, input));
  });
  readonly listTickets = Effect.fn("LocalPlanningService.listTickets")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    query: TicketQuery,
  ) {
    const input = yield* decode(ticketQuerySchema, query);
    return yield* this.#read(context, (owner) => this.#options.records.tickets(owner, input));
  });
  readonly listReviews = Effect.fn("LocalPlanningService.listReviews")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    query: MilestonePageQuery,
  ) {
    const input = yield* decode(milestonePageSchema, query);
    return yield* this.#read(context, (owner) => this.#options.records.reviews(owner, input));
  });
  readonly getReview = Effect.fn("LocalPlanningService.getReview")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    reviewId: string,
  ) {
    const id = yield* decode(planningId, reviewId);
    return yield* this.#read(context, (owner) => this.#options.records.review(owner, id));
  });
  readonly listDrafts = Effect.fn("LocalPlanningService.listDrafts")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    page: PageRequest,
  ) {
    const input = yield* decode(pageRequestSchema, page);
    return yield* this.#read(context, (owner) => this.#options.drafts.list(owner, input));
  });
  readonly run = Effect.fn("LocalPlanningService.run")(function* (
    this: LocalPlanningService,
    context: LocalPlanningContext,
    command: PlanningCommand,
  ) {
    const input = yield* decode(planningCommandSchema, command);
    return yield* Effect.try({ try: () => this.#commands.run(context, input), catch: toFailure });
  });
}
function toFailure(cause: unknown): LocalPlanningFailure {
  return cause instanceof LocalPlanningFailure ? cause : new LocalPlanningFailure({ code: "storage_failed", cause });
}
function decode<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new LocalPlanningFailure({ code: "invalid_input" })),
  );
}
