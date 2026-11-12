import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, type AppLocale } from '../../i18n';
import { AddReposSheet } from './AddReposSheet';

const state = vi.hoisted(() => ({
  ui: { addReposSheet: [] as string[] },
  data: { config: { repos: [] as { id: string }[] }, repoVersion: {}, configVersion: 0 },
}));

vi.mock('../../state/ui', () => ({
  useUi: (select: (s: typeof state.ui) => unknown) => select(state.ui),
}));

vi.mock('../../state/data', () => ({
  useData: (select: (s: typeof state.data) => unknown) => select(state.data),
}));

vi.mock('../../components/Modal', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../components/Modal')>(),
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('repository import subtitle', () => {
  const originalLocale = getLocale();
  afterEach(() => setLocale(originalLocale));

  it.each<[AppLocale, boolean, string]>([
    ['en', false, 'Worktree folders resolve to their main repository.'],
    ['en', true, 'Repositories already in Gitgel are skipped.'],
    ['tr', false, 'Çalışma ağacı klasörleri ana depoya çözülür.'],
    ['tr', true, "Gitgel'deki depolar atlanır."],
  ])('shows the selected count in %s with existing repos=%s', (locale, hasRepos, explanation) => {
    setLocale(locale);
    state.data.config.repos = hasRepos ? [{ id: 'existing' }] : [];

    for (const count of [0, 1, 3]) {
      state.ui.addReposSheet = Array.from({ length: count }, (_, i) => `/picked/repo-${i}`);
      const html = renderToStaticMarkup(<AddReposSheet />);
      const selected = locale === 'en'
        ? `${count} ${count === 1 ? 'folder' : 'folders'} selected.`
        : `${count} klasör seçildi.`;
      const escapedExplanation = explanation.replace(/'/g, '&#x27;');

      expect(html).toContain(`${selected} ${escapedExplanation}`);
      expect(html).not.toContain('{$d}');
    }
  });
});
