import { ctx, st } from './adapter';
import { selectedConnectionProfileId } from './connections';
import { protectTemplateBraces } from './prompt-template';
import { estimateTextTokens } from '../shared/token-estimator';

export interface MochiBudgetMessage { role: string; content: string; name?: string }
export interface MochiTokenLimits {
  api: string;
  profileId: string | null;
  maxContext: number;
  responseLength: number;
  promptBudget: number;
  tokenizerKey: string;
}

function positive(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.floor(number);
  }
}

/** Read the same live limits ST uses. A saved profile can have its own preset;
 * reading it never switches or modifies the user's active API/settings. */
export function getMochiTokenLimits(requestedResponseLength?: number, profileId = selectedConnectionProfileId()): MochiTokenLimits {
  const context = ctx();
  const service = context.ConnectionManagerRequestService;
  const profile = profileId ? service?.getProfile?.(profileId) || service?.getSupportedProfiles?.().find((item: any) => item.id === profileId) : undefined;
  const api = (profile?.api ? context.CONNECT_API_MAP?.[profile.api]?.selected : undefined)
    || (profile?.api === 'openai' || profile?.api === 'textgenerationwebui' ? profile.api : undefined)
    || context.mainApi || 'openai';
  const preset = profile?.preset ? context.getPresetManager?.(api)?.getCompletionPresetByName?.(profile.preset) : undefined;
  const settings = context.chatCompletionSettings || {};
  const maxContext = positive(
    api === 'openai' ? preset?.openai_max_context : preset?.truncation_length ?? preset?.max_context_length ?? preset?.max_context,
    !profileId ? st().getMaxContextTokens?.() : undefined,
    api === 'openai' ? settings.openai_max_context : context.maxContext,
    context.maxContext,
  ) || 8192;
  const configuredResponse = positive(
    api === 'openai' ? preset?.openai_max_tokens : preset?.max_new_tokens ?? preset?.max_tokens ?? preset?.max_length ?? preset?.genamt,
    !profileId ? st().getMaxResponseTokens?.() : undefined,
    api === 'openai' ? settings.openai_max_tokens : st().amount_gen,
  ) || 4096;
  const responseLength = Math.min(positive(requestedResponseLength) || configuredResponse, configuredResponse);
  const promptBudget = maxContext - responseLength;
  if (promptBudget <= 3) throw new Error('Mochi OS: the configured response length and prompt exceed the selected context size. Reduce the response length or increase SillyTavern’s context limit.');
  const textSettings = context.textCompletionSettings || {};
  const textModels = Object.entries(textSettings).filter(([key]) => /(?:^model$|_model$)/.test(key)).sort(([a], [b]) => a.localeCompare(b));
  return {
    api, profileId, maxContext, responseLength, promptBudget,
    tokenizerKey: JSON.stringify([api, profileId, profile?.model, context.mainApi, settings.chat_completion_source,
      context.getTokenizerModel?.(), context.powerUserSettings?.tokenizer, textSettings.type, textModels,
      context.getTextGenServer?.(), st().online_status]),
  };
}

// Bounded cache: repeatedly sending the same preset/history must not dispatch a
// tokenizer request for every old turn. Changing model/tokenizer changes the key.
const tokenCache = new Map<string, { tokenizer: unknown; cost: Promise<number> }>();
let cachedCharacters = 0;
function forgetTokens(key: string): void {
  if (tokenCache.delete(key)) cachedCharacters -= key.length;
}
async function countText(text: string, limits: MochiTokenLimits): Promise<number> {
  const tokenizer = ctx().getTokenCountAsync;
  const key = `${limits.tokenizerKey}\n${text}`;
  const existing = tokenCache.get(key);
  if (existing && existing.tokenizer === tokenizer) {
    tokenCache.delete(key); tokenCache.set(key, existing);
    return existing.cost;
  }
  const cost = Promise.resolve().then(async () => {
    const count = Number(typeof tokenizer === 'function' ? await tokenizer(text) : estimateTextTokens(text));
    if (!Number.isFinite(count) || count < 0) throw new Error('Mochi OS: SillyTavern returned an invalid token count.');
    return Math.ceil(count);
  });
  const entry = { tokenizer, cost };
  forgetTokens(key);
  tokenCache.set(key, entry);
  cachedCharacters += key.length;
  while (tokenCache.size > 512 || cachedCharacters > 2_000_000) forgetTokens(tokenCache.keys().next().value!);
  try { return await cost; }
  catch (error) { if (tokenCache.get(key) === entry) forgetTokens(key); throw error; }
}

