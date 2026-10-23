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

import { combinePhoneTranscript, resolvePhoneCharacter, transcriptBlock } from './phone-transcript';

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
  substituteParams: (text: string, options?: StRecord) => string;
  generateRaw: (options: StRecord) => Promise<string>;
  executeSlashCommandsWithOptions: (commands: string, options?: StRecord) => Promise<string>;
  callGenericPopup: (...args: any[]) => Promise<any>;
  getCurrentChatId: () => string | undefined;
}

let modules: StModules | null = null;
let personaModule: { user_avatar?: string } | null = null;
let loading: Promise<void> | null = null;

/** Loaded lazily: importing SillyTavern's scripts at module scope would run before it boots. */
export function stReady(): Promise<void> {
  if (!loading) {
    loading = Promise.all([
      import('/scripts/st-context.js'),
      import('/scripts/personas.js'),
    ]).then(([mod, personas]: [StRecord, { user_avatar?: string }]) => {
      personaModule = personas;
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
export function chatCharacterRecords(): StRecord[] {
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
      description: character.description ?? data.description ?? '',
      personality: character.personality ?? data.personality ?? '',
      scenario: character.scenario ?? data.scenario ?? '',
      mes_example: character.mes_example ?? data.mes_example ?? '',
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

/** These are selections, unlike getWorldInfoNames(), which is only the installed library. */
export async function worldInfoSelection(): Promise<{ globalSelect: string[]; charLore: StRecord[] }> {
  const worldInfo = await import('/scripts/world-info.js');
  const settings = worldInfo.getWorldInfoSettings?.().world_info ?? worldInfo.world_info ?? {};
  const selected = worldInfo.selected_world_info ?? settings.globalSelect;
  return {
    globalSelect: Array.isArray(selected) ? selected.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())) : [],
    charLore: Array.isArray(settings.charLore) ? settings.charLore : [],
  };
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
      title: String(entry.title ?? ''),
      isActive: String(id) === activePersonaId(),
      description: String(entry.description ?? ''),
      personality: '',
      backstory: '',
      appearance: '',
      scenario: '',
      avatarPath: `/User Avatars/${encodeURIComponent(id)}`,
      avatar: id,
      avatarCrop: personaCrop(entry),
    });
  }
  return out;
}

/** The persona SillyTavern has selected for the open chat. */
export function activePersonaId(): string | null {
  const context = ctx();
  const power = context.powerUserSettings ?? {};
  // A chat/default lock is not necessarily the persona currently in use. The
  // live avatar binding also covers manual selections and character connections.
  const selected = personaModule?.user_avatar || context.chatMetadata?.persona || power.default_persona;
  return selected ? String(selected) : null;
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
    if (id === activePersonaId()) power.persona_description = descriptions[id].description;
  }
  st().saveSettingsDebounced?.();
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
 * The port's extension-wide settings — theme, colours and window preferences.
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
  const id = typeof existing === 'string' && existing ? existing : nextMessageId();
  message.extra.mochiosId = id;
  // Native ST swipes restore `extra` from swipe_info. The logical turn identity
  // must survive that restore, including swipes created before Mochi assigned it.
  if (Array.isArray(message.swipe_info)) {
    for (const swipe of message.swipe_info) {
      if (swipe && typeof swipe === 'object') swipe.extra = { ...swipe.extra, mochiosId: id };
    }
  }
  return id;
}

export function messageIndexOf(id: string): number {
  const chat = ctx().chat ?? [];
  for (let index = 0; index < chat.length; index += 1) {
    if (ensureMessageId(index) === id || chat[index].extra?.mochiosTurnId === id) return index;
  }
  return -1;
}

/** Branches must include the complete turn, not just its first physical message. */
export function messageEndIndexOf(id: string): number {
  const index = messageIndexOf(id);
  return index < 0 ? -1 : turnIndices(index).at(-1) ?? index;
}

