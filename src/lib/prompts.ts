// Settings › Prompts (M6): "Do not show this message again" in a confirmation turns its box off.
import { useData } from '../state/data';
import { updateSettings } from './ipc';
import type { Prompts } from './types';

export function stopAsking(prompt: keyof Prompts): void {
  const settings = useData.getState().config?.settings;
  if (settings) void updateSettings({ ...settings, prompts: { ...settings.prompts, [prompt]: false } });
}
