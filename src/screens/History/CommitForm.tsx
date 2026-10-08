import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { plural } from '../../lib/format';
import styles from './CommitForm.module.css';

/** The commit form under History's list while Uncommitted is picked (W1a): summary, description
 * and the button; ⌘↵ in either field commits. Locked while the commit (and its hooks) runs. */
export function CommitForm({
  rev,
  summary,
  description,
  files,
  committing,
  blocked,
  onSummary,
  onDescription,
  onCommit,
}: {
  rev: string;
  summary: string;
  description: string;
  /** Files checked. */
  files: number;
  committing: boolean;
  /** Why Commit cannot run besides an empty summary or no files; null when nothing blocks it. */
  blocked: string | null;
  onSummary: (value: string) => void;
  onDescription: (value: string) => void;
  onCommit: () => void;
}) {
  const ready = summary.trim() !== '' && files > 0 && !blocked;
  const submitOnKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !e.metaKey) return;
    e.preventDefault();
    if (ready && !committing) onCommit();
  };
  const why = committing
    ? 'Hooks are running'
    : (blocked ?? (files === 0 ? 'Check at least one file' : summary.trim() === '' ? 'Write a summary' : `Commit to ${rev}`));
  return (
    <form
      aria-label="Commit"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !committing) onCommit();
      }}
    >
      <Input
        size={32}
        value={summary}
        onChange={onSummary}
        placeholder="Summary (required)"
        aria-label="Summary"
        disabled={committing}
        onKeyDown={submitOnKey}
      />
      <textarea
        aria-label="Description"
        placeholder="Description"
        className={styles.description}
        value={description}
        disabled={committing}
        onChange={(e) => onDescription(e.target.value)}
        onKeyDown={submitOnKey}
      />
      <Button
        type="submit"
        variant="primary"
        className={styles.commit}
        icon={committing ? 'spinner' : undefined}
        disabled={!ready || committing}
        title={why}
      >
        {committing ? 'Committing…' : files > 0 ? `Commit ${plural(files, 'file', 'files')}` : 'Commit'}
      </Button>
    </form>
  );
}