function matchCharacterId(name: string): string | null {
  if (!name) return null;
  const records = chatCharacterRecords();
  const match = records.find((character) => characterDisplayName(character).toLowerCase() === name.toLowerCase());
  if (match) return String(match.avatar ?? '');
  const other = ctx().characters.find((character) => characterDisplayName(character).toLowerCase() === name.toLowerCase());
  return other ? String(other.avatar ?? '') : null;
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
  const role = isUser ? 'user' : isSystem || message.extra?.type === 'narrator' ? 'system' : 'assistant';
  return {
    id,
    chatId: activeChatId() ?? undefined,
    role,
    name: String(message.name ?? ''),
    isSystem,
    forceAvatar: message.force_avatar,
    content: typeof message.mes === 'string' ? message.mes : '',
    characterId: role === 'assistant'
      ? typeof message.original_avatar === 'string' && ctx().characters.some((character) => character.avatar === message.original_avatar)
        ? message.original_avatar
        : Object.hasOwn(message.extra ?? {}, 'mochiosCharacterId')
          ? message.extra.mochiosCharacterId
          : matchCharacterId(String(message.name ?? ''))
      : null,
    personaId: null,
    createdAt: new Date(BASE_TIME + index * 1000).toISOString(),
    swipeCount: Array.isArray(message.swipes) && message.swipes.length > 0 ? message.swipes.length : 1,
    activeSwipeIndex: Number(message.swipe_id ?? 0),
    swipes: Array.isArray(message.swipes) ? [...message.swipes] : undefined,
    extra: message.extra && typeof message.extra === 'object' ? { ...message.extra } : {},
    metadata: {},
  };
}

function turnIndices(index: number): number[] {
  const chat = ctx().chat;
  const turnId = chat[index]?.extra?.mochiosTurnId;
  return turnId
    ? chat.flatMap((message, position) => message.extra?.mochiosTurnId === turnId ? [position] : [])
    : [index];
}

/** Read older split turns as one transcript without rewriting history on read. */
function mapTurn(index: number): Record<string, any> | null {
  const indices = turnIndices(index);
  const first = indices[0];
  const mapped = mapMessage(first);
  if (!mapped || !ctx().chat[first]?.extra?.mochiosTurnId) return mapped;
  const anchor = ctx().chat[first];
  const content = combinePhoneTranscript(indices.map((position) => String(ctx().chat[position].mes ?? '')));
  const swipes = Array.isArray(anchor.extra.mochiosTurnSwipes) ? [...anchor.extra.mochiosTurnSwipes] : [content];
  const swipeId = Number(anchor.extra.mochiosTurnSwipeId ?? 0);
  // A native ST edit changes the real messages, so keep the active phone swipe honest.
  swipes[swipeId] = content;
  return {
    ...mapped, id: anchor.extra.mochiosTurnId, role: 'assistant', characterId: transcriptBlock(content)?.type === 'private'
      ? indices.map((position) => mapMessage(position)).find((message) => message?.role === 'assistant')?.characterId ?? null
      : null, content,
    swipeCount: swipes.length, activeSwipeIndex: swipeId, swipes,
  };
}

export function readMessage(id: string): Record<string, any> | null {
  const index = messageIndexOf(id);
  return index < 0 ? null : mapTurn(index);
}

/** Chronological window of logical turns, oldest first. */
export function listMessages(limit = 0, beforeId?: string | null): Array<Record<string, any>> {
  const chat = ctx().chat ?? [];
  const indices: number[] = [];
  const seen = new Set<string>();
  const beforeIndex = beforeId ? messageIndexOf(beforeId) : -1;
  for (let index = 0; index < chat.length; index += 1) {
    if (index === beforeIndex) break;
    const turnId = chat[index].extra?.mochiosTurnId;
    if (turnId && seen.has(turnId)) continue;
    if (turnId) seen.add(turnId);
    indices.push(index);
  }
  // Only parse the requested page; a long ST chat must not reparse every old
  // transcript each time a new phone message arrives.
  return (limit > 0 ? indices.slice(-limit) : indices).flatMap((index) => {
    const mapped = mapTurn(index);
    return mapped ? [mapped] : [];
  });
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
  extra?: StRecord;
}

