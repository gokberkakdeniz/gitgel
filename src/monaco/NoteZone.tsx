import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { CheckIcon, NoteIcon, PencilIcon, TrashIcon, UndoIcon } from '../components/icons';
import { Pill } from '../components/Pill';
import { t } from '../i18n';
import styles from './NoteZone.module.css';

/** `Line 2` / `Lines 22–23`. */
export function rangeLabel(from: number, to: number): string {
  return from === to ? t('notes.line', { n: String(to) }) : t('notes.lines', { from: String(from), to: String(to) });
}

/** A saved note under its last line (SPEC §5 Review "Notes"): its lines and text; on hover
 * Resolve (Unresolve), Edit Note and Delete Note. An outdated one quotes the lines it was
 * written on. */
export function NoteCard({
  from,
  to,
  text,
  resolved,
  outdated,
  onResolve,
  onEdit,
  onDelete,
  onLight,
}: {
  from: number;
  to: number;
  text: string;
  resolved: boolean;
  /** Outdated: the lines it was written on. */
  outdated: string[] | null;
  onResolve: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Hovered or focused (its lines are tinted), or no longer. */
  onLight: (on: boolean) => void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = hover || focus;
  const light = useRef(onLight);
  light.current = onLight;
  useEffect(() => {
    light.current(lit);
  }, [lit]);
  useEffect(() => () => light.current(false), []);
  return (
    // Focusable (a click on it lights its lines), but not a tab stop of its own.
    <div
      className={`${styles.card} ${resolved || outdated ? styles.resolved : ''}`}
      tabIndex={-1}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <div className={styles.head}>
        <NoteIcon size={13} className={styles.icon} />
        <span className={styles.range}>{rangeLabel(from, to)}</span>
        {outdated ? (
          <Pill tone="warning" size="sm">
            {t('notes.outdated')}
          </Pill>
        ) : (
          resolved && (
            <Pill tone="neutral" size="sm">
              {t('notes.resolved')}
            </Pill>
          )
        )}
        <span className={styles.grow} />
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.icon22}
            onClick={onResolve}
            aria-label={t(resolved ? 'notes.unresolve' : 'notes.resolve')}
            title={t(resolved ? 'notes.unresolve' : 'notes.resolve')}
          >
            {resolved ? <UndoIcon size={13} /> : <CheckIcon size={13} />}
          </button>
          <button
            type="button"
            className={styles.icon22}
            onClick={onEdit}
            aria-label={t('notes.edit')}
            title={t('notes.edit')}
          >
            <PencilIcon size={13} />
          </button>
          <button
            type="button"
            className={styles.icon22}
            onClick={onDelete}
            aria-label={t('notes.delete')}
            title={t('notes.delete')}
          >
            <TrashIcon size={13} />
          </button>
        </span>
      </div>
      {outdated && (
        <div className={styles.quoteBox}>
          <pre className={styles.quote}>{outdated.join('\n')}</pre>
        </div>
      )}
      <p className={styles.text}>{text}</p>
    </div>
  );
}

/** A note being written or edited: ⌘↵ saves, Esc cancels. */
export function NoteDraft({
  from,
  to,
  initial,
  onSave,
  onCancel,
}: {
  from: number;
  to: number;
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // After the zone is in the editor's layout.
    const id = requestAnimationFrame(() => field.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const save = () => {
    if (text.trim()) onSave(text.trim());
  };
  // ⌘↵ / Esc on the field itself: the zone keeps its keys from the editor and from React's
  // root listener alike.
  const keys = useRef({ save, onCancel, text, editing: initial !== '' });
  keys.current = { save, onCancel, text, editing: initial !== '' };
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        keys.current.save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        keys.current.onCancel();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      className={styles.card}
      aria-label={t('notes.note')}
      // Nothing written yet: a click elsewhere closes it (not leaving the window).
      onBlur={(e) => {
        const form = e.currentTarget;
        if (form.contains(e.relatedTarget as Node | null)) return;
        window.setTimeout(() => {
          if (!document.hasFocus() || form.contains(document.activeElement)) return;
          if (!keys.current.text.trim() && !keys.current.editing) keys.current.onCancel();
        });
      }}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className={styles.head}>
        <NoteIcon size={13} className={styles.icon} />
        <span className={styles.range}>{rangeLabel(from, to)}</span>
      </div>
      <textarea
        ref={field}
        className={styles.field}
        aria-label={t('notes.note')}
        placeholder={t('notes.note')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.buttons}>
        <Button variant="ghost" size={28} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size={28} type="submit" disabled={!text.trim()} title={t('notes.saveHint')}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
