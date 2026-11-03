// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodePlanningCommandReply,
  decodePlanningProjectReply,
  decodePlanningSessionReply,
} from "./local-planning-decoding";

const id = "98f1c8ad-1d80-4b8b-8b26-04bdfb99e49a";
describe("private planning replies from main", () => {
  it("accepts a complete session but rejects missing or forged authority fields", () => {
    const session = { generation: id, localScopeId: id, windowDraftId: id, privateEpoch: id };
    expect(decodePlanningSessionReply({ ok: true, value: session })).toEqual({ ok: true, value: session });
    expect(() => decodePlanningSessionReply({ ok: true, value: { ...session, privateEpoch: undefined } })).toThrow();
    expect(() => decodePlanningSessionReply({ ok: true, value: { ...session, principalId: id } })).toThrow();
  });
  it("does not expose malformed or cause-bearing failures", () => {
    expect(decodePlanningProjectReply({ ok: false, error: { code: "forbidden", message: "Access refused." } })).toEqual(
      { ok: false, error: { code: "forbidden", message: "Access refused." } },
    );
    expect(() =>
      decodePlanningProjectReply({
        ok: false,
        error: { code: "forbidden", message: "Access refused.", cause: "PRIVATE-CANARY" },
      }),
    ).toThrow();
    expect(() => decodePlanningProjectReply({ ok: false, error: { code: "invented", message: "Bad" } })).toThrow();
  });
  it("rejects oversized project text and invalid command revisions without echoing it", () => {
    const value = {
      id,
      title: "x".repeat(257),
      goal: "",
      revision: 1,
      archivedAt: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    expect(() => decodePlanningProjectReply({ ok: true, value })).toThrow();
    expect(() =>
      decodePlanningCommandReply({ ok: true, value: { objectId: id, revision: 0, projectId: null } }),
    ).toThrow();
  });
});
