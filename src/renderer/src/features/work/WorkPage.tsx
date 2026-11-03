import { WorkPlanning } from "@openbot/ui/features/work/WorkPlanning";
import { onSettled } from "solid-js";
import { useWork } from "./work-context";

export function WorkPage() {
  const work = useWork();
  onSettled(() => {
    void work.availability();
  });
  return (
    <WorkPlanning
      local={work.state.local}
      stale={work.state.stale}
      admitted={work.state.session !== null}
      availability={work.state.availability}
      busy={work.state.busy}
      loading={work.state.loading}
      error={work.state.error}
      notice={work.state.notice}
      conflict={work.state.conflict}
      archived={work.state.archived}
      projects={work.state.projects.items}
      project={work.state.project}
      milestones={work.state.milestones.items}
      milestone={work.state.milestone}
      tickets={work.state.tickets.items}
      reviews={work.state.reviews.items}
      review={work.state.review}
      drafts={work.state.drafts.items}
      form={work.state.form}
      more={{
        projects: work.state.projects.next !== null,
        milestones: work.state.milestones.next !== null,
        tickets: work.state.tickets.next !== null,
        reviews: work.state.reviews.next !== null,
        drafts: work.state.drafts.next !== null,
      }}
      onEnter={() => void work.enter()}
      onRetry={() => void work.availability()}
      onStop={(id) => void work.stop(id)}
      onSelectProject={(project) => void work.selectProject(project)}
      onSelectMilestone={(milestone) => void work.selectMilestone(milestone)}
      onSelectTicket={(ticket) => void work.selectTicket(ticket)}
      onForm={(form) => void work.showForm(form)}
      onChange={work.patchForm}
      onSave={() => void work.saveForm()}
      onSaveDraft={() => void work.saveDraft()}
      onDiscardForm={() => void work.discardForm()}
      onArchive={() => void work.archive()}
      onToggleArchive={() => void work.toggleArchiveList()}
      onRefresh={() => void work.refresh()}
      onRetryRevision={work.retryRevision}
      onMore={(list) => void work.refresh(list)}
      onRecover={(draft) => void work.recover(draft)}
      onDiscardDraft={(draft) => void work.discardDraft(draft)}
      onReview={(review) => void work.showReview(review)}
      onRationale={work.rationale}
      onDecide={(decision) => void work.decide(decision)}
    />
  );
}
