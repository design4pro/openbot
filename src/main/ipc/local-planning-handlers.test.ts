// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LocalPlanningWindows } from "../local-planning-windows";
import { RemoteServerStore } from "../remote-server-store";
import { parsePlanningRun } from "./local-planning-inputs";

function renderer(id: number) {
  const state = { destroyed: false };
  const contents = {
    id,
    mainFrame: { processId: id + 100, routingId: id + 200, url: "openbot-app://app/index.html" },
    isDestroyed: () => state.destroyed,
  };
  return { contents, state, event: () => ({ sender: contents, senderFrame: contents.mainFrame }) };
}
function registry() {
  return new LocalPlanningWindows({
    replace: async (contents) => {
      for (const item of contents) {
        const known = registered.find((value) => value.contents === item);
        if (known) known.state.destroyed = true;
      }
    },
  });
}
const registered: Array<ReturnType<typeof renderer>> = [];

describe("local planning sender and private renderer boundary", () => {
  it("bounds create-form discriminators and rejects them on an existing-object draft", () => {
    const id = "98f1c8ad-1d80-4b8b-8b26-04bdfb99e49a";
    const payload = {
      session: { generation: id },
      input: {
        operationId: id,
        action: {
          kind: "save_draft",
          draftId: null,
          expectedDraftRevision: null,
          target: { kind: "project", id: null, formId: id },
          form: { title: "Draft", goal: "" },
        },
      },
    };
    expect(parsePlanningRun(payload)).toEqual(payload);
    for (const target of [
      { ...payload.input.action.target, id },
      { ...payload.input.action.target, formId: "x".repeat(100000) },
    ])
      expect(() =>
        parsePlanningRun({ ...payload, input: { ...payload.input, action: { ...payload.input.action, target } } }),
      ).toThrow();
  });
  it("withdraws an observed destroyed renderer without reading destroyed native properties", () => {
    const windows = registry();
    const main = renderer(901);
    windows.registerMain(main.contents);
    windows.enroll(main.contents, "destroyed-native-properties");
    main.state.destroyed = true;
    Object.defineProperty(main.contents, "id", {
      get: () => {
        throw new Error("Object has been destroyed");
      },
    });
    expect(() => windows.mainNavigated(main.contents)).not.toThrow();
    expect(() => windows.unregisterMain(main.contents)).not.toThrow();
    expect(windows.privateRenderersDestroyed()).toBe(true);
  });

  it("rejects an auxiliary sender before its decoder or domain read runs", () => {
    const windows = registry();
    const main = renderer(1);
    const auxiliary = renderer(2);
    windows.registerMain(main.contents);
    const calls = { decoded: 0, read: 0 };
    const invoke = () => {
      windows.requireSender(auxiliary.event());
      calls.decoded++;
      calls.read++;
    };
    expect(invoke).toThrow();
    expect(calls).toEqual({ decoded: 0, read: 0 });
  });
  it("accepts only the registered live top frame and exact WebContents", () => {
    const windows = registry();
    const main = renderer(3);
    windows.registerMain(main.contents);
    expect(windows.requireSender(main.event())).toBe(main.contents);
    expect(() =>
      windows.requireSender({ sender: main.contents, senderFrame: { ...main.contents.mainFrame, routingId: 999 } }),
    ).toThrow();
    expect(() => windows.requireSender({ ...main.event(), sender: { ...main.contents } })).toThrow();
    main.state.destroyed = true;
    expect(() => windows.requireSender(main.event())).toThrow();
  });
  it("keeps a private replacement frame unauthorized", () => {
    const windows = registry();
    const main = renderer(4);
    windows.registerMain(main.contents);
    windows.enroll(main.contents, "epoch-one");
    main.contents.mainFrame = { ...main.contents.mainFrame, processId: 500 };
    expect(() => windows.requireSender(main.event())).toThrow();
    expect(windows.privateRenderersDestroyed()).toBe(false);
  });
  it("renews only a main-observed trusted document while retaining private exclusion", async () => {
    const windows = registry();
    const main = renderer(904);
    registered.push(main);
    windows.registerMain(main.contents);
    windows.enroll(main.contents, "reload-epoch");
    const oldFrame = main.contents.mainFrame;
    main.contents.mainFrame = { ...oldFrame, processId: 1904, routingId: 2904 };
    expect(() => windows.requireSender(main.event())).toThrow();
    windows.mainNavigated(main.contents);
    expect(windows.requireSender(main.event())).toBe(main.contents);
    expect(() => windows.requireSender({ sender: main.contents, senderFrame: oldFrame })).toThrow();
    expect(windows.privateRenderersDestroyed()).toBe(false);
    await windows.destroyPrivate("reload-epoch");
    expect(main.state.destroyed).toBe(true);
  });
  it("does not renew an unregistered, destroyed or untrusted document", () => {
    const windows = registry();
    const main = renderer(905);
    windows.registerMain(main.contents);
    windows.enroll(main.contents, "reload-refusal");
    main.contents.mainFrame = { ...main.contents.mainFrame, url: "https://example.test/" };
    windows.mainNavigated(main.contents);
    expect(() => windows.requireSender(main.event())).toThrow();
    main.contents.mainFrame.url = "openbot-app://app/index.html";
    windows.unregisterMain(main.contents);
    windows.mainNavigated(main.contents);
    expect(() => windows.requireSender(main.event())).toThrow();
    expect(windows.privateRenderersDestroyed()).toBe(false);
  });
  it("rejects a changed renderer process even when its frame object is retained", () => {
    const windows = registry();
    const main = renderer(9);
    windows.registerMain(main.contents);
    windows.enroll(main.contents, "epoch-retained");
    main.contents.mainFrame.processId = 999;
    expect(() => windows.requireSender(main.event())).toThrow();
  });
  it("retains hidden and unregistered private contents until actual destruction", () => {
    const windows = registry();
    const main = renderer(5);
    windows.registerMain(main.contents);
    windows.enroll(main.contents, "epoch-two");
    windows.unregisterMain(main.contents);
    expect(windows.privateRenderersDestroyed()).toBe(false);
    main.state.destroyed = true;
    expect(windows.privateRenderersDestroyed()).toBe(true);
  });
  it("verifies all enrolled renderers before it releases exclusion", async () => {
    const windows = registry();
    const first = renderer(6);
    const second = renderer(7);
    registered.push(first, second);
    windows.registerMain(first.contents);
    windows.registerMain(second.contents);
    windows.enroll(first.contents, "epoch-three");
    windows.enroll(second.contents, "epoch-three");
    expect(windows.privateRenderersDestroyed()).toBe(false);
    await windows.destroyPrivate("epoch-three");
    expect(first.state.destroyed).toBe(true);
    expect(second.state.destroyed).toBe(true);
    expect(windows.privateRenderersDestroyed()).toBe(true);
  });
  it("refuses to treat a failed replacement or a still-live renderer as destruction", async () => {
    const windows = new LocalPlanningWindows({ replace: async () => {} });
    const main = renderer(8);
    windows.registerMain(main.contents);
    windows.enroll(main.contents, "epoch-four");
    await expect(windows.destroyPrivate("epoch-four")).rejects.toThrow();
    expect(windows.privateRenderersDestroyed()).toBe(false);
  });
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Result } from "effect";
import { afterEach, beforeEach, vi } from "vitest";
import { LocalPlanningAuthority } from "../../backend/local-planning/local-planning-authority";
import { LocalPlanningService } from "../../backend/local-planning/local-planning-service";
import { OpenBotDatabase } from "../../backend/openbot-database";
import { LocalPlanningMainService } from "../local-planning-service";
import { PrivatePlanningAdmission, PrivatePlanningError } from "../private-planning-admission";
import { PrivatePlanningNative } from "../private-planning-native";

async function mainFixture() {
  const root = await mkdtemp(join(tmpdir(), "planning-boundary-"));
  const database = new OpenBotDatabase(root);
  await Effect.runPromise(database.initialize());
  const first = renderer(101);
  const second = renderer(102);
  const trace: string[] = [];
  const windows = new LocalPlanningWindows({
    replace: async (contents) => {
      for (const item of contents) {
        const known = [first, second].find((value) => value.contents === item);
        if (known) {
          known.state.destroyed = true;
          trace.push(`destroyed:${item.id}`);
        }
      }
    },
  });
  windows.registerMain(first.contents);
  windows.registerMain(second.contents);
  const admission = new PrivatePlanningAdmission({
    checkQuiescent: () => Effect.void,
    privateRenderersDestroyed: () => windows.privateRenderersDestroyed(),
  });
  const native = new PrivatePlanningNative({
    admission,
    stateDirectory: join(root, "native"),
    nativeArguments: () => [],
  });
  const authority = new LocalPlanningAuthority(database.localIdentity);
  const domain = new LocalPlanningService({
    authority,
    records: database.localPlanningRecords,
    drafts: database.localPlanningDrafts,
  });
  const host = { local: true };
  const prepared: Array<{ id: number; privateEpoch: string; exitId: string }> = [];
  const main = new LocalPlanningMainService({
    authority,
    domain,
    windows,
    admission,
    native,
    isLocal: () => host.local,
    supported: () => Effect.succeed(true),
    prepareExit: (contents, value) => prepared.push({ id: contents.id, ...value }),
    changed: () => {},
  });
  return { root, database, first, second, trace, windows, admission, native, authority, domain, host, prepared, main };
}
type MainFixture = Awaited<ReturnType<typeof mainFixture>>;
let fixture: MainFixture;
beforeEach(async () => {
  fixture = await mainFixture();
});
afterEach(async () => {
  fixture.main.rendererGone(fixture.first.contents);
  fixture.main.rendererGone(fixture.second.contents);
  fixture.database.close();
  await rm(fixture.root, { recursive: true, force: true });
});
async function failure<A>(operation: Effect.Effect<A, { code: string }>, code: string) {
  const result = await Effect.runPromise(Effect.result(operation));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.code).toBe(code);
}

