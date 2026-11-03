import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import type { PlanningAction, PlanningCommand } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import { ChannelStore } from "../../src/backend/channel-store";
import { LocalPlanningAuthority } from "../../src/backend/local-planning/local-planning-authority";
import { LocalPlanningService } from "../../src/backend/local-planning/local-planning-service";
import { OpenBotDatabase } from "../../src/backend/openbot-database";

export async function domainCases(root: string): Promise<string[]> {
  const db = new OpenBotDatabase(join(root, "profile"));
  await Effect.runPromise(db.initialize());
  const authority = new LocalPlanningAuthority(db.localIdentity);
  const service = new LocalPlanningService({
    authority,
    records: db.localPlanningRecords,
    drafts: db.localPlanningDrafts,
  });
  const ctx = authority.issue();
  const run = (action: PlanningAction, extra: Partial<PlanningCommand> = {}) =>
    Effect.runPromise(service.run(ctx, { operationId: randomUUID(), action, ...extra }));
  const fail = async <A>(effect: Effect.Effect<A, { code: string }>, code: string) => {
    const result = await Effect.runPromise(Effect.result(effect));
    assert.ok(Result.isFailure(result));
    assert.equal(result.failure.code, code);
  };
  const cases: string[] = [];
  try {
    const operationId = randomUUID();
    const command: PlanningCommand = {
      operationId,
      action: { kind: "create_project", title: "Offline", goal: "No account" },
    };
    const created = await Effect.runPromise(service.run(ctx, command));
    const projectId = created.objectId;
    assert.equal(created.revision, 1);
    assert.deepEqual(await Effect.runPromise(service.run(ctx, command)), created);
    assert.equal(
      db.connection.prepare("SELECT COUNT(*) AS n FROM orchestration_events WHERE aggregate_type='local-project'").get()
        ?.n,
      1,
    );
    assert.deepEqual(
      await Effect.runPromise(
        service.run(ctx, { action: { goal: "No account", title: "Offline", kind: "create_project" }, operationId }),
      ),
      created,
    );
    db.connection.exec("BEGIN IMMEDIATE");
    try {
      db.connection
        .prepare(
          "DELETE FROM orchestration_command_receipts WHERE command_id=(SELECT command_id FROM local_project_command_keys WHERE operation_id=?)",
        )
        .run(operationId);
      await fail(service.run(ctx, command), "storage_failed");
    } finally {
      db.connection.exec("ROLLBACK");
    }
    cases.push("command-replay");
    await fail(
      service.run(ctx, { ...command, action: { kind: "create_project", title: "Changed", goal: "No account" } }),
      "operation_conflict",
    );
    cases.push("operation-conflict");
    await fail(service.getProject({ ...ctx }, projectId), "forbidden");
    const other = new LocalPlanningAuthority(db.localIdentity);
    await fail(service.getProject(other.issue(), projectId), "forbidden");
    await fail(service.getProject(ctx, randomUUID()), "not_found");
    const otherWindow = authority.issue();
    const milestone = await run({
      kind: "create_milestone",
      projectId,
      expectedRevision: 1,
      title: "First",
      criteria: "Ready",
    });
    const ticket = await run({
      kind: "create_ticket",
      projectId,
      expectedRevision: 2,
      milestoneId: milestone.objectId,
      title: "Task",
      criteria: "Done",
      notes: "",
      status: "todo",
    });
    await run({
      kind: "edit_ticket",
      projectId,
      expectedRevision: 3,
      ticketId: ticket.objectId,
      milestoneId: null,
      title: "Task",
      criteria: "Done",
      notes: "Manual",
      status: "done",
    });
    assert.equal((await Effect.runPromise(service.listTickets(ctx, { projectId }))).items[0]?.status, "done");
    assert.equal((await Effect.runPromise(service.listMilestones(ctx, { projectId }))).items[0]?.revision, 2);
    cases.push("offline-planning");
    const race = await Promise.all([
      Effect.runPromise(
        Effect.result(
          service.run(ctx, {
            operationId: randomUUID(),
            action: { kind: "edit_project", projectId, expectedRevision: 4, title: "One", goal: "" },
          }),
        ),
      ),
      Effect.runPromise(
        Effect.result(
          service.run(otherWindow, {
            operationId: randomUUID(),
            action: { kind: "edit_project", projectId, expectedRevision: 4, title: "Two", goal: "" },
          }),
        ),
      ),
    ]);
    assert.equal(race.filter(Result.isSuccess).length, 1);
    assert.equal(race.filter(Result.isFailure)[0]?.failure.code, "revision_conflict");
    cases.push("revision-conflict");
    await run({ kind: "archive_project", projectId, expectedRevision: 5 });
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "edit_project", projectId, expectedRevision: 6, title: "No", goal: "" },
      }),
      "invalid_transition",
    );
    assert.equal((await Effect.runPromise(service.listProjects(ctx, {}))).items.length, 0);
    assert.equal((await Effect.runPromise(service.listProjects(ctx, { archive: "archived" }))).items.length, 1);
    await run({ kind: "restore_project", projectId, expectedRevision: 6 });
    cases.push("archive-restore");
    await run({ kind: "create_project", title: "😀".repeat(256), goal: "😀".repeat(32768) });
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "create_project", title: "😀".repeat(257), goal: "" },
      }),
      "invalid_input",
    );
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "create_project", title: "Allowed", goal: "😀".repeat(32769) },
      }),
      "invalid_input",
    );
    await fail(
      service.run(ctx, { operationId: randomUUID(), action: { kind: "create_project", title: " \n", goal: "" } }),
      "invalid_input",
    );
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "create_project", title: "Ill-formed", goal: "\ud800" },
      }),
      "invalid_input",
    );
    cases.push("unicode-limit");
    const formIds = [randomUUID(), randomUUID()];
    const formDrafts = [];
    for (const formId of formIds) {
      formDrafts.push(
        await run({
          kind: "save_draft",
          draftId: null,
          expectedDraftRevision: null,
          target: { kind: "project", id: null, formId },
          form: { title: `Create form ${formId}`, goal: "" },
        }),
      );
    }
    assert.notEqual(formDrafts[0]?.objectId, formDrafts[1]?.objectId);
    for (const saved of formDrafts)
      await run({ kind: "discard_draft", draftId: saved.objectId, expectedDraftRevision: saved.revision });
    cases.push("distinct-create-form-drafts");
    const draft = await run({
      kind: "save_draft",
      draftId: null,
      expectedDraftRevision: null,
      target: { kind: "project", id: null },
      form: { title: "", goal: "Unfinished" },
    });
    assert.equal((await Effect.runPromise(service.listDrafts(ctx, {}))).items[0]?.revision, 1);
    await fail(
      service.run(otherWindow, {
        operationId: randomUUID(),
        action: {
          kind: "save_draft",
          draftId: draft.objectId,
          expectedDraftRevision: 1,
          target: { kind: "project", id: null },
          form: { title: "", goal: "Other window cannot overwrite" },
        },
      }),
      "forbidden",
    );
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: {
          kind: "save_draft",
          draftId: null,
          expectedDraftRevision: null,
          target: { kind: "project", id: null },
          form: { title: "", goal: "Duplicate" },
        },
      }),
      "revision_conflict",
    );
    const before = (await Effect.runPromise(service.getProject(ctx, projectId))).revision;
    const draftCommand: PlanningCommand = {
      operationId: randomUUID(),
      action: { kind: "create_project", title: "Recovered", goal: "Unfinished" },
      consumedDraft: { id: draft.objectId, revision: 1 },
    };
    await fail(
      service.run(ctx, { ...draftCommand, consumedDraft: { id: draft.objectId, revision: 2 } }),
      "revision_conflict",
    );
    assert.equal((await Effect.runPromise(service.listDrafts(ctx, {}))).items.length, 1);
    const resumed = await Effect.runPromise(service.run(ctx, draftCommand));
    assert.equal((await Effect.runPromise(service.listDrafts(ctx, {}))).items.length, 0);
    assert.deepEqual(await Effect.runPromise(service.run(ctx, draftCommand)), resumed);
    assert.equal((await Effect.runPromise(service.getProject(ctx, projectId))).revision, before);
    cases.push("draft-consumption");
    for (let n = 0; n < 103; n++) await run({ kind: "create_project", title: `Page ${n}`, goal: "" });
    const seen = new Set<string>();
    let after: { createdAt: string; id: string } | undefined;
    do {
      const page = await Effect.runPromise(service.listProjects(ctx, { limit: 17, after }));
      for (const item of page.items) {
        assert.ok(!seen.has(item.id));
        seen.add(item.id);
      }
      after = page.next ?? undefined;
    } while (after);
    assert.equal(seen.size, 106);
    await fail(service.listProjects(ctx, { limit: 101 }), "invalid_input");
    await fail(service.listProjects(ctx, { after: { id: randomUUID(), createdAt: "not-a-date" } }), "invalid_input");
    cases.push("keyset-pages");
    for (let n = 0; n < 100; n++) {
      const window = authority.issue();
      await Effect.runPromise(
        service.run(window, {
          operationId: randomUUID(),
          action: {
            kind: "save_draft",
            draftId: null,
            expectedDraftRevision: null,
            target: { kind: "project", id: null },
            form: { title: "", goal: "" },
          },
        }),
      );
    }
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: {
          kind: "save_draft",
          draftId: null,
          expectedDraftRevision: null,
          target: { kind: "project", id: null },
          form: { title: "", goal: "" },
        },
      }),
      "limit_reached",
    );
    assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM local_project_drafts").get()?.n, 100);
    cases.push("draft-limit");
    await byteQuotaCase(join(root, "byte-quota"));
    cases.push("draft-byte-limit");
    for (const mode of ["before", "after"] as const) await crashCase(join(root, `crash-${mode}`), mode);
    cases.push("command-crash");
    const metadata = db.connection
      .prepare(
        "SELECT payload_json FROM orchestration_events WHERE aggregate_type IN ('local-project','local-planning-draft')",
      )
      .all();
    for (const event of metadata) {
      assert.equal(typeof event.payload_json, "string");
      if (typeof event.payload_json !== "string") throw new Error("Invalid event fixture.");
      assert.deepEqual(Object.keys(JSON.parse(event.payload_json)).sort(), ["objectId", "revision"]);
    }
    cases.push("private-event-metadata");
    const channels = new ChannelStore(db);
    const channel = channels.create(randomUUID(), {
      name: "Independent",
      title: "Independent",
      instructions: "",
      members: [],
      leadAgentId: null,
    });
    channels.commit(randomUUID(), { channel, messages: [], tasks: [], assignments: [] });
    channels.delete(channel.id);
    assert.equal(channels.exists(channel.id), false);
    assert.deepEqual(await Effect.runPromise(service.run(ctx, command)), created);
    cases.push("channel-independent-replay");
    // A new service and issuer recover data from the same closed profile, never an account.
    db.close();
    await Effect.runPromise(db.initialize());
    assert.deepEqual(await Effect.runPromise(service.run(ctx, command)), created);
    const reopened = new LocalPlanningAuthority(db.localIdentity);
    const reopenedService = new LocalPlanningService({
      authority: reopened,
      records: db.localPlanningRecords,
      drafts: db.localPlanningDrafts,
    });
    assert.equal(
      (await Effect.runPromise(reopenedService.listDrafts(reopened.issue(), { limit: 100 }))).items.length,
      100,
    );
    const recoveredContext = reopened.issue();
    const recovered = (await Effect.runPromise(reopenedService.listDrafts(recoveredContext, { limit: 100 }))).items[0];
    assert.ok(recovered);
    await Effect.runPromise(
      reopenedService.run(recoveredContext, {
        operationId: randomUUID(),
        action: { kind: "discard_draft", draftId: recovered.id, expectedDraftRevision: recovered.revision },
      }),
    );
    assert.equal(
      (await Effect.runPromise(reopenedService.listDrafts(recoveredContext, { limit: 100 }))).items.length,
      99,
    );
    cases.push("recovered-draft-discard");
    // Authorization must precede receipt replay even when a receipt exists.
    db.connection.exec("DELETE FROM local_profile_identity_bootstrap");
    await fail(service.run(ctx, command), "identity_invalid");
    cases.push("authority-before-replay");
    return cases;
  } finally {
    db.close();
  }
}

