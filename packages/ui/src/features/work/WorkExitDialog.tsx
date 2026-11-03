import { Button, ConfirmDialog } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

export function WorkExitDialog(props: {
  active: boolean;
  open: boolean;
  onLeave: () => void;
  busy: boolean;
  failed: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) {
  const { t } = useText();
  return (
    <>
      <Show when={props.active}>
        <aside class="work-privacy-bar" hidden={props.open} aria-label={t("work.privateActive")}>
          <span role="status">{t("work.privateActive")}</span>
          <Button variant="ghost" disabled={props.busy} onClick={() => props.onLeave()}>
            {t("work.leave")}
          </Button>
        </aside>
      </Show>
      <ConfirmDialog
        open={props.open}
        pending={props.busy}
        tone="default"
        title={t("work.exitTitle")}
        description={t("work.exitDescription")}
        confirmLabel={t("work.saveExit")}
        cancelLabel={t("work.stay")}
        onConfirm={props.onSave}
        onCancel={props.onStay}
        initialFocus="cancel"
      >
        <Button variant="ghost" disabled={props.busy} onClick={() => props.onDiscard()}>
          {t("work.discardExit")}
        </Button>
      </ConfirmDialog>
      {props.failed && (
        <p role="alert" class="work-exit-error">
          {t("work.flushFailed")}
        </p>
      )}
    </>
  );
}
