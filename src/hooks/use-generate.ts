/**
 * Roleplay generation, driven through SillyTavern.
 *
 * The engine's `useGenerate` ran its own pipeline: it resolved a connection,
 * assembled the prompt and streamed from the provider. SillyTavern already owns
 * all of that, so a Mochi OS request becomes an ordinary SillyTavern turn — the
 * user's marker message is appended and SillyTavern generates the reply, which
 * lands in the chat as a normal message that the Mochi OS parsers then read.
 */
import { useCallback } from 'react';
import { ctx, insertMessage, st } from '../st/adapter';

export interface GenerateOptions {
  chatId: string;
  connectionId?: string | null;
  /** A marker message to append before generating (a voice note, a transfer). */
  userMessage?: string;
  /** Ask for another reply to an existing message. */
  regenerateMessageId?: string;
  presetId?: string;
  [key: string]: unknown;
}

export interface GenerateResult {
  rawOutput?: string;
}

export function useGenerate() {
  const generate = useCallback(async (options: GenerateOptions): Promise<void> => {
    const context = ctx();
    if (typeof context.generate !== 'function') return;

    if (options.regenerateMessageId) {
      // SillyTavern's swipe regeneration acts on the newest message. Asking for
      // another reply to an arbitrary earlier turn is what Mochi OS's own
      // regenerate path does, by regenerating the phone turn that owns it.
      await context.generate('swipe');
      return;
    }

    if (options.userMessage) {
      insertMessage({ role: 'user', content: String(options.userMessage) });
    }
    await context.generate('normal');
  }, []);

  const stop = useCallback(() => {
    try {
      ctx().stopGeneration?.();
    } catch {
      // No generation is running, or the host is gone.
    }
  }, []);

  return { generate, stop, isGenerating: false };
}