function makeMessages(input: InsertMessageInput, stableId?: string): StRecord[] {
  const context = ctx();
  const role = input.role ?? 'assistant';
  const content = input.content ?? '';
  const block = role === 'assistant' ? transcriptBlock(content) : null;
  // A phone response is ONE ST turn. Its YAML already attributes each bubble;
  // splitting it creates extra roleplay turns and fires host automation per item.
  const character = block?.type === 'group' ? undefined : block
    ? resolvePhoneCharacter(block.target || block.contactname || '', input.characterId, context.characters, context.chatMetadata?.mochios?.phoneDataYaml)
    : context.characters.find((item) => input.characterId && String(item.avatar) === String(input.characterId));
  const extra: StRecord = { ...input.extra };
  for (const key of ['mochiosId', 'mochiosTurnId', 'mochiosTurnPart', 'mochiosTurnSwipes', 'mochiosTurnSwipeId']) delete extra[key];
  if (stableId) extra.mochiosId = stableId;
  if (block) {
    extra.mochiosCharacterId = character ? String(character.avatar) : null;
    extra.mochiosPhoneTranscript = { type: block.type, target: block.target };
  }
  const message: StRecord = {
    name: role === 'user' ? context.name1 || 'User'
      : characterDisplayName(character) || input.name || block?.target || context.name2 || 'Character',
    is_user: role === 'user', is_system: role === 'system', send_date: new Date().toISOString(),
    mes: content, extra,
    ...(role === 'assistant' && character ? {
      original_avatar: character.avatar,
      force_avatar: context.getThumbnailUrl?.('avatar', character.avatar) || `/characters/${encodeURIComponent(character.avatar)}`,
    } : role === 'assistant' && block ? { force_avatar: '/img/ai4.png' } : {}),
  };
  if (role === 'assistant') {
    message.swipe_id = 0;
    message.swipes = [content];
    message.swipe_info = [{ send_date: message.send_date, gen_started: null, gen_finished: null, extra: { ...extra } }];
  }
  return [message];
}

async function emitMessage(context: StContext, name: string, index: number): Promise<void> {
  const type = context.eventTypes?.[name] ?? name;
  await context.eventSource?.emit?.(type, index, 'mochios');
}

function assertMessageChat(chat: StRecord[], chatId: string | null): void {
  if (ctx().chat !== chat || activeChatId() !== chatId) throw new Error('Mochi OS: the chat changed');
}

/** Repaint the host without reloading its chat file or emitting a false CHAT_CHANGED. */
async function repaintChat(context: StContext): Promise<void> {
  if (typeof context.printMessages !== 'function') return;
  if (typeof document !== 'undefined') document.getElementById('chat')?.querySelectorAll('.mes, #show_more_messages').forEach((element) => element.remove());
  await context.printMessages();
}

/** Follow ST's received → render → rendered → save lifecycle once per turn. */
export async function insertMessage(input: InsertMessageInput, atIndex?: number): Promise<Record<string, any>> {
  const context = ctx();
  const chatId = activeChatId();
  const chat = context.chat;
  const index = atIndex === undefined ? chat.length : Math.max(0, Math.min(atIndex, chat.length));
  const appended = index === chat.length;
  const messages = makeMessages(input);
  chat.splice(index, 0, ...messages);
  messages.forEach((_message, offset) => ensureMessageId(index + offset));
  const result = mapTurn(index)!;
  for (let offset = 0; offset < messages.length; offset += 1) {
    const message = messages[offset];
    await emitMessage(context, message.is_user ? 'MESSAGE_SENT' : 'MESSAGE_RECEIVED', index + offset);
    assertMessageChat(chat, chatId);
    if (appended) context.addOneMessage?.(message, { forceId: index + offset });
    else if (offset === 0) await repaintChat(context);
    assertMessageChat(chat, chatId);
    await emitMessage(context, message.is_user ? 'USER_MESSAGE_RENDERED' : 'CHARACTER_MESSAGE_RENDERED', index + offset);
    assertMessageChat(chat, chatId);
  }
  await context.saveChat?.();
  return result;
}

async function replaceTurn(id: string, content: string, swipes?: string[], swipeId = 0, eventName = 'MESSAGE_UPDATED'): Promise<Record<string, any> | null> {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const context = ctx();
  const chatId = activeChatId();
  const chat = context.chat;
  const indices = turnIndices(index);
  const first = indices[0];
  const previous = chat[first];
  const messages = makeMessages({ role: 'assistant', characterId: mapMessage(first)?.characterId, name: previous.is_user ? undefined : previous.name, content, extra: previous.extra }, ensureMessageId(first)!);
  if (previous.extra?.mochiosTurnId) messages[0].extra.mochiosId = previous.extra.mochiosTurnId;
  for (const position of [...indices].reverse()) chat.splice(position, 1);
  chat.splice(first, 0, ...messages);
  messages.forEach((message, offset) => {
    if (offset === 0) message.send_date = previous.send_date;
    ensureMessageId(first + offset);
  });
  if (swipes) {
    messages[0].swipes = swipes;
    messages[0].swipe_id = swipeId;
    messages[0].swipe_info = swipes.map(() => ({ send_date: previous.send_date, gen_started: null, gen_finished: null, extra: { ...messages[0].extra } }));
  }
  await repaintChat(context);
  assertMessageChat(chat, chatId);
  await emitMessage(context, eventName, first);
  assertMessageChat(chat, chatId);
  await context.saveChat?.();
  return mapTurn(first);
}

