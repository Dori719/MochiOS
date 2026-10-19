/**
 * The one query cache the whole extension uses.
 *
 * Mochi OS in the overlay and the transcript widgets inside chat messages read
 * the same things — the open chat, its phone data, the characters, the settings.
 * Sharing a cache means opening the phone does not re-fetch what a widget has
 * just loaded, and a change made in one place is visible in the other.
 */
import { QueryClient } from '@tanstack/react-query';

let client: QueryClient | null = null;

export function mochiQueryClient(): QueryClient {
  client ??= new QueryClient({
    defaultOptions: {
      queries: {
        // SillyTavern is local, so a failed read is a real failure; retrying it
        // three times only delays the error message.
        retry: false,
        refetchOnWindowFocus: false,
        // Mochi OS asks for the same chat, characters and lorebooks repeatedly
        // while a screen renders. A short stale window collapses those into one
        // request without hiding a change for long.
        staleTime: 5_000,
      },
    },
  });
  return client;
}

/** Drops every cached read, without forgetting the cache itself. */
export function invalidateMochiQueries(): void {
  void client?.invalidateQueries();
}
