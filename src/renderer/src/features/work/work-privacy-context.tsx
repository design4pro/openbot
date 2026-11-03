import type { PlanningPrepareExit } from "@openbot/contracts/ipc";
import { WorkExitDialog } from "@openbot/ui/features/work/WorkExitDialog";
import { createStore, onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { workPort } from "./work-port";

export interface WorkFlush {
  save(): Promise<boolean>;
  discard(): Promise<boolean>;
}

const context = createSimpleContext({
  name: "Work privacy",
  init: () => {
    const [state, setState] = createStore<{
      epoch: string | null;
      exit: PlanningPrepareExit | null;
      busy: boolean;
      failed: boolean;
    }>({ epoch: null, exit: null, busy: false, failed: false });
    let current: WorkFlush | null = null;
    let flushComposer: (() => boolean) | null = null;
    function register(flush: WorkFlush): () => void {
      current = flush;
      return () => {
        if (current === flush) current = null;
      };
    }
    onSettled(() =>
      workPort().localPlanning.onPrepareExit((exit) => {
        if (exit.privateEpoch !== state.epoch) return;
        setState((draft) => {
          draft.exit = exit;
          draft.failed = false;
        });
      }),
    );
    async function confirm(outcome: "saved" | "discarded" | "blocked"): Promise<void> {
      const exit = state.exit;
      if (!exit || state.busy) return;
      setState((draft) => {
        draft.busy = true;
        draft.failed = false;
      });
      try {
        const flushed =
          outcome === "blocked" ||
          (!!current && !!flushComposer?.() && (await current[outcome === "saved" ? "save" : "discard"]()));
        const reply = await workPort().localPlanning.confirmExit({ ...exit, outcome: flushed ? outcome : "blocked" });
        setState((draft) => {
          draft.exit = null;
          draft.failed = outcome !== "blocked" && (!flushed || !reply.ok);
        });
      } catch {
        setState((draft) => {
          draft.exit = null;
          draft.failed = outcome !== "blocked";
        });
      } finally {
        setState((draft) => {
          draft.busy = false;
        });
      }
    }
    async function leave(): Promise<void> {
      const epoch = state.epoch;
      if (!epoch || state.busy) return;
      try {
        const reply = await workPort().localPlanning.leave({ privateEpoch: epoch });
        if (!reply.ok)
          setState((draft) => {
            draft.failed = true;
          });
      } catch {
        setState((draft) => {
          draft.failed = true;
        });
      }
    }
    return {
      state,
      register,
      leave,
      confirm,
      enrolled(epoch: string) {
        setState((draft) => {
          draft.epoch = epoch;
        });
      },
      registerComposer(flush: () => boolean) {
        flushComposer = flush;
        return () => {
          if (flushComposer === flush) flushComposer = null;
        };
      },
    };
  },
});
export const WorkPrivacyProvider = context.provider;
export const useWorkPrivacy = context.use;

/** This stable consumer carries only epoch/exit metadata across host scope disposal. */
export function WorkPrivacyDialog() {
  const privacy = useWorkPrivacy();
  return (
    <WorkExitDialog
      active={privacy.state.epoch !== null}
      onLeave={() => void privacy.leave()}
      open={privacy.state.exit !== null}
      busy={privacy.state.busy}
      failed={privacy.state.failed}
      onSave={() => void privacy.confirm("saved")}
      onDiscard={() => void privacy.confirm("discarded")}
      onStay={() => void privacy.confirm("blocked")}
    />
  );
}