export async function updateMessageContent(id: string, content: string): Promise<Record<string, any> | null> {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const context = ctx();
  const chatId = activeChatId();
  const message = context.chat[index];
  if (message.extra?.mochiosTurnId) {
    const turn = mapTurn(index)!;
    const swipes = turn.swipes?.length ? [...turn.swipes] : [turn.content];
    swipes[turn.activeSwipeIndex] = content;
    return replaceTurn(id, content, swipes, turn.activeSwipeIndex);
  }
  const isSwipe = Array.isArray(message.swipes) && message.swipes.length > 0;
  if (isSwipe) {
    const swipeIndex = Number(message.swipe_id ?? 0);
    message.swipes[swipeIndex] = content;
  }
  message.mes = content;
  context.updateMessageBlock?.(index, message);
  await emitMessage(context, 'MESSAGE_EDITED', index);
  assertMessageChat(context.chat, chatId);
  await emitMessage(context, 'MESSAGE_UPDATED', index);
  assertMessageChat(context.chat, chatId);
  await context.saveChat?.();
  return mapTurn(index);
}

export async function deleteMessage(id: string): Promise<boolean> {
  const index = messageIndexOf(id);
  if (index < 0) return false;
  const context = ctx();
  const chatId = activeChatId();
  for (const position of turnIndices(index).reverse()) context.chat.splice(position, 1);
  await repaintChat(context);
  assertMessageChat(context.chat, chatId);
  await emitMessage(context, 'MESSAGE_DELETED', context.chat.length);
  assertMessageChat(context.chat, chatId);
  await context.saveChat?.();
  return true;
}

export function mergeMessageExtra(id: string, patch: Record<string, any>): Record<string, any> | null {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const message = ctx().chat[index];
  if (!message.extra || typeof message.extra !== 'object') message.extra = {};
  Object.assign(message.extra, patch);
  saveChat();
  return mapTurn(index);
}

export async function appendSwipe(id: string, content: string): Promise<Record<string, any> | null> {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const message = ctx().chat[index];
  if (message.extra?.mochiosTurnId) {
    const turn = mapTurn(index)!;
    const swipes = [...(turn.swipes?.length ? turn.swipes : [turn.content]), content];
    return replaceTurn(id, content, swipes, swipes.length - 1, 'MESSAGE_SWIPED');
  }
  if (!Array.isArray(message.swipes) || message.swipes.length === 0) {
    message.swipes = [message.mes ?? ''];
  }
  message.swipes.push(content);
  message.swipe_id = message.swipes.length - 1;
  message.mes = content;
  message.swipe_info ??= [];
  while (message.swipe_info.length < message.swipes.length) {
    message.swipe_info.push({ send_date: message.send_date, gen_started: null, gen_finished: null, extra: { ...message.extra } });
  }
  const context = ctx();
  const chatId = activeChatId();
  context.addOneMessage?.(message, { type: 'swipe', forceId: index, scroll: false });
  await emitMessage(context, 'MESSAGE_SWIPED', index);
  assertMessageChat(context.chat, chatId);
  await context.saveChat?.();
  return mapMessage(index);
}

export async function setActiveSwipe(id: string, swipeIndex: number): Promise<Record<string, any> | null> {
  const index = messageIndexOf(id);
  if (index < 0) return null;
  const message = ctx().chat[index];
  if (message.extra?.mochiosTurnId) {
    const turn = mapTurn(index)!;
    const swipes = turn.swipes?.length ? turn.swipes : [turn.content];
    const next = Math.max(0, Math.min(Number.isFinite(swipeIndex) ? Math.floor(swipeIndex) : 0, swipes.length - 1));
    return replaceTurn(id, swipes[next], swipes, next, 'MESSAGE_SWIPED');
  }
  if (!Array.isArray(message.swipes) || message.swipes.length === 0) {
    message.swipes = [message.mes ?? ''];
  }
  const clamped = Math.max(0, Math.min(Number.isFinite(swipeIndex) ? Math.floor(swipeIndex) : 0, message.swipes.length - 1));
  message.swipe_id = clamped;
  message.mes = message.swipes[clamped] ?? message.mes;
  const context = ctx();
  const chatId = activeChatId();
  context.addOneMessage?.(message, { type: 'swipe', forceId: index, scroll: false });
  await emitMessage(context, 'MESSAGE_SWIPED', index);
  assertMessageChat(context.chat, chatId);
  await context.saveChat?.();
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
