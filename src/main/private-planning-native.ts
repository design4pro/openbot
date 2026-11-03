import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NativeBlocker } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import {
  type PrivatePlanningAdmission,
  PrivatePlanningError,
  type PublicActivityLease,
} from "./private-planning-admission";

const groupSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const journalSchema = Schema.Struct({
  version: Schema.Literal(1),
  bootId: Schema.Union([Schema.String.check(Schema.isUUID()), Schema.Literal("unsupported")]),
  groups: Schema.Array(groupSchema),
});
interface ChildObservation {
  child: ChildProcess;
  closed: Promise<void>;
}
interface OwnedActivity {
  id: string;
  kind: "cua_runtime" | "remote_screen_runtime";
  state: "starting" | "active" | "uncertain";
  lease: PublicActivityLease;
  stop: () => Effect.Effect<void, PrivatePlanningError>;
  children: ChildObservation[];
  groups: number[];
  bootId: string | null;
}
export interface PrivatePlanningNativeOptions {
  admission: PrivatePlanningAdmission;
  stateDirectory: string;
  /** Exact endpoint/config arguments identify older untracked native processes. */
  nativeArguments: () => readonly string[];
}
const busy = () => new PrivatePlanningError({ code: "privacy_busy" });
const nativeIO = <A>(operation: () => Promise<A>) => Effect.tryPromise({ try: operation, catch: busy });

/** Owns native lifetime leases and durable process-group evidence. Never treats a timeout as termination. */
export class PrivatePlanningNative {
  readonly #options: PrivatePlanningNativeOptions;
  readonly #activities = new Map<string, OwnedActivity>();
  constructor(options: PrivatePlanningNativeOptions) {
    this.#options = options;
  }

  privateActive(): boolean {
    return this.#options.admission.snapshot().phase !== "public";
  }

