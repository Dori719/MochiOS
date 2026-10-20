/**
 * The only module in the port that talks to SillyTavern directly.
 *
 * Everything else — including the engine's own `MochiOsView` and the engine
 * modules the port reuses — works against the interface declared here, so the
 * host can be reasoned about in one place.
 *
 * Two SillyTavern behaviours shape this file:
 *
 * 1. `getContext()` returns a snapshot object. `characters` and `chat` are live
 *    references, but scalars such as `characterId`, `chatId`, `name1` and
 *    `name2` are captured at call time, so the context is resolved fresh on
 *    every access instead of being cached.
 * 2. `chat` and `chat_metadata` are module-level variables owned by
 *    SillyTavern. The message array is read as a live import binding and
 *    mutated in place; metadata is written through `updateChatMetadata`, because
 *    assigning to the snapshot's property would only touch the copy.
 */

type StRecord = Record<string, any>;

interface StContext extends StRecord {
  characters: StRecord[];
  chat: StRecord[];
  chatMetadata: StRecord;
  name1: string;
  name2: string;
  characterId?: number | string;
  groupId?: string | null;
  chatId?: string;
  extensionSettings: StRecord;
  powerUserSettings: StRecord;
  eventSource: StRecord;
  eventTypes: StRecord;
}

interface StModules {
  getContext: () => StContext;
  updateChatMetadata: (values: StRecord, reset?: boolean) => void;
  saveMetadata: () => Promise<void>;
  saveMetadataDebounced: () => void;
  saveSettingsDebounced: () => void;
  saveChat: (options?: StRecord) => Promise<void>;
  substituteParams: (text: string) => string;
  generateRaw: (options: StRecord) => Promise<string>;
  executeSlashCommandsWithOptions: (commands: string, options?: StRecord) => Promise<string>;
  callGenericPopup: (...args: any[]) => Promise<any>;
  getCurrentChatId: () => string | undefined;
}

let modules: StModules | null = null;
let loading: Promise<void> | null = null;

/** Loaded lazily: importing SillyTavern's scripts at module scope would run before it boots. */
export function stReady(): Promise<void> {
  if (!loading) {
    loading = import('/scripts/st-context.js').then((mod: StRecord) => {
      // st-context exports getContext, not the generation/storage functions.
      // Resolve those on its live context so all calls reach the host API.
      modules = new Proxy(mod, {
        get(target, key) {
          if (key === 'getContext') return target.getContext;
          return target.getContext()[key];
        },
      }) as unknown as StModules;
    });
  }
  return loading;
}

/** The live SillyTavern context. Only valid after `stReady()` has resolved. */
export function ctx(): StContext {
  if (!modules) throw new Error('Mochi OS: SillyTavern context is not ready yet');
  return modules.getContext();
}

export function st(): StModules {
  if (!modules) throw new Error('Mochi OS: SillyTavern context is not ready yet');
  return modules;
}

/* ------------------------------------------------------------------ *
 * Chat identity
 * ------------------------------------------------------------------ */

export function isGroupChat(): boolean {
  const context = ctx();
  return Boolean(context.groupId);
}

/**
 * The SillyTavern chat file currently open, without the owner prefix.
 *
 * Returned by `getContext().chatId` for a character chat (the value of
 * `characters[this_chid].chat`) and by the group's `chat_id` for a group chat.
 */
export function currentChatFile(): string {
  const context = ctx();
  return String(context.chatId ?? context.getCurrentChatId?.() ?? '');
}

/** The owner of the open chat: a character avatar, or `group:<id>`. */
export function activeOwner(): string | null {
  const context = ctx();
  if (context.groupId) return `group:${context.groupId}`;
  const index = Number(context.characterId);
  if (!Number.isInteger(index) || index < 0) return null;
  const character = context.characters?.[index];
  if (!character) return null;
  return String(character.avatar ?? index);
}

/**
 * A stable identifier for the open chat.
 *
 * The engine handed Mochi OS a chat id from its own database; the port derives
 * one from the SillyTavern chat file and its owner, so every query key, cache
 * entry and store field keys off the same string and a chat switch invalidates
 * all of them.
 */
export function activeChatId(): string | null {
  const owner = activeOwner();
  if (!owner) return null;
  return `${owner}/${currentChatFile()}`;
}

