/**
 * Settings access for the ported widgets.
 *
 * The engine kept Mochi OS settings in its own `app-settings` table with a
 * react-query hook in front of it. SillyTavern has `extension_settings`, so the
 * hook shapes are reproduced here and the storage swapped underneath.
 */
import { useMemo } from 'react';
import type { MochiOsSettings } from '../mochi/schema';
import { DEFAULT_MOCHI_OS_SETTINGS, normalizeMochiOsSettings } from '../mochi/schema';
import { readSettings, writeSettings } from '../st/adapter';
import { getState, setState, updateSettings, useStore } from './store';

const KEY = 'settings';

/** Load persisted settings into the store. Called once during init. */
export function hydrateSettings(): void {
  const stored = readSettings()[KEY];
  setState({ settings: normalizeMochiOsSettings(stored) });
}

/**
 * Persist a settings patch.
 *
 * Normalizes first so an invalid intermediate value can never be written, then
 * writes both to the store (for this session) and to SillyTavern's settings blob
 * (for every later session).
 */
export function persistSettings(patch: Partial<MochiOsSettings>): void {
  updateSettings(patch);
  writeSettings({ [KEY]: getState().settings });
}

/**
 * The engine's `useMochiOsSettings` query hook.
 *
 * Returns the query object shape because the ported widgets destructure
 * `{ data }` from it.
 */
export function useMochiOsSettings(): { data: MochiOsSettings } {
  const settings = useStore((state) => state.settings);
  return useMemo(() => ({ data: settings || DEFAULT_MOCHI_OS_SETTINGS }), [settings]);
}

/**
 * Custom sticker library, which the engine served from its own uploads.
 *
 * SillyTavern has no equivalent, so the map is empty and sticker bubbles fall
 * back to their text form — which is what the widgets already do when a sticker
 * name is not in the map.
 */
export function useConversationCustomStickers(): {
  map: Map<string, string>;
  isLoading: boolean;
} {
  return useMemo(() => ({ map: new Map<string, string>(), isLoading: false }), []);
}