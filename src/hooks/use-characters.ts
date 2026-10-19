/**
 * Character cards and user personas, read from SillyTavern.
 *
 * The engine's character record keyed macro data off `data`, so the port maps a
 * SillyTavern card to the same shape: SillyTavern stores the v2 card body in
 * `character.data`, which is exactly what the engine's card parsers read.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Character, Persona } from '../shared';
import { api } from '../lib/api-client';

export const characterKeys = {
  all: ['characters'] as const,
  list: () => ['characters', 'list'] as const,
  personas: () => ['characters', 'personas'] as const,
};

/** Every character card SillyTavern knows about. */
export function useCharacters(options: boolean | { enabled?: boolean } = true) {
  const enabled = typeof options === 'boolean' ? options : (options.enabled ?? true);
  return useQuery<Character[]>({
    queryKey: characterKeys.list(),
    queryFn: () => api.get<Character[]>('/characters'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The user's personas. */
export function usePersonas() {
  return useQuery<Persona[]>({
    queryKey: characterKeys.personas(),
    queryFn: () => api.get<Persona[]>('/characters/personas/list'),
    staleTime: 60_000,
  });
}

/** Rename a persona — what Mochi OS stores as the profile nickname. */
export function useUpdatePersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Record<string, any>) =>
      api.patch<Persona>(`/characters/personas/${encodeURIComponent(id)}`, patch),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: characterKeys.personas() });
    },
  });
}