describe("main-only planning session and exit boundary", () => {
  it("aborts an exit with a missing acknowledgement without releasing private input", async () => {
    vi.useFakeTimers();
    try {
      const session = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
      await Effect.runPromise(fixture.main.enter(fixture.second.event()));
      const exit = await Effect.runPromise(
        fixture.main.leave(fixture.first.event(), { privateEpoch: session.privateEpoch }),
      );
      const pending = Effect.runPromise(
        Effect.result(
          fixture.main.confirmExit(fixture.first.event(), {
            privateEpoch: session.privateEpoch,
            exitId: exit.exitId,
            outcome: "saved",
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(30000);
      const result = await pending;
      expect(Result.isFailure(result)).toBe(true);
      expect(fixture.admission.snapshot().phase).toBe("private");
      expect(fixture.first.state.destroyed).toBe(false);
      const next = await Effect.runPromise(
        fixture.main.leave(fixture.first.event(), { privateEpoch: session.privateEpoch }),
      );
      expect(next.exitId).not.toBe(exit.exitId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences automatic adoption and rollback before the selected host changes", async () => {
    let session = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    const observed: string[] = [];
    const store = new RemoteServerStore({
      path: join(fixture.root, "servers.json"),
      cipher: { encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString() },
      onSelectionStarted: () => {
        observed.push(store.activeServerId);
        fixture.main.invalidateScopes();
      },
    });
    const previous = store.selection;
    const remoteId = randomUUID();
    await Effect.runPromise(
      store.adopt({
        id: remoteId,
        name: "Fixture",
        apiUrl: "http://127.0.0.1:12345",
        fingerprint: "fixture",
        username: "fixture",
        encryptedToken: "Zml4dHVyZQ==",
        remoteDesktopAvailable: false,
        role: "member",
      }),
    );
    await failure(
      fixture.main.listProjects(fixture.first.event(), { session: { generation: session.generation }, input: {} }),
      "stale_scope",
    );
    expect(observed).toEqual(["local"]);
    session = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    store.restoreSelection(previous);
    await failure(
      fixture.main.listProjects(fixture.first.event(), { session: { generation: session.generation }, input: {} }),
      "stale_scope",
    );
    expect(observed).toEqual(["local", remoteId]);
  });

  it("binds separate draft IDs to two enrolled windows in the same private epoch", async () => {
    const first = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    const second = await Effect.runPromise(fixture.main.enter(fixture.second.event()));
    expect(first.privateEpoch).toBe(second.privateEpoch);
    expect(first.windowDraftId).not.toBe(second.windowDraftId);
    expect(fixture.admission.snapshot().phase).toBe("private");
  });
  it("fences a local-remote-local generation while keeping profile and window identity", async () => {
    const initial = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    fixture.main.invalidateScopes();
    fixture.host.local = false;
    await failure(fixture.main.listProjects(fixture.first.event(), { session: initial, input: {} }), "stale_scope");
    fixture.host.local = true;
    const next = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    expect(next.generation).not.toBe(initial.generation);
    expect(next.localScopeId).toBe(initial.localScopeId);
    expect(next.windowDraftId).toBe(initial.windowDraftId);
  });
  it("checks generation again before a delayed private result can leave main", async () => {
    const session = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    const created = await Effect.runPromise(
      fixture.main.run(fixture.first.event(), {
        session,
        input: { operationId: randomUUID(), action: { kind: "create_project", title: "Canary", goal: "" } },
      }),
    );
    const read = fixture.domain.getProject.bind(fixture.domain);
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    vi.spyOn(fixture.domain, "getProject").mockImplementation((context, id) =>
      Effect.gen(function* () {
        const value = yield* read(context, id);
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        return value;
      }),
    );
    const response = Effect.runPromise(
      Effect.result(fixture.main.getProject(fixture.first.event(), { session, input: created.objectId })),
    );
    await Effect.runPromise(Deferred.await(started));
    fixture.main.invalidateScopes();
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const result = await response;
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe("stale_scope");
  });
  it("holds exclusion until both windows confirm and both renderers are destroyed", async () => {
    const first = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    await Effect.runPromise(fixture.main.enter(fixture.second.event()));
    const exit = await Effect.runPromise(
      fixture.main.leave(fixture.first.event(), { privateEpoch: first.privateEpoch }),
    );
    expect(fixture.prepared).toHaveLength(2);
    expect(fixture.first.state.destroyed).toBe(false);
    await Promise.all([
      Effect.runPromise(
        fixture.main.confirmExit(fixture.first.event(), {
          privateEpoch: first.privateEpoch,
          exitId: exit.exitId,
          outcome: "saved",
        }),
      ),
      Effect.runPromise(
        fixture.main.confirmExit(fixture.second.event(), {
          privateEpoch: first.privateEpoch,
          exitId: exit.exitId,
          outcome: "saved",
        }),
      ),
    ]);
    expect(fixture.windows.privateRenderersDestroyed()).toBe(true);
    const lease = await Effect.runPromise(fixture.admission.acquirePublic(randomUUID(), "capture"));
    fixture.trace.push("public");
    lease.releaseVerified();
    expect(fixture.trace.slice(0, 2)).toEqual(["destroyed:101", "destroyed:102"]);
    expect(fixture.trace[2]).toBe("public");
  });
  it("aborts a blocked exit without destroying private input and requires a fresh exit ID", async () => {
    const session = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    const first = await Effect.runPromise(
      fixture.main.leave(fixture.first.event(), { privateEpoch: session.privateEpoch }),
    );
    await failure(
      fixture.main.confirmExit(fixture.first.event(), {
        privateEpoch: session.privateEpoch,
        exitId: first.exitId,
        outcome: "blocked",
      }),
      "invalid_transition",
    );
    expect(fixture.first.state.destroyed).toBe(false);
    expect(fixture.admission.snapshot().phase).toBe("private");
    const next = await Effect.runPromise(
      fixture.main.leave(fixture.first.event(), { privateEpoch: session.privateEpoch }),
    );
    expect(next.exitId).not.toBe(first.exitId);
  });
  it("rejects a project mutation during exit and preserves private exclusion", async () => {
    const session = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    await Effect.runPromise(fixture.main.leave(fixture.first.event(), { privateEpoch: session.privateEpoch }));
    await failure(
      fixture.main.run(fixture.first.event(), {
        session,
        input: { operationId: randomUUID(), action: { kind: "create_project", title: "Late edit", goal: "" } },
      }),
      "invalid_transition",
    );
    expect(
      fixture.database.connection.prepare("SELECT COUNT(*) AS count FROM projection_local_projects").get()?.count,
    ).toBe(0);
    expect(fixture.admission.snapshot().phase).toBe("private");
  });
  it("does not abort coordinated exit when actual destruction reports rendererGone", async () => {
    const first = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    await Effect.runPromise(fixture.main.enter(fixture.second.event()));
    vi.spyOn(fixture.windows, "destroyPrivate").mockImplementation(async () => {
      for (const item of [fixture.first, fixture.second]) {
        item.state.destroyed = true;
        fixture.main.rendererGone(item.contents);
      }
    });
    const exit = await Effect.runPromise(
      fixture.main.leave(fixture.first.event(), { privateEpoch: first.privateEpoch }),
    );
    const replies = await Promise.all([
      Effect.runPromise(
        Effect.result(
          fixture.main.confirmExit(fixture.first.event(), {
            privateEpoch: first.privateEpoch,
            exitId: exit.exitId,
            outcome: "saved",
          }),
        ),
      ),
      Effect.runPromise(
        Effect.result(
          fixture.main.confirmExit(fixture.second.event(), {
            privateEpoch: first.privateEpoch,
            exitId: exit.exitId,
            outcome: "saved",
          }),
        ),
      ),
    ]);
    expect(replies.every(Result.isSuccess)).toBe(true);
    expect(fixture.admission.snapshot().phase).toBe("public");
  });
  it("settles every exit waiter when the final admission check fails", async () => {
    const first = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    await Effect.runPromise(fixture.main.enter(fixture.second.event()));
    vi.spyOn(fixture.admission, "finishPrivateExit").mockImplementation(() =>
      Effect.fail(new PrivatePlanningError({ code: "privacy_busy" })),
    );
    const exit = await Effect.runPromise(
      fixture.main.leave(fixture.first.event(), { privateEpoch: first.privateEpoch }),
    );
    const replies = await Promise.all([
      Effect.runPromise(
        Effect.result(
          fixture.main.confirmExit(fixture.first.event(), {
            privateEpoch: first.privateEpoch,
            exitId: exit.exitId,
            outcome: "saved",
          }),
        ),
      ),
      Effect.runPromise(
        Effect.result(
          fixture.main.confirmExit(fixture.second.event(), {
            privateEpoch: first.privateEpoch,
            exitId: exit.exitId,
            outcome: "saved",
          }),
        ),
      ),
    ]);
    expect(replies.every(Result.isFailure)).toBe(true);
    expect(fixture.admission.snapshot().phase).toBe("private");
  });
});

const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown) =>
      registrations.set(channel, listener),
  },
}));

import { IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { registerIpcGroup } from "./define-ipc-group";
import { localPlanningIpcHandlers } from "./local-planning-handlers";

describe("registered local planning IPC boundary", () => {
  function invoke(name: keyof typeof IPC_ENDPOINTS.localPlanning, event: unknown, payload?: unknown) {
    registerIpcGroup("localPlanning", localPlanningIpcHandlers({ localPlanning: fixture.main }).localPlanning);
    const listener = registrations.get(IPC_ENDPOINTS.localPlanning[name].channel);
    if (!listener) throw new Error("Missing planning listener.");
    return listener(event, payload);
  }
  it("refuses auxiliary and subframe senders before payload access and project reads", async () => {
    const read = vi.spyOn(fixture.domain, "listProjects");
    let decoded = 0;
    const payload = {
      get session() {
        decoded++;
        throw new Error("Decoder touched rejected input.");
      },
    };
    const auxiliary = renderer(700);
    await expect(Promise.resolve().then(() => invoke("listProjects", auxiliary.event(), payload))).rejects.toThrow();
    await expect(
      Promise.resolve().then(() =>
        invoke(
          "listProjects",
          { sender: fixture.first.contents, senderFrame: { ...fixture.first.contents.mainFrame } },
          payload,
        ),
      ),
    ).rejects.toThrow();
    expect(decoded).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects forged authority and oversized fields before domain reads", async () => {
    const entered = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    const read = vi.spyOn(fixture.domain, "listProjects");
    for (const payload of [
      { session: entered, input: {}, principalId: randomUUID() },
      { session: { generation: entered.generation, owner: randomUUID() }, input: {} },
      { session: { generation: entered.generation }, input: { archive: "x".repeat(100000) } },
    ])
      await expect(
        Promise.resolve().then(() => invoke("listProjects", fixture.first.event(), payload)),
      ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("returns bounded replies and omits private failure causes", async () => {
    const entered = await Effect.runPromise(fixture.main.enter(fixture.first.event()));
    expect(
      await invoke("listProjects", fixture.first.event(), { session: { generation: entered.generation }, input: {} }),
    ).toEqual({ ok: true, value: { items: [], next: null } });
    fixture.main.invalidateScopes();
    const reply = await invoke("listProjects", fixture.first.event(), {
      session: { generation: entered.generation },
      input: {},
    });
    expect(reply).toEqual({ ok: false, error: { code: "stale_scope", message: expect.any(String) } });
    expect(JSON.stringify(reply)).not.toContain("cause");
  });
});
