/**
 * The only module that talks to SillyTavern.
 *
 * Everything else in the extension works against the small surface declared
 * here. SillyTavern modules are imported by absolute URL because the extension
 * bundle is injected as a module script from
 * `/scripts/extensions/<name>/index.js` and must not depend on where it sits in
 * the extensions tree.
 */

type StContext = Record<string, any>;

/**
 * SillyTavern's `getContext()` returns a plain object of values captured at call
 * time, not live getters: `characterId` is `this_chid`, `chatId` is
 * `characters[this_chid]?.chat`, `chatMetadata` is the `chat_metadata` variable.
 * Caching one of those objects freezes the chat state it was built from, so the
 * context is resolved fresh on every access instead.
 */
let getContextFn: (() => StContext) | null = null;
let i18nModule: Record<string, any> | null = null;

/** Loaded lazily: importing script.js at module scope would run before ST does. */
let contextPromise: Promise<void> | null = null;

async function loadContext(): Promise<void> {
  const [{ getContext }, i18n] = await Promise.all([
    import('/scripts/st-context.js'),
    import('/scripts/i18n.js'),
  ]);
  getContextFn = getContext as () => StContext;
  i18nModule = i18n;
}

export function stContext(): Promise<void> {
  if (!contextPromise) contextPromise = loadContext();
  return contextPromise;
}

/**
 * Synchronous access to the current context.
 *
 * Only valid after `init()` has run. Throws rather than silently returning
 * undefined, because every caller is downstream of the extension's own init.
 */
export function ctx(): StContext {
  if (!getContextFn) throw new Error('Mochi OS: SillyTavern context is not ready yet');
  return getContextFn();
}

export async function primeContext(): Promise<void> {
  await stContext();
}

/* ------------------------------------------------------------------ *
 * Character, persona, world info
 * ------------------------------------------------------------------ */

/** SillyTavern's key for extension-owned settings, namespaced per extension. */
const SETTINGS_KEY = 'mochi_os';

function extensionSettings(): Record<string, any> {
  const settings = ctx().extensionSettings ?? {};
  if (!settings[SETTINGS_KEY]) settings[SETTINGS_KEY] = {};
  return settings[SETTINGS_KEY];
}

export function readSettings(): Record<string, any> {
  return extensionSettings();
}

export function writeSettings(patch: Record<string, any>): void {
  const settings = extensionSettings();
  for (const [key, value] of Object.entries(patch)) settings[key] = value;
  ctx().saveSettingsDebounced?.();
}

/** True when a chat is loaded and Mochi OS can attach to it. */
export function hasChat(): boolean {
  const context = ctx();
  return Boolean(context.chatId && (context.characterId !== undefined || context.groupId));
}

/** Stable identifier for the active chat, or null when none is loaded. */
export function getChatId(): string | null {
  const context = ctx();
  if (context.groupId) return `group-${context.groupId}`;
  if (context.characterId === undefined || context.characterId === null) return null;
  return `char-${context.characterId}`;
}

export interface StCharacter {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  mesExample: string;
  avatar: string;
  data: Record<string, any>;
}

/** The active character card, or a group-derived stub when in a group chat. */
export function getActiveCharacter(): StCharacter | null {
  const context = ctx();
  if (context.groupId) {
    const group = context.groups?.[context.groupId];
    const name = group?.name || 'Group';
    return {
      name,
      description: group?.description || '',
      personality: '',
      scenario: '',
      mesExample: '',
      avatar: group?.avatar || '',
      data: {},
    };
  }
  const character = context.characters?.[context.characterId];
  if (!character) return null;
  const data = character.data ?? {};
  return {
    name: data.name || character.name || 'Character',
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    mesExample: data.mes_example || '',
    avatar: character.avatar || '',
    data,
  };
}

/** The user persona description SillyTavern shows as "You". */
export function getPersonaText(): string {
  const context = ctx();
  const name = context.name1 || 'User';
  const personaId = context.power_user?.persona_descriptions?.[context.persona_description ?? -1];
  const description = personaId || context.name2 || '';
  return `<persona>\nName: ${name}\n${description}\n</persona>`;
}

export function getUserName(): string {
  return ctx().name1 || 'User';
}

/**
 * Active world info entries as one text block.
 *
 * SillyTavern decides which entries are active inside its own prompt manager,
 * and that result is not reachable from an extension, so the character card's
 * embedded book plus any lorebooks bound to this chat are rendered here.
 */
