import { DiffEditor } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readFilePair } from '../lib/ipc';
import type { DiffMode, FileChange } from '../lib/types';
import { useInvoke } from '../lib/useInvoke';
import styles from './DiffView.module.css';
import { languageForPath } from './language';
import { monacoReady } from './setup';

const OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: false,
  renderIndicators: true,
  hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3 },
  fontFamily: 'JetBrains Mono',
  fontSize: 12,
  lineHeight: 20,
  minimap: { enabled: false },
  renderOverviewRuler: false,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  contextmenu: false,
};

interface Props {
  repoId: string;
  worktreePath: string | null;
  change: FileChange;
  mode: DiffMode;
}

/** Side-by-side diff of one file. The editor stays mounted; only its content changes. */
export function DiffView({ repoId, worktreePath, change, mode }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void monacoReady.then(() => setReady(true));
  }, []);

  // The wrapper would dispose the models before the editor lets go of them, which Monaco
  // reports as an error. It keeps them instead; here the editor is detached first.
  const mounted = useRef<{ editor: monaco.editor.IStandaloneDiffEditor; models: monaco.editor.ITextModel[] } | null>(
    null,
  );
  useEffect(
    () => () => {
      const m = mounted.current;
      if (!m) return;
      try {
        m.editor.setModel(null);
      } catch {
        // Already disposed.
      }
      m.models.forEach((model) => model.dispose());
    },
    [],
  );

  const changeKey = `${change.path}\u0000${change.oldOid}\u0000${change.newOid}`;
  const { data } = useInvoke(
    () => readFilePair(repoId, worktreePath, change),
    [repoId, worktreePath, changeKey, mode],
    // Blob contents never change; only a working-tree side needs refetching.
    { repoIds: change.newOid === null ? [repoId] : [] },
  );
  const language = useMemo(() => languageForPath(change.path, monaco.languages.getLanguages()), [change.path]);

  const message = data?.binary
    ? 'Binary file not shown'
    : data?.tooLarge
      ? 'File is too large to show (over 1 MB)'
      : null;

  return (
    <div className={styles.view}>
      {ready && (
        <DiffEditor
          theme="gitgel"
          language={language}
          original={message ? '' : (data?.original ?? '')}
          modified={message ? '' : (data?.modified ?? '')}
          options={OPTIONS}
          loading={null}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          onMount={(editor) => {
            const model = editor.getModel();
            mounted.current = { editor, models: model ? [model.original, model.modified] : [] };
          }}
        />
      )}
      {message && <div className={styles.message}>{message}</div>}
    </div>
  );
}
