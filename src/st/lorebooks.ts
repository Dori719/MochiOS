/** Map explicit SillyTavern assignments, never the order of its installed library. */
import { activeChatId, activePersonaId, chatCharacterRecords, ctx, mapCharacter, worldInfoSelection } from './adapter';
import { estimateTextTokens } from '../shared/token-estimator';
import type { Character } from '../shared';

interface WorldEntry {
  uid?: number | string;
  key?: string[];
  keys?: string[];
  content?: string;
  disable?: boolean;
  enabled?: boolean;
  comment?: string;
  name?: string;
  constant?: boolean;
  position?: number | string;
}

interface Lorebook {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  isGlobal: boolean;
  hiddenFromLibrary: boolean;
  scope: { mode: string; chatIds: string[] };
  characterIds: string[];
  personaIds: string[];
  chatId: string | null;
  sourceAgentId: null;
  entries: ReturnType<typeof mapEntry>[];
}

function names(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
}

function mapEntry(bookId: string, uid: string, entry: WorldEntry) {
  return {
    id: `${bookId}:${uid}`,
    lorebookId: bookId,
    name: entry.comment || entry.name || (entry.key ?? entry.keys ?? []).join(', ') || 'Lorebook Entry',
    keys: Array.isArray(entry.key ?? entry.keys) ? entry.key ?? entry.keys : [],
    content: String(entry.content ?? ''),
    enabled: !entry.disable && entry.enabled !== false,
    constant: Boolean(entry.constant),
    position: entry.position,
    activationSources: ['chat_settings'],
  };
}

function embeddedId(avatar: string): string {
  return `embedded:${avatar}`;
}

/** An embedded book is card data, not an unrelated installed book with the same name. */
function embeddedEntries(id: string): ReturnType<typeof mapEntry>[] | null {
  if (!id.startsWith('embedded:')) return null;
  const character = ctx().characters.find((item) => String(item.avatar) === id.slice('embedded:'.length));
  const entries = character?.data?.character_book?.entries;
  return Array.isArray(entries) ? entries.map((entry: WorldEntry, index: number) => mapEntry(id, String(entry.uid ?? index), entry)) : [];
}

export async function readLorebookEntries(id: string): Promise<ReturnType<typeof mapEntry>[]> {
  const embedded = embeddedEntries(id);
  if (embedded) return embedded;
  const book = await ctx().loadWorldInfo?.(id);
  return Object.entries(book?.entries ?? {}).map(([uid, entry]) => mapEntry(id, uid, entry as WorldEntry));
}

export async function listLorebooks(): Promise<Lorebook[]> {
  const selection = await worldInfoSelection();
  const context = ctx();
  const books = new Map<string, Lorebook>();
  const get = (id: string, name = id): Lorebook => {
    let book = books.get(id);
    if (!book) {
      book = {
        id, name, description: '', enabled: true, isGlobal: false, hiddenFromLibrary: false,
        scope: { mode: 'all', chatIds: [] }, characterIds: [], personaIds: [], chatId: null,
        sourceAgentId: null, entries: [],
      };
      books.set(id, book);
    }
    return book;
  };
  for (const name of names(context.getWorldInfoNames?.())) get(name);
  for (const name of selection.globalSelect) get(name).isGlobal = true;
  for (const character of context.characters ?? []) {
    const avatar = String(character.avatar ?? '');
    const primary = names(character.data?.extensions?.world);
    const extra = selection.charLore.find((entry) => entry.name === avatar.replace(/\.[^/.]+$/, ''));
    for (const name of new Set([...primary, ...names(extra?.extraBooks)])) get(name).characterIds.push(avatar);
    // An imported card's external book takes precedence over its embedded copy.
    const embedded = character.data?.character_book;
    if (primary.length === 0 && !Object.hasOwn(character.data?.extensions ?? {}, 'world') && Array.isArray(embedded?.entries) && embedded.entries.length > 0) {
      const id = embeddedId(avatar);
      const book = get(id, embedded.name || `${character.name || 'Character'} (embedded)`);
      book.characterIds.push(avatar);
      book.entries = embeddedEntries(id) ?? [];
    }
  }
  const chatId = activeChatId();
  for (const name of names(context.chatMetadata?.world_info)) get(name).chatId = chatId;
  const personaId = activePersonaId();
  for (const name of names(context.powerUserSettings?.persona_description_lorebook)) {
    if (personaId) get(name).personaIds.push(personaId);
    else get(name).chatId = chatId;
  }
  return [...books.values()];
}

/** Only the active chat's configured books are allowed into its phone prompt. */
export async function scanLorebooks(): Promise<{ entries: ReturnType<typeof mapEntry>[]; lorebookIds: string[] }> {
  const context = ctx();
  const chatId = activeChatId();
  const group = context.groups?.find((item: Record<string, any>) => String(item.id) === String(context.groupId));
  const characters = context.groupId
    ? names(group?.members)
    : [String(context.characters[Number(context.characterId)]?.avatar ?? '')];
  const pinned = new Set(names(context.chatMetadata?.activeLorebookIds));
  const excluded = new Set(names(context.chatMetadata?.excludedLorebookIds));
  const personaId = activePersonaId();
  const books = (await listLorebooks()).filter((book) => !excluded.has(book.id) && (
    book.isGlobal || (chatId !== null && book.chatId === chatId) || pinned.has(book.id) ||
    book.characterIds.some((id) => characters.includes(id)) || Boolean(personaId && book.personaIds.includes(personaId))
  ));
  const entries = (await Promise.all(books.map((book) => readLorebookEntries(book.id)))).flat().filter((entry) => entry.enabled);
  return { entries, lorebookIds: books.map((book) => book.id) };
}

