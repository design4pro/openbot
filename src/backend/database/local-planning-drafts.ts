import type { DatabaseSync } from "node:sqlite";
import type { DraftInput, DraftTarget, DraftView, Page, PageRequest } from "@openbot/contracts/ipc";
import { Schema } from "effect";
import type { LocalPlanningOwner } from "../local-planning/local-planning-authority";
import { planningFailure } from "../local-planning/local-planning-errors";
import { draftInputSchema } from "../local-planning/local-planning-schemas";
import type { DatabaseCore } from "./database-core";
import { databaseRow, requiredNumberColumn as number, requiredStringColumn as text } from "./database-rows";
import { planningPage, requiredPlanningRow } from "./local-planning-records";

type Row = NonNullable<ReturnType<typeof databaseRow>>;
const draftWhere = "d.principal_id=? AND d.local_scope_id=?";
function draftView(row: Row): DraftView & { createdAt: string } {
  const input = Schema.decodeUnknownSync(draftInputSchema)({
    target: JSON.parse(text(row, "target_json")),
    form: JSON.parse(text(row, "form_json")),
  });
  return {
    ...input,
    id: text(row, "draft_id"),
    windowDraftId: text(row, "window_draft_id"),
    revision: number(row, "revision"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
export function draftTargetKey(target: DraftTarget): string {
  switch (target.kind) {
    case "project":
      return JSON.stringify([target.kind, target.id ?? "new"]);
    case "milestone":
    case "ticket":
      return JSON.stringify([target.kind, target.projectId, target.id ?? "new"]);
    case "review":
      return JSON.stringify([target.kind, target.projectId, target.milestoneId]);
    case "decision":
      return JSON.stringify([target.kind, target.projectId, target.milestoneId, target.reviewId]);
  }
}
/** Owns draft SQL and quotas in the caller's command transaction. Never imports the facade or opens BEGIN. */
export class LocalPlanningDrafts {
  readonly #core: DatabaseCore;
  constructor(core: DatabaseCore) {
    this.#core = core;
  }
  list(owner: LocalPlanningOwner, page: PageRequest): Page<DraftView> {
    const result = planningPage(
      this.#core.connection,
      "local_project_drafts d",
      "d",
      "draft_id",
      draftWhere,
      [owner.principalId, owner.localScopeId],
      page,
      draftView,
    );
    return { items: result.items.map(({ createdAt: _, ...view }) => view), next: result.next };
  }
  get(db: DatabaseSync, owner: LocalPlanningOwner, id: string): DraftView {
    return draftView(
      requiredPlanningRow(
        db
          .prepare(`SELECT d.* FROM local_project_drafts d WHERE ${draftWhere} AND d.draft_id=?`)
          .get(owner.principalId, owner.localScopeId, id),
      ),
    );
  }
  requireWindow(db: DatabaseSync, owner: LocalPlanningOwner, id: string, revision: number): DraftView {
    const view = this.requireRevision(db, owner, id, revision);
    if (view.windowDraftId !== owner.windowDraftId) planningFailure("forbidden");
    return view;
  }
  requireRevision(db: DatabaseSync, owner: LocalPlanningOwner, id: string, revision: number): DraftView {
    const view = this.get(db, owner, id);
    if (view.revision !== revision) planningFailure("revision_conflict");
    return view;
  }
  save(
    db: DatabaseSync,
    owner: LocalPlanningOwner,
    input: DraftInput,
    draftId: string | null,
    expectedRevision: number | null,
    now: string,
    newId: string,
  ): { id: string; revision: number } {
    if ((draftId === null) !== (expectedRevision === null)) planningFailure("invalid_input");
    let oldBytes = 0;
    let revision = 1;
    const targetKey = draftTargetKey(input.target);
    if (draftId !== null && expectedRevision !== null) {
      const old = this.requireWindow(db, owner, draftId, expectedRevision);
      if (draftTargetKey(old.target) !== targetKey) planningFailure("invalid_input");
      if (expectedRevision === Number.MAX_SAFE_INTEGER) planningFailure("limit_reached");
      revision = expectedRevision + 1;
      oldBytes = number(
        requiredPlanningRow(db.prepare("SELECT byte_count FROM local_project_drafts WHERE draft_id=?").get(draftId)),
        "byte_count",
      );
    }
    const collision = databaseRow(
      db
        .prepare(
          "SELECT draft_id FROM local_project_drafts WHERE local_scope_id=? AND window_draft_id=? AND target_key=?",
        )
        .get(owner.localScopeId, owner.windowDraftId, targetKey),
    );
    if (collision && text(collision, "draft_id") !== draftId) planningFailure("revision_conflict");
    const formJson = JSON.stringify(input.form);
    const bytes = Buffer.byteLength(formJson, "utf8");
    const usage = requiredPlanningRow(
      db
        .prepare(
          "SELECT COUNT(*) AS count,COALESCE(SUM(byte_count),0) AS bytes FROM local_project_drafts WHERE principal_id=? AND local_scope_id=?",
        )
        .get(owner.principalId, owner.localScopeId),
    );
    if (
      number(usage, "count") + (draftId === null ? 1 : 0) > 100 ||
      number(usage, "bytes") - oldBytes + bytes > 32 * 1024 * 1024
    )
      planningFailure("limit_reached");
    const id = draftId ?? newId;
    if (draftId === null)
      db.prepare(
        "INSERT INTO local_project_drafts(draft_id,principal_id,local_scope_id,window_draft_id,target_key,target_json,form_json,revision,byte_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        owner.principalId,
        owner.localScopeId,
        owner.windowDraftId,
        targetKey,
        JSON.stringify(input.target),
        formJson,
        revision,
        bytes,
        now,
        now,
      );
    else
      db.prepare(
        "UPDATE local_project_drafts SET form_json=?,revision=?,byte_count=?,updated_at=? WHERE draft_id=?",
      ).run(formJson, revision, bytes, now, id);
    return { id, revision };
  }
  discard(db: DatabaseSync, owner: LocalPlanningOwner, id: string, revision: number): void {
    this.requireRevision(db, owner, id, revision);
    db.prepare("DELETE FROM local_project_drafts WHERE draft_id=? AND principal_id=? AND local_scope_id=?").run(
      id,
      owner.principalId,
      owner.localScopeId,
    );
  }
}
