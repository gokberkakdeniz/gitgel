import { useData } from '../state/data';
import { selectRoute, useNav } from '../state/nav';
import { useUi } from '../state/ui';
import { untitledName } from './projects';
import type { EntryRef } from './types';

/** Opens a draft project page (flows C and H2) with `entries` and the title in rename mode. */
export function startDraftProject(entries: EntryRef[]): void {
  const nav = useNav.getState();
  const route = selectRoute(nav);
  const onDraft = route.name === 'project' && route.projectId === 'draft';
  const returnTo = onDraft ? (useUi.getState().draftProject?.returnTo ?? null) : route;
  useUi.getState().setDraftProject({ name: untitledName(useData.getState().config), entries, returnTo });
  if (!onDraft) nav.push({ name: 'project', projectId: 'draft' });
}