export async function countMochiMessageTokens(message: MochiBudgetMessage, limits: MochiTokenLimits): Promise<number> {
  return await countText(protectTemplateBraces(message.content) + (message.name || ''), limits) + 4;
}

type Candidate = { kind: 'history' } | { kind: 'example'; collection: MochiBudgetMessage[]; pinned: boolean };
const candidates = new WeakMap<object, Candidate>();

/** These tags exist only in memory, never in saved transcripts or API payloads. */
export function markMochiBudgetCandidates(history: Iterable<MochiBudgetMessage>, examples: MochiBudgetMessage[][], pinned: boolean): void {
  for (const message of history) candidates.set(message, { kind: 'history' });
  for (const collection of examples) for (const message of collection) candidates.set(message, { kind: 'example', collection, pinned });
}

async function promptCost(messages: MochiBudgetMessage[], limits: MochiTokenLimits): Promise<number> {
  const protectedMessages = messages.map((message) => ({ ...message, content: protectTemplateBraces(message.content) }));
  const context = ctx();
  const service = context.ConnectionManagerRequestService;
  let formatted: string | MochiBudgetMessage[];
  if (limits.profileId) {
    const profile = service?.getProfile?.(limits.profileId);
    const instruct = profile?.instruct && context.getPresetManager?.('instruct')?.getCompletionPresetByName?.(profile.instruct);
    // The profile service uses basic text joining when no instruct preset is
    // available. Its constructPrompt helper otherwise falls back to the active
    // instruct settings, which would count a different prompt than sendRequest.
    formatted = limits.api === 'openai' ? protectedMessages
      : instruct && typeof service?.constructPrompt === 'function' ? service.constructPrompt(protectedMessages, limits.profileId)
      : protectedMessages.map((message) => message.content).join('\n\n');
  } else {
    formatted = st().createRawPrompt?.(protectedMessages, limits.api, false, false, '', '') ?? protectedMessages;
  }
  if (typeof formatted === 'string') return await countText(formatted, limits) + 3;
  const counts = await Promise.all((formatted as MochiBudgetMessage[]).map((message) => countText(message.content + (message.name || ''), limits)));
  return 3 + counts.reduce((total, cost) => total + cost + 4, 0);
}

/** Final boundary check includes ST's text-completion/instruct formatting and
 * refreshed lore. Only marked history/whole examples can be removed; a task or
 * format guide that cannot fit fails before any provider request is sent. */
export async function fitMochiPromptToContext<T extends MochiBudgetMessage>(messages: T[], limits: MochiTokenLimits): Promise<T[]> {
  if (await promptCost(messages, limits) <= limits.promptBudget) return [...messages];
  const history: MochiBudgetMessage[][] = [];
  const unpinned: MochiBudgetMessage[][] = [];
  const pinned: MochiBudgetMessage[][] = [];
  const seen = new Set<MochiBudgetMessage[]>();
  for (const message of messages) {
    const tag = candidates.get(message);
    if (tag?.kind === 'history') history.push([message]);
    else if (tag?.kind === 'example' && !seen.has(tag.collection)) {
      seen.add(tag.collection);
      (tag.pinned ? pinned : unpinned).push(tag.collection);
    }
  }
  // Newest real turns win over unpinned examples. The first example collection
  // has priority, as in preset assembly, and a collection is never split.
  const groups = [...unpinned.reverse(), ...history, ...pinned.reverse()];
  const removalOrder = new Map<MochiBudgetMessage, number>();
  groups.forEach((group, index) => group.forEach((message) => removalOrder.set(message, index + 1)));
  const afterRemoving = (count: number) => messages.filter((message) => (removalOrder.get(message) ?? Infinity) > count);
  let selected = afterRemoving(groups.length);
  if (!groups.length || await promptCost(selected, limits) > limits.promptBudget) {
    throw new Error('Mochi OS: the preset, format guide, and current task exceed the selected context size. Increase SillyTavern’s context limit or shorten the preset.');
  }
  // Counting a formatted TC string once per removed turn is quadratic. Find
  // a fitting suffix with logarithmically many full tokenizer requests instead.
  let tooLarge = 0;
  let fits = groups.length;
  while (fits - tooLarge > 1) {
    const count = Math.floor((fits + tooLarge) / 2);
    const trial = afterRemoving(count);
    if (await promptCost(trial, limits) <= limits.promptBudget) {
      fits = count;
      selected = trial;
    } else tooLarge = count;
  }
  return selected;
}