interface MochiWorldInfoPrompt {
  worldInfoBefore: string;
  worldInfoAfter: string;
  worldInfoExamples?: Array<{ position?: number; content?: string }>;
  worldInfoDepth?: Array<{ depth?: number; role?: number; entries?: string[] }>;
  anBefore?: string[];
  anAfter?: string[];
  authorNote?: {
    value: string;
    role?: number;
    position?: number;
    depth?: number;
    filter?: (() => boolean | Promise<boolean>) | null;
  };
}

/** Use ST's scanner for keyword/constant activation, budgets, ordering and placement. */
export async function getMochiWorldInfoPrompt(input: {
  history: string[];
  userInput: string;
  personaDescription: string;
  characters: Character[];
  maxContext?: number;
  substitute?: (text: string, characterName?: string) => string;
}): Promise<MochiWorldInfoPrompt> {
  const context = ctx();
  const content = [...input.history, ...(input.userInput ? [input.userInput] : [])].reverse();
  if (typeof context.getWorldInfoPrompt === 'function') {
    const expand = (text: string, characterName?: string) => input.substitute ? input.substitute(text, characterName) : text;
    const join = (field: string) => input.characters.map((character) => expand(character.data?.[field] || character[field] || '', character.data?.name || character.name)).filter(Boolean).join('\n');
    const chat = context.chat;
    const chatId = activeChatId();
    const prompts = context.extensionPrompts;
    const note = prompts?.['2_floating_prompt'] ? { ...prompts['2_floating_prompt'] } : undefined;
    const noteValue = note?.value;
    let result: MochiWorldInfoPrompt | undefined;
    try {
      result = await context.getWorldInfoPrompt(content, input.maxContext ?? Number(context.chatCompletionSettings?.openai_max_context || context.maxContext || 8192), true, {
        trigger: 'quiet', personaDescription: input.personaDescription,
        characterDescription: join('description'), characterPersonality: join('personality'),
        characterDepthPrompt: input.characters.map((character) => expand(character.data?.extensions?.depth_prompt?.prompt || '', character.data?.name || character.name)).filter(Boolean).join('\n'),
        scenario: expand(context.chatMetadata?.scenario || join('scenario')), creatorNotes: join('creator_notes'),
      });
    } finally {
      // ST's scanner can add WI to Author's Note even for a dry run. Phone
      // generation must not rewrite the roleplay's note or a newly switched chat.
      if (result && prompts && ctx().chat === chat && activeChatId() === chatId && ctx().extensionPrompts === prompts && note) {
        const current = prompts['2_floating_prompt'];
        // Match ST's exact newline handling, including an empty original note.
        const injectedNote = `${(result.anBefore || []).join('\n')}\n${noteValue}\n${(result.anAfter || []).join('\n')}`.replace(/(^\n)|(\n$)/g, '');
        if (current?.value !== noteValue && current?.value === injectedNote) {
          // Keep the scanner's note/lore in this request only; restoring the
          // original must not silently drop AN-positioned lore from the phone.
          result = { ...result, authorNote: { ...current } };
          prompts['2_floating_prompt'] = note;
        }
      }
    }
    return result!;
  }
  // Older hosts without the scanner keep the explicit-assignment compatibility
  // path, but before/after entries are still never duplicated into both markers.
  const { entries } = await scanLorebooks();
  const before: string[] = [];
  const after: string[] = [];
  const scanText = content.join('\n').toLowerCase();
  const budget = Number(context.chatMetadata?.lorebookTokenBudget ?? 2048);
  let used = 0;
  for (const entry of entries) {
    if (!entry.content || (!entry.constant && (!entry.keys?.length || !entry.keys.some((key: string) => scanText.includes(key.toLowerCase()))))) continue;
    const cost = estimateTextTokens(entry.content);
    if (budget > 0 && used + cost > budget) continue;
    used += cost;
    const position = entry.position;
    if (position === 0 || position === 'before_char' || position === 'before') before.push(entry.content);
    else if (position === undefined || position === 1 || position === 'after_char' || position === 'after') after.push(entry.content);
  }
  return { worldInfoBefore: before.join('\n'), worldInfoAfter: after.join('\n') };
}

/** Re-read assignments at send time so a cached UI query cannot send detached lore. */
export async function refreshLorebookPrompt<T extends { role: string; content: string }>(messages: T[], userName?: string): Promise<T[]> {
  const wrapper = /^\s*<(world_info_before|world_info_after|lorebook)>[\s\S]*?<\/\1>\s*$/i;
  if (!messages.some((message) => wrapper.test(message.content))) return messages;
  const worldInfo = await getMochiWorldInfoPrompt({
    history: messages.filter((message) => !wrapper.test(message.content)).map((message) => message.content), userInput: '',
    personaDescription: ctx().powerUserSettings?.persona_description || '',
    characters: chatCharacterRecords().map(mapCharacter) as Character[],
  });
  const sent = new Set<string>();
  return messages.flatMap((message) => {
    const match = wrapper.exec(message.content);
    if (!match) return [message];
    const type = match[1].toLowerCase();
    const sources = type === 'lorebook' ? ['before', 'after'] : [type === 'world_info_before' ? 'before' : 'after'];
    const content = sources.flatMap((source) => {
      if (sent.has(source)) return [];
      sent.add(source);
      const value = source === 'before' ? worldInfo.worldInfoBefore : worldInfo.worldInfoAfter;
      return value ? [userName ? value.replace(/\{\{user\}\}/gi, () => userName) : value] : [];
    }).join('\n');
    return content ? [{ ...message, content: `<${match[1]}>\n${content}\n</${match[1]}>` }] : [];
  });
}
