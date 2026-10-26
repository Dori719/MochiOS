/**
 * LLM calls for the Mochi OS port.
 *
 * The engine's `POST /api/mochios-data/:id/generate` resolved a connection and
 * ran the provider on its server. SillyTavern generates in the browser, so the
 * default goes through `generateRaw`; named profiles use the host's request service.
 */
import { activeChatId, st } from './adapter';
import { profileRequestService, selectedConnectionProfileId } from './connections';
import { fitMochiPromptToContext, getMochiTokenLimits } from './context-budget';
import { protectTemplateBraces, restoreTemplateBraces } from './prompt-template';
export { protectTemplateBraces, restoreTemplateBraces } from './prompt-template';

const MAX_RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_BACKOFF_BASE_MS = 2_000;
const RATE_LIMIT_BACKOFF_CAP_MS = 60_000;

/** Rate limits read differently per backend, so match on status and on message. */
function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 429 || status === 529) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return /\b(rate[ -]?limit|too many requests|quota|429|529)\b/.test(message)
    || Boolean(error instanceof Error && error.cause && isRateLimitError(error.cause));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lets a cancelled generation stop being retried. */
export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

export interface GenerateOptions {
  /** Polled between attempts so a stopped generation does not keep retrying. */
  isCancelled?: () => boolean;
  responseLength?: number;
  chatId?: string;
  signal?: AbortSignal;
}

/**
 * Send assembled messages to the active connection and return the raw output.
 *
 * Retries rate limits with exponential backoff, as the engine did: a phone reply
 * is a small request the user is waiting on, and a 429 is usually short-lived.
 */
export async function generateMochiOutput(
  messages: Array<{ role: string; content: string; name?: string }>,
  options: GenerateOptions = {},
): Promise<string> {
  const isCancelled = () => Boolean(options.signal?.aborted || options.isCancelled?.());
  const chatId = options.chatId ?? activeChatId();
  const profileId = selectedConnectionProfileId();
  const assertChat = () => {
    if (!chatId || activeChatId() !== chatId) throw new Error('Mochi OS: the selected SillyTavern chat changed');
  };

  for (let attempt = 0; ; attempt += 1) {
    if (isCancelled()) throw new AbortedError();
    assertChat();
    try {
      const limits = getMochiTokenLimits(options.responseLength, profileId);
      const bounded = await fitMochiPromptToContext(messages, limits);
      if (isCancelled()) throw new AbortedError();
      assertChat();
      const protectedMessages = bounded.map((message) => ({ ...message, content: protectTemplateBraces(message.content) }));
      const responseLength = limits.responseLength;
      let raw: string;
      if (profileId) {
        const service = await profileRequestService();
        assertChat();
        const response = await service.sendRequest(profileId, protectedMessages, responseLength, {
          stream: false,
          extractData: true,
          includePreset: true,
          signal: options.signal,
        });
        raw = response.content;
      } else {
        raw = await st().generateRaw({
          api: limits.api,
          prompt: protectedMessages,
          responseLength,
          trimNames: false,
        });
      }
      if (isCancelled()) throw new AbortedError();
      assertChat();
      return restoreTemplateBraces(raw ?? '');
    } catch (error) {
      if (isCancelled()) throw new AbortedError();
      assertChat();
      if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      const delay = Math.min(RATE_LIMIT_BACKOFF_BASE_MS * 2 ** attempt, RATE_LIMIT_BACKOFF_CAP_MS);
      await wait(delay);
    }
  }
}
