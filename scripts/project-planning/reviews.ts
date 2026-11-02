import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PlanningAction, PlanningCommand } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import { LocalPlanningAuthority } from "../../src/backend/local-planning/local-planning-authority";
import { LocalPlanningService } from "../../src/backend/local-planning/local-planning-service";
import { OpenBotDatabase } from "../../src/backend/openbot-database";

export async function reviewCases(root: string): Promise<string[]> {
  const db = new OpenBotDatabase(join(root, "profile"));
  await Effect.runPromise(db.initialize());
  const authority = new LocalPlanningAuthority(db.localIdentity);
  const service = new LocalPlanningService({
    authority,
    records: db.localPlanningRecords,
    drafts: db.localPlanningDrafts,
  });
  const ctx = authority.issue();
  const otherWindow = authority.issue();
  const run = (action: PlanningAction, operationId = randomUUID()) =>
    Effect.runPromise(service.run(ctx, { operationId, action }));
  const fail = async <A>(effect: Effect.Effect<A, { code: string }>, code: string) => {
    const result = await Effect.runPromise(Effect.result(effect));
    assert.ok(Result.isFailure(result));
    assert.equal(result.failure.code, code);
  };
  const cases: string[] = [];
  try {
    const project = await run({ kind: "create_project", title: "Manual review", goal: "" });
    const projectId = project.objectId;
    const milestone = await run({
      kind: "create_milestone",
      projectId,
      expectedRevision: 1,
      title: "Gate",
      criteria: "  ",
    });
    const milestoneId = milestone.objectId;
    const current = async () => {
      const result = await Effect.runPromise(service.listMilestones(ctx, { projectId }));
      const item = result.items.find((item) => item.id === milestoneId);
      assert.ok(item);
      return item;
    };
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "submit_review", projectId, expectedRevision: 2, milestoneId, evidenceNote: "Evidence" },
      }),
      "invalid_input",
    );
    await run({
      kind: "edit_milestone",
      projectId,
      expectedRevision: 2,
      milestoneId,
      title: "Gate",
      criteria: "Criterion A",
    });
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "submit_review", projectId, expectedRevision: 3, milestoneId, evidenceNote: " \n" },
      }),
      "invalid_input",
    );
    const submitted: PlanningCommand = {
      operationId: randomUUID(),
      action: { kind: "submit_review", projectId, expectedRevision: 3, milestoneId, evidenceNote: "Human evidence A" },
    };
    const review = await Effect.runPromise(service.run(ctx, submitted));
    assert.deepEqual(await Effect.runPromise(service.run(ctx, submitted)), review);
    assert.equal(review.revision, 4);
    assert.equal((await current()).gateState, "in_review");
    assert.equal((await current()).gateGeneration, 1);
    assert.equal((await current()).currentReviewId, review.objectId);
    const snapshot = await Effect.runPromise(service.getReview(ctx, review.objectId));
    assert.equal(snapshot.review.criteriaSnapshot, "Criterion A");
    assert.equal(snapshot.review.criteriaRevision, 2);
    assert.equal(snapshot.review.evidenceNote, "Human evidence A");
    assert.equal(snapshot.decision, null);
    cases.push("review-submission");
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "submit_review", projectId, expectedRevision: 4, milestoneId, evidenceNote: "Overwrite" },
      }),
      "invalid_transition",
    );
    const release: PlanningAction = {
      kind: "decide_review",
      projectId,
      expectedRevision: 4,
      milestoneId,
      reviewId: review.objectId,
      gateGeneration: 1,
      criteriaRevision: 2,
      decision: "release",
      rationale: "Accepted",
    };
    await fail(service.run({ ...ctx }, { operationId: randomUUID(), action: release }), "forbidden");
    await fail(
      service.run(ctx, { operationId: randomUUID(), action: { ...release, gateGeneration: 2 } }),
      "invalid_transition",
    );
    await fail(
      service.run(ctx, { operationId: randomUUID(), action: { ...release, criteriaRevision: 1 } }),
      "invalid_transition",
    );
    await fail(
      service.run(ctx, { operationId: randomUUID(), action: { ...release, reviewId: randomUUID() } }),
      "invalid_transition",
    );
    const releaseCommand = { operationId: randomUUID(), action: release };
    const released = await Effect.runPromise(service.run(ctx, releaseCommand));
    assert.deepEqual(await Effect.runPromise(service.run(ctx, releaseCommand)), released);
    const history = await Effect.runPromise(service.getReview(ctx, review.objectId));
    assert.equal(history.decision?.decision, "release");
    assert.equal((await current()).gateState, "released");
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { ...release, expectedRevision: 5, decision: "request_changes" },
      }),
      "invalid_transition",
    );
    await fail(
      service.run(ctx, {
        operationId: randomUUID(),
        action: { kind: "submit_review", projectId, expectedRevision: 5, milestoneId, evidenceNote: "Bypass" },
      }),
      "invalid_transition",
    );
    cases.push("review-decision");
    await run({
      kind: "edit_milestone",
      projectId,
      expectedRevision: 5,
      milestoneId,
      title: "Renamed gate",
      criteria: "Criterion A",
    });
    assert.equal((await current()).gateState, "released");
    assert.equal((await current()).criteriaRevision, 2);
    assert.equal((await current()).currentReviewId, review.objectId);
    await run({
      kind: "edit_milestone",
      projectId,
      expectedRevision: 6,
      milestoneId,
      title: "Renamed gate",
      criteria: "Criterion B",
    });
    assert.equal((await current()).gateState, "changes_requested");
    assert.equal((await current()).criteriaRevision, 3);
    assert.equal((await current()).currentReviewId, null);
    assert.deepEqual(await Effect.runPromise(service.getReview(ctx, review.objectId)), history);
    cases.push("criteria-superseded");
    const second = await run({
      kind: "submit_review",
      projectId,
      expectedRevision: 7,
      milestoneId,
      evidenceNote: "Human evidence B",
    });
    assert.notEqual(second.objectId, review.objectId);
    assert.equal((await current()).gateGeneration, 2);
    await fail(
      service.run(otherWindow, { operationId: randomUUID(), action: { ...release, expectedRevision: 8 } }),
      "invalid_transition",
    );
    await fail(service.run(otherWindow, { operationId: randomUUID(), action: release }), "revision_conflict");
    await run({
      kind: "edit_milestone",
      projectId,
      expectedRevision: 8,
      milestoneId,
      title: "Gate",
      criteria: "Criterion C",
    });
    assert.equal((await current()).gateState, "changes_requested");
    assert.equal((await current()).currentReviewId, null);
    assert.equal((await Effect.runPromise(service.getReview(ctx, second.objectId))).decision, null);
    cases.push("stale-review-decision");
    const third = await run({
      kind: "submit_review",
      projectId,
      expectedRevision: 9,
      milestoneId,
      evidenceNote: "Human evidence C",
    });
    const requestChanges: PlanningAction = {
      kind: "decide_review",
      projectId,
      expectedRevision: 10,
      milestoneId,
      reviewId: third.objectId,
      gateGeneration: 3,
      criteriaRevision: 4,
      decision: "request_changes",
      rationale: "More evidence",
    };
    await run(requestChanges);
    assert.equal((await current()).gateState, "changes_requested");
    const fourth = await run({
      kind: "submit_review",
      projectId,
      expectedRevision: 11,
      milestoneId,
      evidenceNote: "Human evidence D",
    });
    await run({ kind: "archive_project", projectId, expectedRevision: 12 });
    const finalRelease: PlanningAction = {
      kind: "decide_review",
      projectId,
      expectedRevision: 13,
      milestoneId,
      reviewId: fourth.objectId,
      gateGeneration: 4,
      criteriaRevision: 4,
      decision: "release",
      rationale: "Accepted",
    };
    await fail(service.run(ctx, { operationId: randomUUID(), action: finalRelease }), "invalid_transition");
    await run({ kind: "restore_project", projectId, expectedRevision: 13 });
    await run({ ...finalRelease, expectedRevision: 14 });
    cases.push("archived-review-refusal");
    const before = await Effect.runPromise(service.listReviews(ctx, { projectId, milestoneId }));
    assert.equal(before.items.length, 4);
    db.close();
    await Effect.runPromise(db.initialize());
    assert.deepEqual(await Effect.runPromise(service.getReview(ctx, review.objectId)), history);
    assert.deepEqual(await Effect.runPromise(service.listReviews(ctx, { projectId, milestoneId })), before);
    assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM local_project_decisions").get()?.n, 3);
    assert.equal((await current()).gateState, "released");
    assert.equal(
      db.connection
        .prepare("SELECT COUNT(*) AS n FROM orchestration_events WHERE event_type='local-planning:submit_review'")
        .get()?.n,
      4,
    );
    assert.equal(
      db.connection
        .prepare("SELECT COUNT(*) AS n FROM orchestration_events WHERE event_type='local-planning:decide_review'")
        .get()?.n,
      3,
    );
    cases.push("review-history-reopen");
    return cases;
  } finally {
    db.close();
  }
}
