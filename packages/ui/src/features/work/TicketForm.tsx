import type { DraftInput, MilestoneView, TicketStatus } from "@openbot/contracts/ipc";
import { Button, Field, Input, Textarea } from "@openbot/ui";
import { For } from "solid-js";
import { useText } from "../../text";

type Form = Extract<DraftInput, { target: { kind: "ticket" } }>;
const statuses = [
  { value: "todo", label: "work.todo" },
  { value: "in_progress", label: "work.inProgress" },
  { value: "done", label: "work.done" },
] as const;
export function TicketForm(props: {
  input: Form;
  milestones: MilestoneView[];
  busy: boolean;
  onChange: (input: DraftInput) => void;
  onSave: () => void;
  onBlur: (next: EventTarget | null) => void;
}) {
  const { t } = useText();
  const patch = (fields: Partial<Form["form"]>) =>
    props.onChange({ target: props.input.target, form: { ...props.input.form, ...fields } });
  return (
    <form
      class="work-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave();
      }}
      onFocusOut={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          props.onBlur(event.relatedTarget);
      }}
    >
      <Field label={t("work.ticketTitle")}>
        <Input value={props.input.form.title} disabled={props.busy} onValueChange={(title) => patch({ title })} />
      </Field>
      <Field label={t("work.criteria")}>
        <Textarea
          value={props.input.form.criteria}
          disabled={props.busy}
          onValueChange={(criteria) => patch({ criteria })}
        />
      </Field>
      <Field label={t("work.notes")}>
        <Textarea value={props.input.form.notes} disabled={props.busy} onValueChange={(notes) => patch({ notes })} />
      </Field>
      <fieldset class="work-actions" aria-label={t("work.tickets")}>
        <For each={statuses}>
          {(status) => (
            <Button
              variant="ghost"
              aria-pressed={props.input.form.status === status.value ? "true" : "false"}
              disabled={props.busy}
              onClick={() => patch({ status: status.value satisfies TicketStatus })}
            >
              {t(status.label)}
            </Button>
          )}
        </For>
      </fieldset>
      <fieldset class="work-actions" aria-label={t("work.milestones")}>
        <Button
          variant="ghost"
          aria-pressed={props.input.form.milestoneId === null ? "true" : "false"}
          disabled={props.busy}
          onClick={() => patch({ milestoneId: null })}
        >
          {t("work.noMilestone")}
        </Button>
        <For each={props.milestones}>
          {(milestone) => (
            <Button
              variant="ghost"
              aria-pressed={props.input.form.milestoneId === milestone.id ? "true" : "false"}
              disabled={props.busy}
              onClick={() => patch({ milestoneId: milestone.id })}
            >
              {milestone.title}
            </Button>
          )}
        </For>
      </fieldset>
      <Button type="submit" disabled={props.busy}>
        {t("work.saveTicket")}
      </Button>
    </form>
  );
}
