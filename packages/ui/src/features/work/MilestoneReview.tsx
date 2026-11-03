import type { DecisionView, ReviewView } from "@openbot/contracts/ipc";
import { Button, Field, Textarea } from "@openbot/ui";
import { For } from "solid-js";
import { useText } from "../../text";

export function MilestoneReview(props: {
  review: ReviewView;
  decisions: DecisionView[];
  rationale: string;
  busy: boolean;
  canDecide: boolean;
  onRationale: (text: string) => void;
  onDecide: (decision: "release" | "request_changes") => void;
  onBlur: (next: EventTarget | null) => void;
}) {
  const { t } = useText();
  return (
    <section
      class="work-review"
      aria-label={t("work.reviewDetails")}
      onFocusOut={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          props.onBlur(event.relatedTarget);
      }}
    >
      <h3>{t("work.criteriaSnapshot")}</h3>
      <p class="work-text">{props.review.criteriaSnapshot}</p>
      <p class="work-text">{props.review.evidenceNote}</p>
      <Field label={t("work.rationale")}>
        <Textarea
          value={props.rationale}
          disabled={props.busy || !props.canDecide}
          onValueChange={(text) => props.onRationale(text)}
        />
      </Field>
      <div class="work-actions">
        <Button disabled={props.busy || !props.canDecide} onClick={() => props.onDecide("release")}>
          {t("work.release")}
        </Button>
        <Button
          variant="ghost"
          disabled={props.busy || !props.canDecide}
          onClick={() => props.onDecide("request_changes")}
        >
          {t("work.requestChanges")}
        </Button>
      </div>
      <h3>{t("work.decisions")}</h3>
      <For each={props.decisions}>
        {(decision) => (
          <p class="work-text">
            {t(decision.decision === "release" ? "work.released" : "work.changesRequested")}: {decision.rationale}
          </p>
        )}
      </For>
    </section>
  );
}