export function hasChat(): boolean {
  return activeChatId() !== null;
}

/* ------------------------------------------------------------------ *
 * Characters
 * ------------------------------------------------------------------ */

function characterDisplayName(character: StRecord | undefined): string {
  if (!character) return '';
  return String(character.data?.name || character.name || character.comment || '');
}

/** The characters in the open chat, in chat order. */
function chatCharacterRecords(): StRecord[] {
  const context = ctx();
  if (context.groupId) {
    const group = context.groups?.find((item: StRecord) => String(item.id) === String(context.groupId));
    const members: string[] = Array.isArray(group?.members) ? group.members : [];
    return members
      .map((avatar) => context.characters.find((character) => character.avatar === avatar))
      .filter((character): character is StRecord => Boolean(character));
  }
  const index = Number(context.characterId);
  const character = context.characters?.[index];
  return character ? [character] : [];
}

/** Map one SillyTavern card to the engine's `Character` shape, keyed by avatar. */
export function mapCharacter(character: StRecord): Record<string, any> {
  const data = character.data && typeof character.data === 'object' ? character.data : {};
  return {
    id: String(character.avatar ?? data.name ?? ''),
    name: characterDisplayName(character),
    comment: String(character.name ?? ''),
    avatarPath: character.avatar ? `/characters/${character.avatar}` : null,
    avatarCrop: character.avatar_crop ?? null,
    data: {
      ...data,
      name: data.name || character.name || '',
    },
    // SillyTavern stores the embedded card book here; the ported macro helpers
    // read `data.character_book` for world info.
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

/** Every character card SillyTavern knows about. */
export function listCharacters(): Array<Record<string, any>> {
  return (ctx().characters ?? []).map(mapCharacter);
}

/* ------------------------------------------------------------------ *
 * Personas
 * ------------------------------------------------------------------ */

function personaCrop(persona: StRecord | undefined): unknown {
  return persona?.avatar_crop ?? null;
}

/** The user's personas, keyed by the id SillyTavern uses in `power_user.personas`. */
export function listPersonas(): Array<Record<string, any>> {
  const context = ctx();
  const power = context.powerUserSettings ?? {};
  const names: StRecord = power.personas ?? {};
  const descriptions: StRecord = power.persona_descriptions ?? {};
  const out: Array<Record<string, any>> = [];
  for (const [id, name] of Object.entries(names)) {
    const entry = descriptions[id] ?? {};
    out.push({
      id: String(id),
      name: String(name ?? ''),
      comment: String(name ?? ''),
      description: String(entry.description ?? ''),
      personality: '',
      backstory: '',
      appearance: '',
      scenario: '',
      avatarPath: entry.avatar ? `/User Avatars/${entry.avatar}` : null,
      avatar: entry.avatar ?? null,
      avatarCrop: personaCrop(entry),
    });
  }
  return out;
}

/** The persona SillyTavern has selected for the open chat. */
export function activePersonaId(): string | null {
  const context = ctx();
  const power = context.powerUserSettings ?? {};
  // SillyTavern tracks the selected persona per chat in `chat_metadata.persona`,
  // and falls back to the user's default persona.
  const fromChat = context.chatMetadata?.persona ?? power.default_persona;
  return fromChat ? String(fromChat) : null;
}

export function updatePersona(id: string, patch: Record<string, any>): Record<string, any> {
  const context = ctx();
  const power = context.powerUserSettings ?? {};
  if (typeof patch.comment === 'string') {
    power.personas = { ...(power.personas ?? {}), [id]: patch.comment };
  }
  if (typeof patch.name === 'string') {
    power.personas = { ...(power.personas ?? {}), [id]: patch.name };
  }
  if (patch.description !== undefined) {
    const descriptions = { ...(power.persona_descriptions ?? {}) };
    descriptions[id] = { ...(descriptions[id] ?? {}), description: String(patch.description ?? '') };
    power.persona_descriptions = descriptions;
  }
  st().saveMetadataDebounced?.();
  return listPersonas().find((persona) => persona.id === id) ?? { id, ...patch };
}

/* ------------------------------------------------------------------ *
 * Chat metadata
 * ------------------------------------------------------------------ */

/** The port's slice of the open chat's metadata. */
export function readChatMeta(): Record<string, any> {
  const meta = ctx().chatMetadata ?? {};
  if (!meta.mochios || typeof meta.mochios !== 'object') meta.mochios = {};
  return meta.mochios;
}

/**
 * Persist the port's slice of the chat's metadata.
 *
 * SillyTavern writes the whole blob into the first line of the chat's JSONL, so
 * everything stored here travels with export, import and branching.
 */
export function writeChatMeta(next: Record<string, any>): void {
  st().updateChatMetadata({ mochios: next });
  st().saveMetadataDebounced?.();
}

/**
 * The port's extension-wide settings — theme, colours, the profile's status, the
 * page size.
 *
 * Reading never creates the key: an empty `mochi_os` block in the user's
 * `settings.json` would be a change to their SillyTavern for nothing. It appears
 * the first time a setting is actually changed.
 */
export function readChatSettings(): Record<string, any> {
  const stored = (ctx().extensionSettings ?? {}).mochi_os;
  return stored && typeof stored === 'object' ? stored : {};
}

/**
 * Persist the port's extension-wide settings.
 *
 * These belong to the user, not to a chat, so they go into SillyTavern's
 * extension settings and are written with `saveSettingsDebounced` (the settings
 * file), not `saveMetadataDebounced` (the chat's own metadata).
 */
export function writeChatSettings(next: Record<string, any>): void {
  const context = ctx();
  const settings = (context.extensionSettings ??= {});
  if (!settings.mochi_os || typeof settings.mochi_os !== 'object') settings.mochi_os = {};
  Object.assign(settings.mochi_os, next);
  st().saveSettingsDebounced?.();
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

const BASE_TIME = Date.UTC(2000, 0, 1);

function nextMessageId(): string {
  const meta = readChatMeta();
  const next = Number(meta.messageIdSeq ?? 0) + 1;
  writeChatMeta({ ...meta, messageIdSeq: next });
  return `m${next}`;
}

/** Read (and, on first sight, assign) the stable id the port tracks per message. */
export function ensureMessageId(index: number): string | null {
  const chat = ctx().chat;
  const message = chat?.[index];
  if (!message) return null;
  if (!message.extra || typeof message.extra !== 'object') message.extra = {};
  const existing = message.extra.mochiosId;
  if (typeof existing === 'string' && existing) return existing;
  const id = nextMessageId();
  message.extra.mochiosId = id;
  return id;
}

export function messageIndexOf(id: string): number {
  const chat = ctx().chat ?? [];
  for (let index = 0; index < chat.length; index += 1) {
    if (ensureMessageId(index) === id) return index;
  }
  return -1;
}

function matchCharacterId(name: string): string | null {
  if (!name) return null;
  const records = chatCharacterRecords();
  const match = records.find((character) => characterDisplayName(character).toLowerCase() === name.toLowerCase());
  if (match) return String(match.avatar ?? '');
  return records.length === 1 ? String(records[0].avatar ?? '') : null;
}

/**
 * Map a SillyTavern message onto the engine's `Message`.
 *
 * SillyTavern has no message id, so one is minted once and kept in the message's
 * own `extra` (which SillyTavern persists). That makes ids stable across
 * inserts, deletes and reloads — the UI holds ids across an async generation and
 * would otherwise act on the wrong row.
 */
export function mapMessage(index: number): Record<string, any> | null {
  const chat = ctx().chat;
  const message = chat?.[index];
  if (!message) return null;
  const id = ensureMessageId(index);
  if (!id) return null;
  const isUser = Boolean(message.is_user);
  const isSystem = Boolean(message.is_system);
  const role = isUser ? 'user' : isSystem ? 'system' : 'assistant';
  return {
    id,
    chatId: activeChatId() ?? undefined,
    role,
    content: typeof message.mes === 'string' ? message.mes : '',
    characterId: role === 'assistant' ? matchCharacterId(String(message.name ?? '')) : null,
    personaId: null,
    createdAt: new Date(BASE_TIME + index * 1000).toISOString(),
    swipeCount: Array.isArray(message.swipes) && message.swipes.length > 0 ? message.swipes.length : 1,
    activeSwipeIndex: Number(message.swipe_id ?? 0),
    swipes: Array.isArray(message.swipes) ? [...message.swipes] : undefined,
    extra: message.extra && typeof message.extra === 'object' ? { ...message.extra } : {},
    metadata: {},
  };
}

/** Chronological window of the chat's messages, oldest first. */
export function listMessages(limit = 0, beforeId?: string | null): Array<Record<string, any>> {
  const chat = ctx().chat ?? [];
  let end = chat.length;
  if (beforeId) {
    const index = messageIndexOf(beforeId);
    if (index >= 0) end = index;
  }
  const start = limit > 0 ? Math.max(0, end - limit) : 0;
  const out: Array<Record<string, any>> = [];
  for (let index = start; index < end; index += 1) {
    const mapped = mapMessage(index);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function saveChat(): void {
  try {
    void st().saveChat?.();
  } catch (error) {
    console.warn('[Mochi OS] could not save the chat', error);
  }
}

export interface InsertMessageInput {
  role?: string;
  characterId?: string | null;
  content?: string;
  name?: string;
}

/** Append a roleplay message, as Mochi OS does when a thread turn is produced. */
export function insertMessage(input: InsertMessageInput, atIndex?: number): Record<string, any> {
  const context = ctx();
  const chat = context.chat;
  const role = input.role ?? 'assistant';
  const characterId = input.characterId ?? null;
  const character = characterId
    ? context.characters.find((item) => String(item.avatar) === String(characterId))
    : undefined;
  const name =
    input.name ||
    (role === 'user'
      ? String(context.name1 ?? 'User')
      : characterDisplayName(character) || String(context.name2 ?? 'Character'));
  const message: StRecord = {
    name,
    is_user: role === 'user',
    is_system: role === 'system',
    send_date: new Date().toISOString(),
    mes: input.content ?? '',
    extra: {},
  };
  const index = atIndex === undefined ? chat.length : atIndex;
  chat.splice(index, 0, message);
  ensureMessageId(index);
  saveChat();
  return mapMessage(index)!;
}

export function updateMessageContent(id: string, content: string): Record<string, any> | null {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const message = ctx().chat[index];
  const isSwipe = Array.isArray(message.swipes) && message.swipes.length > 0;
  if (isSwipe) {
    const swipeIndex = Number(message.swipe_id ?? 0);
    message.swipes[swipeIndex] = content;
  }
  message.mes = content;
  saveChat();
  return mapMessage(index);
}

export function deleteMessage(id: string): boolean {
  const index = messageIndexOf(id);
  if (index < 0) return false;
  ctx().chat.splice(index, 1);
  saveChat();
  return true;
}

export function mergeMessageExtra(id: string, patch: Record<string, any>): Record<string, any> | null {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const message = ctx().chat[index];
  if (!message.extra || typeof message.extra !== 'object') message.extra = {};
  Object.assign(message.extra, patch);
  saveChat();
  return mapMessage(index);
}

export function appendSwipe(id: string, content: string): Record<string, any> | null {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const message = ctx().chat[index];
  if (!Array.isArray(message.swipes) || message.swipes.length === 0) {
    message.swipes = [message.mes ?? ''];
  }
  message.swipes.push(content);
  message.swipe_id = message.swipes.length - 1;
  message.mes = content;
  saveChat();
  return mapMessage(index);
}

export function setActiveSwipe(id: string, swipeIndex: number): Record<string, any> | null {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const message = ctx().chat[index];
  if (!Array.isArray(message.swipes) || message.swipes.length === 0) {
    message.swipes = [message.mes ?? ''];
  }
  const clamped = Math.max(0, Math.min(swipeIndex, message.swipes.length - 1));
  message.swipe_id = clamped;
  message.mes = message.swipes[clamped] ?? message.mes;
  saveChat();
  return mapMessage(index);
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

export function onEvent(name: string, handler: (...args: any[]) => void): void {
  const context = ctx();
  const key = context.eventTypes?.[name] ?? name;
  context.eventSource?.on?.(key, handler);
}

export function offEvent(name: string, handler: (...args: any[]) => void): void {
  const context = ctx();
  const key = context.eventTypes?.[name] ?? name;
  context.eventSource?.removeListener?.(key, handler);
}

export function substituteMacros(text: string): string {
  try {
    return st().substituteParams(text);
  } catch {
    return text;
  }
}

export function userName(): string {
  try {
    return String(ctx().name1 ?? 'User');
  } catch {
    return 'User';
  }
}
