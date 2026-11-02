// Owns one disposable-profile process for the transaction crash probe.
import { Effect, Schema } from "effect";
import { LocalPlanningAuthority } from "../../src/backend/local-planning/local-planning-authority";
import { planningCommandSchema } from "../../src/backend/local-planning/local-planning-schemas";
import { LocalPlanningService } from "../../src/backend/local-planning/local-planning-service";
import { OpenBotDatabase } from "../../src/backend/openbot-database";

const profile = process.argv[2];
const mode = process.argv[3];
if (!profile || (mode !== "before" && mode !== "after") || !process.send)
  throw new Error("Invalid owned worker input.");
const db = new OpenBotDatabase(profile);
await Effect.runPromise(db.initialize());
const authority = new LocalPlanningAuthority(db.localIdentity);
const service = new LocalPlanningService({
  authority,
  records: db.localPlanningRecords,
  drafts: db.localPlanningDrafts,
});
const context = authority.issue();
if (mode === "before") {
  db.connection.function("planning_crash", () => {
    process.kill(process.pid, "SIGKILL");
    return 0;
  });
  db.connection.exec(
    "CREATE TEMP TRIGGER crash_before_receipt BEFORE INSERT ON orchestration_command_receipts BEGIN SELECT planning_crash(); END",
  );
}
process.once("message", async (value) => {
  const command = Schema.decodeUnknownSync(planningCommandSchema)(value);
  await Effect.runPromise(service.run(context, command));
  // The parent receives no result, simulating a lost response after durable commit.
  process.send?.("committed");
});
process.send("ready");