  blockers(): NativeBlocker[] {
    return [...this.#activities.values()].map(({ id, kind, state }) => ({ id, kind, state }));
  }
  readonly reserveStart = Effect.fn("PrivatePlanningNative.reserveStart")(function* (
    this: PrivatePlanningNative,
    kind: OwnedActivity["kind"],
  ) {
    return yield* this.#options.admission.acquirePublic(randomUUID(), kind);
  });

  readonly begin = Effect.fn("PrivatePlanningNative.begin")(function* (
    this: PrivatePlanningNative,
    id: string,
    kind: OwnedActivity["kind"],
    stop: OwnedActivity["stop"],
  ) {
    const existing = this.#activities.get(id);
    if (existing) {
      if (existing.state === "uncertain" && process.platform === "linux") return yield* busy();
      return;
    }
    const lease = yield* this.#options.admission.acquirePublic(id, kind);
    const activity: OwnedActivity = {
      id,
      kind,
      state: "starting",
      lease,
      stop,
      children: [],
      groups: [],
      bootId: null,
    };
    this.#activities.set(id, activity);
    // This marker is durable before the first spawn. A crash before its PID is saved is uncertain.
    yield* nativeIO(async () => {
      activity.bootId =
        process.platform === "linux" ? (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() : null;
      await this.#write(activity);
    }).pipe(Effect.onError(() => Effect.sync(() => this.uncertain(id))));
  });
  readonly track = Effect.fn("PrivatePlanningNative.track")(function* (
    this: PrivatePlanningNative,
    id: string,
    child: ChildProcess,
  ) {
    const activity = this.#activities.get(id);
    if (!activity) return yield* busy();
    let resolveClosed: () => void = () => {};
    const observation: ChildObservation = {
      child,
      closed: new Promise<void>((resolve) => {
        resolveClosed = resolve;
      }),
    };
    child.once("close", () => {
      resolveClosed();
    });
    activity.children.push(observation);
    if (child.pid !== undefined) activity.groups.push(child.pid);
    yield* nativeIO(() => this.#write(activity)).pipe(Effect.onError(() => Effect.sync(() => this.uncertain(id))));
  });
  active(id: string): void {
    const activity = this.#activities.get(id);
    if (activity && activity.state !== "uncertain") activity.state = "active";
  }
  uncertain(id: string): void {
    const activity = this.#activities.get(id);
    if (activity) {
      activity.state = "uncertain";
      activity.lease.markUncertain();
    }
  }
  readonly finish = Effect.fn("PrivatePlanningNative.finish")(function* (this: PrivatePlanningNative, id: string) {
    const activity = this.#activities.get(id);
    if (!activity) return;
    yield* nativeIO(async () => {
      // Child.close observes exit plus closed stdio. child.killed is deliberately not evidence.
      for (const observation of activity.children) {
        if (observation.child.exitCode === null && observation.child.signalCode === null && !observation.child.killed)
          throw busy();
        await observation.closed;
      }
      if (process.platform !== "linux") return;
      if (!activity.bootId) throw busy();
      await assertGroupsGone(activity.groups);
      await rm(this.#journal(id), { force: true });
    }).pipe(Effect.onError(() => Effect.sync(() => this.uncertain(id))));
    if (process.platform !== "linux") {
      this.uncertain(id);
      return;
    }
    if (this.#activities.get(id) === activity) {
      this.#activities.delete(id);
      activity.lease.releaseVerified();
    }
  });
  readonly stopOwnedActivity = Effect.fn("PrivatePlanningNative.stopOwnedActivity")(function* (
    this: PrivatePlanningNative,
    id: string,
  ) {
    const activity = this.#activities.get(id);
    if (!activity) return yield* busy();
    yield* activity.stop().pipe(Effect.onError(() => Effect.sync(() => this.uncertain(id))));
    if (this.#activities.has(id)) return yield* busy();
  });
  readonly checkQuiescent = Effect.fn("PrivatePlanningNative.checkQuiescent")(function* (this: PrivatePlanningNative) {
    if (this.#activities.size > 0 || process.platform !== "linux") return yield* busy();
    yield* nativeIO(async () => {
      const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      await mkdir(this.#options.stateDirectory, { recursive: true, mode: 0o700 });
      for (const name of await readdir(this.#options.stateDirectory)) {
        if (!/^[0-9a-f-]{36}\.json$/u.test(name)) throw busy();
        const path = join(this.#options.stateDirectory, name);
        const journal = Schema.decodeUnknownSync(journalSchema)(JSON.parse(await readFile(path, "utf8")));
        if (journal.bootId === bootId) {
          if (journal.groups.length === 0) throw busy();
          await assertGroupsGone(journal.groups);
        }
        await rm(path);
      }
      // Older processes without a journal cannot be adopted or silently declared stopped.
      const argumentsToFind = this.#options.nativeArguments();
      for (const pid of await processIds()) {
        const args = await readProc(pid, "cmdline");
        if (
          args?.split("\0").some((arg) => argumentsToFind.some((value) => arg === value || arg.startsWith(`${value}/`)))
        )
          throw busy();
      }
    });
  });
  #journal(id: string): string {
    return join(this.#options.stateDirectory, `${id}.json`);
  }
  async #write(activity: OwnedActivity): Promise<void> {
    await mkdir(this.#options.stateDirectory, { recursive: true, mode: 0o700 });
    const temporary = join(this.#options.stateDirectory, `${randomUUID()}.tmp`);
    await writeFile(
      temporary,
      JSON.stringify({ version: 1, bootId: activity.bootId ?? "unsupported", groups: activity.groups }),
      { mode: 0o600 },
    );
    await rename(temporary, this.#journal(activity.id));
  }
}
async function processIds(): Promise<string[]> {
  return (await readdir("/proc")).filter((value) => /^\d+$/u.test(value));
}
async function readProc(pid: string, name: string): Promise<string | null> {
  try {
    return await readFile(`/proc/${pid}/${name}`, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw busy();
  }
}
async function assertGroupsGone(groups: readonly number[]): Promise<void> {
  for (const group of groups) {
    try {
      process.kill(-group, 0);
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") continue;
      throw busy();
    }
    // The kernel checks the whole group atomically. A /proc snapshot can miss a newly forked child.
    throw busy();
  }
}
