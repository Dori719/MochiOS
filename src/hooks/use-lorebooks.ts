/**
 * Lorebooks, mapped onto SillyTavern's world info.
 *
 * Mochi OS uses lorebooks for two things: it lists them so the user can see what
 * is attached to the chat, and it folds their entries into the prompt it builds.
 * SillyTavern calls the same idea "world info", so the port exposes world info
 * books through the engine's lorebook hooks.
 */
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ActiveLorebookScan, Lorebook, LorebookEntry } from '../shared';
import { api } from '../lib/api-client';

export const lorebookKeys = {
  all: ['lorebooks'] as const,
  list: () => ['lorebooks', 'list'] as const,
  detail: (id: string) => ['lorebooks', 'detail', id] as const,
  entries: (id: string) => ['lorebooks', 'entries', id] as const,
  scan: (chatId: string | null | undefined) => ['lorebooks', 'scan', chatId ?? ''] as const,
};

/** Every world info book SillyTavern has. */
export function useLorebooks() {
  return useQuery<Lorebook[]>({
    queryKey: lorebookKeys.list(),
    queryFn: () => api.get<Lorebook[]>('/lorebooks'),
    staleTime: 5 * 60_000,
  });
}

/** The entries SillyTavern would insert for this chat. */
export function useActiveLorebookEntries(chatId: string | null, enabled = true) {
  return useQuery<ActiveLorebookScan>({
    queryKey: lorebookKeys.scan(chatId),
    queryFn: () => api.get<ActiveLorebookScan>(`/lorebooks/scan/${encodeURIComponent(String(chatId))}`),
    enabled: Boolean(chatId) && enabled,
    staleTime: 60_000,
  });
}

/** The entries of several books at once, flattened. */
export function useEntriesAcrossLorebooks(ids: string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: lorebookKeys.entries(id),
      queryFn: () => api.get<{ entries: LorebookEntry[] }>(`/lorebooks/${encodeURIComponent(id)}/entries`),
      enabled: Boolean(id),
      staleTime: 5 * 60_000,
    })),
  });

  // A new array each render would re-run every consumer's prompt assembly, so
  // the flattened list is keyed off the query results themselves.
  const signature = results.map((result) => result.dataUpdatedAt).join('|');
  const entries = useMemo(
    () => results.flatMap((result) => result.data?.entries ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  return {
    entries,
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    isError: results.some((result) => result.isError),
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}
