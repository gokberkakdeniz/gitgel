// Review's list column hidden (SPEC §5 "Hidden list column"): a rail with a dot for Changes and
// each of the branch's own commits, their files on hover; ⌥⌘B and the palette's Hide / Show Commits.
import { useEffect, useRef, useState } from 'react';
import { useCommandSource } from '../../commands/registry';
import { IconButton } from '../../components/IconButton';
import { SidebarIcon } from '../../components/icons';
import { Popover } from '../../components/Popover';
import { t } from '../../i18n';
import type { FileChange } from '../../lib/types';
import { useUi } from '../../state/ui';
import { DiffStat, FileRow } from './parts';
import parts from './parts.module.css';
import styles from './rail.module.css';

const toggle = () => useUi.getState().setReviewListHidden(!useUi.getState().reviewListHidden);

/** Whether the list column is hidden; ⌥⌘B and the palette toggle it. Listed in lib/shortcuts.ts. */
function useListHidden(): boolean {
  const hidden = useUi((s) => s.reviewListHidden);
  useEffect(() => {
    // ⌥ turns letters into other characters, so the physical key is checked.
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.altKey || e.shiftKey || e.ctrlKey || e.code !== 'KeyB') return;
      if (useUi.getState().modalCount > 0) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useCommandSource(() => ({
    commands: [
      {
        id: 'review:list',
        title: t(hidden ? 'review.showList' : 'review.hideList'),
        group: t('cmd.groupReview'),
        keys: '⌥⌘B',
        run: toggle,
      },
    ],
  }));
  return hidden;
}

const RAIL_WIDTH = 36;

/** Review's list column: hidden to the rail (`hidden`, remembered), and while its edge is dragged
 * its width following the pointer (`live`; null otherwise), the rail shown under 36px (`rail`). */
export function useListColumn() {
  const hidden = useListHidden();
  const [live, setLive] = useState<number | null>(null);
  const rail = live !== null ? live < RAIL_WIDTH : hidden;
  return { hidden, rail, live, setLive };
}

/** A dot: Changes or one of the branch's own commits. */
export interface RailRow {
  key: string;
  wip?: boolean;
  /** A commit from another branch (stacked). */
  from?: boolean;
  /** The popup's first line (the subject, "Changes") and second (SHA · author · age). */
  title: string;
  meta: string;
}

/** A row's files in the popup, in sections (Changes' Staged / Unstaged); undefined while loading.
 * `id` is what the diff opens it by. */
export type RailFiles = { label?: string; files: { id: string; file: FileChange }[] }[] | undefined;

export function ListRail({
  rows = [],
  current = null,
  shownFile = null,
  selected = [],
  filesOf,
  onHover,
  onPick,
  onFile,
  onScroll,
  ref,
}: {
  ref?: React.Ref<HTMLElement>;
  rows?: RailRow[];
  current?: string | null;
  /** The file the diff shows (of `current`). */
  shownFile?: string | null;
  /** Several rows picked with ⌘ / ⇧-click, tinted. */
  selected?: string[];
  filesOf?: (key: string) => RailFiles;
  /** The pointer rests on a dot: its files are fetched. */
  onHover?: (key: string) => void;
  onPick?: (key: string, e: React.MouseEvent) => void;
  onFile?: (key: string, id: string) => void;
  onScroll?: (e: React.UIEvent<HTMLElement>) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  // The popup: after the pointer rests 300ms on a dot (at once while one is open), till it has
  // been off the dot and the popup for 150ms.
  const [pop, setPop] = useState<{ key: string; el: HTMLElement } | null>(null);
  const opening = useRef<number | undefined>(undefined);
  const closing = useRef<number | undefined>(undefined);
  const enter = (key: string, el: HTMLElement) => {
    window.clearTimeout(closing.current);
    window.clearTimeout(opening.current);
    onHover?.(key);
    opening.current = window.setTimeout(() => setPop({ key, el }), pop ? 0 : 300);
  };
  const stay = () => window.clearTimeout(closing.current);
  const leave = () => {
    window.clearTimeout(opening.current);
    window.clearTimeout(closing.current);
    closing.current = window.setTimeout(() => setPop(null), 150);
  };
  useEffect(
    () => () => {
      window.clearTimeout(opening.current);
      window.clearTimeout(closing.current);
    },
    [],
  );
  const popRow = pop && rows.find((r) => r.key === pop.key);
  const sections = popRow ? filesOf?.(popRow.key) : undefined;
  const all = sections?.flatMap((s) => s.files.map((f) => f.file)) ?? [];

  return (
    <nav ref={ref} className={styles.rail} aria-label={t('history.commitsList')}>
      <IconButton
        className={styles.show}
        aria-label={t('review.showList')}
        title={t('review.showListHint')}
        aria-expanded={false}
        onClick={() => useUi.getState().setReviewListHidden(false)}
      >
        <SidebarIcon size={16} />
      </IconButton>
      <div ref={list} className={styles.dots} onScroll={onScroll}>
        {rows.map((r) => {
          const on = selected.length === 0 && current === r.key;
          const box = [styles.row, selected.includes(r.key) && styles.rowPicked].filter(Boolean).join(' ');
          const mark = [styles.mark, r.wip && styles.wip, r.from && styles.from, on && styles.markOn]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={r.key}
              type="button"
              className={box}
              aria-pressed={on}
              aria-label={r.title}
              onClick={(e) => onPick?.(r.key, e)}
              onMouseEnter={(e) => enter(r.key, e.currentTarget)}
              onMouseLeave={leave}
            >
              <span className={mark} />
            </button>
          );
        })}
      </div>
      {pop && popRow && (
        <Popover
          anchorRect={pop.el.getBoundingClientRect()}
          anchor={pop.el}
          side="right"
          width={340}
          onClose={() => setPop(null)}
          onMouseEnter={stay}
          onMouseLeave={leave}
        >
          <div className={styles.pop}>
            <div className={styles.popHead}>
              <span className={styles.popTitle}>{popRow.title}</span>
              <span className={styles.popMeta}>
                <span className={styles.popWhere}>{popRow.meta}</span>
                {sections && <DiffStat add={sum(all, 'add')} del={sum(all, 'del')} />}
              </span>
            </div>
            <div className={styles.popFiles}>
              {sections?.map((s) => (
                <div key={s.label ?? ''} className={parts.fileRowsFlat}>
                  {s.label && <div className={styles.popLabel}>{s.label}</div>}
                  {s.files.map(({ id, file }) => (
                    <FileRow
                      key={id}
                      file={file}
                      on={popRow.key === current && id === shownFile}
                      folder={null}
                      onClick={() => {
                        setPop(null);
                        onFile?.(popRow.key, id);
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </nav>
  );
}

const sum = (files: FileChange[], k: 'add' | 'del') => files.reduce((n, f) => n + (f[k] ?? 0), 0);