export function getWorldInfoText(): string {
  const context = ctx();
  const chunks: string[] = [];

  const book = context.characters?.[context.characterId]?.data?.character_book;
  if (book?.entries?.length) {
    const lines: string[] = [];
    for (const entry of book.entries) {
      const content = typeof entry === 'string' ? entry : String(entry?.content ?? '');
      if (content.trim()) lines.push(content.trim());
    }
    if (lines.length) chunks.push(lines.join('\n'));
  }

  const lorebooks = context.chatMetadata?.world_info ?? [];
  const bound = Array.isArray(lorebooks) ? lorebooks : [];
  for (const uid of bound) {
    const entry = context.world_info?.find?.((bookItem: any) => String(bookItem?.uid) === String(uid));
    const text = entry?.entries
      ?.map((item: any) => String(item?.content ?? ''))
      .filter(Boolean)
      .join('\n');
    if (text) chunks.push(text);
  }

  return chunks.join('\n\n');
}

/* ------------------------------------------------------------------ *
 * Per-chat storage
 * ------------------------------------------------------------------ */

/** Read the extension's slice of the active chat's metadata. */
export function readChatMeta(): Record<string, any> {
  const meta = ctx().chatMetadata ?? {};
  if (!meta.mochios || typeof meta.mochios !== 'object') meta.mochios = {};
  return meta.mochios;
}

/**
 * Persist the extension's slice of the active chat's metadata.
 *
 * `chat_metadata` is a module-level variable inside SillyTavern, so it has to be
 * changed through `updateChatMetadata`; assigning to the value on a context
 * object would only touch that throwaway snapshot. SillyTavern then writes the
 * whole blob into the first line of the chat's JSONL, so everything stored here
 * travels with chat export, import and branching.
 */
export async function writeChatMeta(next: Record<string, any>): Promise<void> {
  const { updateChatMetadata, saveMetadata } = await import('/scripts/script.js');
  updateChatMetadata({ mochios: next });
  await saveMetadata();
}

/** SillyTavern's translation for a key, when it knows one. */
export function stTranslate(key: string): string | undefined {
  const translate = i18nModule?.translate;
  if (typeof translate !== 'function') return undefined;
  try {
    const result = translate('', key);
    return typeof result === 'string' && result && result !== key ? result : undefined;
  } catch {
    return undefined;
  }
}

/** Run SillyTavern's macro substitution (used for `{{user}}` / `{{char}}`). */
export async function substituteMacros(text: string): Promise<string> {
  const { substituteParams } = await import('/scripts/script.js');
  try {
    return substituteParams(text);
  } catch {
    return text;
  }
}

/** One-shot completion on the active connection, without touching the chat. */
export async function runRawGeneration(messages: Array<{ role: string; content: string }>): Promise<string> {
  const { generateRaw } = await import('/scripts/script.js');
  return generateRaw({ prompt: messages, responseLength: 512 });
}

/* ------------------------------------------------------------------ *
 * Events and chrome
 * ------------------------------------------------------------------ */

export function onEvent(name: string, handler: (...args: any[]) => void): void {
  const { eventSource, eventTypes } = ctx();
  const key = eventTypes?.[name] ?? name;
  eventSource?.on(key, handler);
}

export function offEvent(name: string, handler: (...args: any[]) => void): void {
  const { eventSource, eventTypes } = ctx();
  const key = eventTypes?.[name] ?? name;
  eventSource?.removeListener?.(key, handler);
}

export function toast(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  const { callGenericPopup } = ctx();
  const text = EN_TEXT[message] ?? message;
  try {
    callGenericPopup(text, 'info');
  } catch {
    console.log(`[Mochi OS] ${kind}: ${message}`);
  }
  void kind;
}

/** Small English table for notices the extension raises itself. */
const EN_TEXT: Record<string, string> = {
  'mochi.st.noChat': 'Open a chat first',
  'mochi.st.phoneDataFailed': 'Failed to generate Mochi OS data',
  'mochi.st.phoneDataGenerated': 'Mochi OS data generated successfully',
  'mochi.st.phoneReplyFailed': 'Failed to generate character reply',
  'mochi.st.phoneDataDeleted': 'Mochi OS data deleted',
  'mochi.st.formatGuideCopied': 'Copied!',
  'mochi.st.stopped': 'Stopped',
};