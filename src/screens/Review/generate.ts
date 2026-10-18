// Generate message (SPEC §15): one generation run with its running toast, for the commit form
// and Squash Commits.
import { t } from '../../i18n';
import { onGenerateFinished, providerLabel } from '../../lib/ai';
import type { AppError, CommitProvider, ScriptRun } from '../../lib/types';
import { nameRun, showRunToast, useRuns } from '../../scripts/runs';
import { useUi } from '../../state/ui';

/** Starts the run; `started` gets its id, `ended` is called once it is over (with null when it
 * could not start), `answer` gets the message. A failure shows a failed toast. */
export function generateMessage(
  provider: CommitProvider,
  start: () => Promise<ScriptRun>,
  on: {
    started?: (runId: string) => void;
    ended: (runId: string | null) => void;
    answer: (summary: string, description: string) => void;
  },
): void {
  void start()
    .then((run) => {
      on.started?.(run.runId);
      nameRun(
        run.runId,
        t('history.genWith', { provider: providerLabel(provider) }),
        t('history.generating', { provider: providerLabel(provider) }),
      );
      useRuns.getState().put(run);
      showRunToast(useRuns.getState().runs[run.runId]);
      const off = onGenerateFinished(run.runId, (r) => {
        off();
        on.ended(run.runId);
        // Its running toast is done, whatever took its place stays.
        const ui = useUi.getState();
        if (ui.toast?.owner === run.runId) ui.dismissToast();
        if (r.cancelled) return;
        if (r.error || !r.summary) {
          ui.showToast({ status: 'failed', message: r.error ?? t('history.noMessage') });
          return;
        }
        on.answer(r.summary, r.description ?? '');
      });
    })
    .catch((e: unknown) => {
      on.ended(null);
      useUi.getState().showToast({ status: 'failed', message: (e as AppError).message });
    });
}
