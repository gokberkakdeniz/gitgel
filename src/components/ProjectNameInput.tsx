import { useEffect, useRef, useState } from 'react';
import { renameProject } from '../lib/ipc';
import { nameConflict } from '../lib/projects';
import type { ProjectConfig } from '../lib/types';
import { useData } from '../state/data';

/**
 * In-place rename of a project name (sidebar row, Review title): ↵ saves; Esc or leaving the field
 * cancels. A name conflict sets `aria-invalid`, with the message as its tooltip. Not an `Input`:
 * the host styles it (EditableTitle, the sidebar row) so the name does not move.
 */
export function ProjectNameInput({
  project,
  className,
  width,
  onDone,
}: {
  project: ProjectConfig;
  className?: string;
  /** Keeps the width of the title it replaces. */
  width?: number;
  onDone: () => void;
}) {
  const config = useData((s) => s.config);
  const [value, setValue] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Text selected, ready to type over.
  useEffect(() => {
    requestAnimationFrame(() => input.current?.select());
  }, []);

  const conflict = nameConflict(config, value, project.id);
  const canSave = !!value.trim() && !conflict && !saving;
  const save = async () => {
    if (value.trim() === project.name) return onDone();
    setSaving(true);
    try {
      await renameProject(project.id, value.trim());
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      ref={input}
      autoFocus
      aria-label="Project name"
      className={className}
      style={width ? { width } : undefined}
      spellCheck={false}
      autoComplete="off"
      aria-invalid={!!conflict}
      title={conflict ? `A project named “${conflict}” already exists` : undefined}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => !saving && onDone()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && canSave) void save();
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
    />
  );
}
