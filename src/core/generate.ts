/**
 * LLM calls for Mochi OS.
 *
 * Replaces the engine's `POST /api/mochios-data/:id/generate`, which resolved a
 * connection and ran the provider server-side. SillyTavern generates in the
 * browser, so the call goes through `generateRaw` on the active connection.
 */
import { runRawGeneration } from '../st/adapter';

/**
 * SillyTavern substitutes its macros over every message it sends, and one of
 * those macros is `{{user}}`. The archive format depends on `{{user}}: true`
 * staying literal, and the format guides are full of `{{Time}}`-style
 * placeholders that must survive untouched too, so the opening braces are
 * swapped for a guillemet on the way out and restored on the way back.
 *
 * Only `{{` is escaped: leaving `}}` intact means no macro can match, and a
 * single-character swap is far less likely to collide with generated prose than
 * a paired one.
 */
const OPEN_BRACE = '«';

export function protectTemplateBraces(text: string): string {
  return text.replace(/\{\{/g, OPEN_BRACE);
}

export function restoreTemplateBraces(text: string): string {
  return text.split(OPEN_BRACE).join('{{');
}

const MAX_RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_BACKOFF_BASE_MS = 2_000;
const RATE_LIMIT_BACKOFF_CAP_MS = 60_000;

/** Rate limits read differently per backend, so match on status and on message. */
function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 429 || status === 529) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return /\b(rate[ -]?limit|too many requests|quota|429|529)\b/.test(message);
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

/**
 * Send the assembled messages and return the model's raw output.
 *
 * Retries rate limits with exponential backoff, as the engine did, because a
 * phone reply is a small request the user is waiting on and a 429 is usually
 * short-lived. `isCancelled` is polled between attempts so a stopped generation
 * does not keep retrying in the background.
 */
export async function generateMochiOutput(
  messages: Array<{ role: string; content: string }>,
  isCancelled: () => boolean = () => false,
): Promise<string> {
  const protectedMessages = messages.map((message) => ({
    role: message.role,
    content: protectTemplateBraces(message.content),
  }));

  for (let attempt = 0; ; attempt += 1) {
    if (isCancelled()) throw new AbortedError();
    try {
      const raw = await runRawGeneration(protectedMessages);
      if (isCancelled()) throw new AbortedError();
      return restoreTemplateBraces(raw ?? '');
    } catch (error) {
      if (isCancelled()) throw new AbortedError();
      if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      const delay = Math.min(RATE_LIMIT_BACKOFF_BASE_MS * 2 ** attempt, RATE_LIMIT_BACKOFF_CAP_MS);
      await wait(delay);
    }
  }
}