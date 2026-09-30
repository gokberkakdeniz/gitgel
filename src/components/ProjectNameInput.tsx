import { useEffect, useRef, useState } from 'react';
import { renameProject } from '../lib/ipc';
import { nameConflict } from '../lib/projects';
import type { ProjectConfig } from '../lib/types';
import { useData } from '../state/data';
import { TextInput } from './TextInput';

/**
 * In-place rename of a project name (sidebar row, Review title): ↵ saves; Esc or leaving the field
 * cancels. A name conflict turns it danger, with the message as its tooltip.
 */
export function ProjectNameInput({
  project,
  className,
  onDone,
}: {
  project: ProjectConfig;
  className?: string;
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
    <TextInput
      ref={input}
      autoFocus
      aria-label="Project name"
      className={className}
      invalid={!!conflict}
      title={conflict ? `A project named “${conflict}” already exists` : '↵ save · esc cancel'}
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