async function byteQuotaCase(profile: string): Promise<void> {
  const db = new OpenBotDatabase(profile);
  await Effect.runPromise(db.initialize());
  const authority = new LocalPlanningAuthority(db.localIdentity);
  const service = new LocalPlanningService({
    authority,
    records: db.localPlanningRecords,
    drafts: db.localPlanningDrafts,
  });
  try {
    const ctx = authority.issue();
    const project = await Effect.runPromise(
      service.run(ctx, { operationId: randomUUID(), action: { kind: "create_project", title: "Quota", goal: "" } }),
    );
    // JSON escapes valid NUL code points, so the byte quota is reachable before the row quota.
    const text = "\u0000".repeat(32768);
    let saved = 0;
    for (let n = 0; n < 100; n++) {
      const result = await Effect.runPromise(
        Effect.result(
          service.run(authority.issue(), {
            operationId: randomUUID(),
            action: {
              kind: "save_draft",
              draftId: null,
              expectedDraftRevision: null,
              target: { kind: "ticket", projectId: project.objectId, id: null },
              form: { title: "", criteria: text, notes: text, milestoneId: null, status: "todo" },
            },
          }),
        ),
      );
      if (Result.isFailure(result)) {
        assert.equal(result.failure.code, "limit_reached");
        break;
      }
      saved++;
    }
    assert.ok(saved > 0 && saved < 100);
    const usage = db.connection
      .prepare("SELECT COUNT(*) AS n,SUM(byte_count) AS bytes FROM local_project_drafts")
      .get();
    assert.equal(usage?.n, saved);
    assert.ok(typeof usage?.bytes === "number" && usage.bytes <= 32 * 1024 * 1024);
  } finally {
    db.close();
  }
}
async function crashCase(profile: string, mode: "before" | "after"): Promise<void> {
  const command: PlanningCommand = {
    operationId: randomUUID(),
    action: { kind: "create_project", title: "Crash probe", goal: "" },
  };
  const worker = fork(join(import.meta.dirname, "domain-worker.ts"), [profile, mode], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const deadline = AbortSignal.timeout(30000);
  const exited = once(worker, "exit", { signal: deadline });
  try {
    assert.equal((await once(worker, "message", { signal: deadline }))[0], "ready");
    const committed = mode === "after" ? once(worker, "message", { signal: deadline }) : null;
    worker.send(command);
    if (committed) {
      assert.equal((await committed)[0], "committed");
      worker.kill("SIGKILL");
    }
    const [, signal] = await exited;
    assert.equal(signal, "SIGKILL");
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGKILL");
      await exited.catch(() => {});
    }
  }
  const db = new OpenBotDatabase(profile);
  await Effect.runPromise(db.initialize());
  try {
    assert.equal(
      db.connection.prepare("SELECT COUNT(*) AS n FROM projection_local_projects").get()?.n,
      mode === "before" ? 0 : 1,
    );
    const authority = new LocalPlanningAuthority(db.localIdentity);
    const service = new LocalPlanningService({
      authority,
      records: db.localPlanningRecords,
      drafts: db.localPlanningDrafts,
    });
    const ctx = authority.issue();
    const result = await Effect.runPromise(service.run(ctx, command));
    assert.deepEqual(await Effect.runPromise(service.run(ctx, command)), result);
    assert.equal(
      db.connection.prepare("SELECT COUNT(*) AS n FROM orchestration_events WHERE aggregate_type='local-project'").get()
        ?.n,
      1,
    );
  } finally {
    db.close();
  }
}
