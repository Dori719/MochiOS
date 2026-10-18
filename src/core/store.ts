/**
 * A ~40 line observable store, standing in for the engine's zustand stores and
 * react-query cache.
 *
 * The extension has no server to fetch from: state lives in SillyTavern's
 * `chat_metadata` and `extension_settings`. A single store keeps every consumer
 * reading the same snapshot, and `useSyncExternalStore` gives React the tearing
 * free subscription it needs.
 */
import { useSyncExternalStore } from 'react';
import type { MochiOsPhoneData, MochiOsSettings } from '../mochi/schema';
import { DEFAULT_MOCHI_OS_SETTINGS, normalizeMochiOsSettings } from '../mochi/schema';
import { getChatId } from '../st/adapter';

/** One archived conversation on the phone. */
export interface MochiThreadRecord {
  id: string;
  /** Contact name for a private thread, group name for a group thread. */
  target: string;
  type: 'private' | 'group';
  /** Canonical YAML: every `<chat_history>` record ever appended to this thread. */
  yaml: string;
  updatedAt: number;
}

/**
 * Where the phone is: the homescreen (null), or an app.
 *
 * This lives in the store rather than in component state so the slash command
 * can navigate the phone without reaching into React.
 */
export interface MochiTarget {
  id: string;
  threadId?: string;
}

export interface MochiState {
  settings: MochiOsSettings;
  phoneData: MochiOsPhoneData | null;
  phoneDataYaml: string;
  threads: MochiThreadRecord[];
  /** The app open over the homescreen, or null when the homescreen is showing. */
  activeApp: MochiTarget | null;
  /** Which thread the phone has open, or null for the homescreen. */
  openThreadId: string | null;
  /** Non-null while an LLM call is in flight. */
  busy: string | null;
  notice: { text: string; kind: 'success' | 'error' | 'info' } | null;
  revision: number;
}

const initialState: MochiState = {
  settings: DEFAULT_MOCHI_OS_SETTINGS,
  phoneData: null,
  phoneDataYaml: '',
  threads: [],
  activeApp: null,
  openThreadId: null,
  busy: null,
  notice: null,
  revision: 0,
};

let state: MochiState = initialState;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getState(): MochiState {
  return state;
}

/** Replace state. `patch` may be a partial object or a function of the current state. */
export function setState(patch: Partial<MochiState> | ((prev: MochiState) => Partial<MochiState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next, revision: state.revision + 1 };
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read a slice of the store, re-rendering only when that slice changes. */
export function useStore<T>(selector: (state: MochiState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initialState),
  );
}

/** Reset to defaults; used when the chat changes and no phone exists yet. */
export function resetStore(): void {
  state = { ...initialState, settings: state.settings };
  emit();
}

export function updateSettings(patch: Partial<MochiOsSettings>): void {
  setState({ settings: normalizeMochiOsSettings({ ...state.settings, ...patch }) });
}

/* ------------------------------------------------------------------ *
 * Compatibility surface for the ported widgets
 * ------------------------------------------------------------------ */

/**
 * The engine's chat store, reduced to the one field the ported private-chat
 * widget reads. Kept as a named export so that component needed no edits.
 */
export function useChatStore<T>(selector: (state: { activeChatId: string | null }) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector({ activeChatId: getChatId() }),
    () => selector({ activeChatId: null }),
  );
}