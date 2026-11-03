import type { DraftInput } from "@openbot/contracts/ipc";
import { Button, Field, Input, Textarea } from "@openbot/ui";
import { useText } from "../../text";

type Form = Extract<DraftInput, { target: { kind: "project" | "milestone" } }>;
export function ProjectForm(props: {
  input: Form;
  busy: boolean;
  onChange: (input: DraftInput) => void;
  onSave: () => void;
  onBlur: (next: EventTarget | null) => void;
}) {
  const { t } = useText();
  const isProject = () => props.input.target.kind === "project";
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
      <Field label={t(isProject() ? "work.projectTitle" : "work.milestoneTitle")}>
        <Input
          value={props.input.form.title}
          disabled={props.busy}
          onValueChange={(title) => {
            const input = props.input;
            if (input.target.kind === "project" && "goal" in input.form)
              props.onChange({ target: input.target, form: { ...input.form, title } });
            else if (input.target.kind === "milestone" && "criteria" in input.form)
              props.onChange({ target: input.target, form: { ...input.form, title } });
          }}
        />
      </Field>
      <Field label={t(isProject() ? "work.goal" : "work.criteria")}>
        <Textarea
          value={"goal" in props.input.form ? props.input.form.goal : props.input.form.criteria}
          disabled={props.busy}
          onValueChange={(text) => {
            const input = props.input;
            if (input.target.kind === "project" && "goal" in input.form)
              props.onChange({ target: input.target, form: { ...input.form, goal: text } });
            else if (input.target.kind === "milestone" && "criteria" in input.form)
              props.onChange({ target: input.target, form: { ...input.form, criteria: text } });
          }}
        />
      </Field>
      <Button type="submit" disabled={props.busy}>
        {t(isProject() ? "work.saveProject" : "work.saveMilestone")}
      </Button>
    </form>
  );
}
