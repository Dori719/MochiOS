/**
 * The engine's HTTP surface, served from inside the extension.
 *
 * The engine's client talks to a Fastify server through `api.get/post/...`. The
 * port keeps that client code unchanged, so this module answers the same routes
 * — and only those routes — against SillyTavern instead: chats and messages come
 * from the open chat, characters and personas from the card list, the phone
 * document from chat metadata.
 *
 * Routing is a small table of method + path patterns. Requests that do not match
 * fail loudly rather than silently returning `undefined`, because a missing
 * route in this layer shows up as an inexplicably empty panel.
 */
import * as st from './adapter';
import { deletePhoneData, generatePhoneData, readPhoneData, savePhoneData } from './mochi-data';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
  /** Present on a generation request so a stopped generation stops retrying. */
  signal?: AbortSignal;
}

type Handler = (request: Request, params: Record<string, string>) => any | Promise<any>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

/** Register a route from a `/chats/:chatId/messages/:id` style path. */
function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const source = path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      keys.push(segment.slice(1));
      return '(.+?)';
    })
    .join('/');
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
}

function splitPath(path: string): { pathname: string; query: URLSearchParams } {
  const index = path.indexOf('?');
  if (index < 0) return { pathname: path, query: new URLSearchParams() };
  return { pathname: path.slice(0, index), query: new URLSearchParams(path.slice(index + 1)) };
}

export async function request(
  method: string,
  input: string,
  body?: any,
  options?: { signal?: AbortSignal },
): Promise<any> {
  const { pathname, query } = splitPath(input);
  const upper = method.toUpperCase();
  for (const candidate of routes) {
    if (candidate.method !== upper) continue;
    const match = candidate.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    candidate.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? '');
    });
    return candidate.handler({ method: upper, path: pathname, query, body, signal: options?.signal }, params);
  }
  throw new ApiError(404, `Mochi OS: no handler for ${upper} ${pathname}`);
}

/* ------------------------------------------------------------------ *
 * Chats
 * ------------------------------------------------------------------ */

/** Refuse a request aimed at a stale chat so a switch invalidates the panel. */
function assertCurrentChat(chatId: string | undefined): void {
  const current = st.activeChatId();
  if (!current) throw new ApiError(409, 'Mochi OS: no chat is open');
  if (chatId && chatId !== current) throw new ApiError(409, 'Mochi OS: the chat changed');
}

function buildChat(): Record<string, any> {
  const context = st.ctx();
  const id = st.activeChatId();
  if (!id) throw new ApiError(409, 'Mochi OS: no chat is open');
  const isGroup = st.isGroupChat();
  const group = isGroup && context.groupId ? context.groups?.[context.groupId] : null;
  const owner = st.activeOwner() ?? '';
  const characterIds = isGroup
    ? (Array.isArray(group?.members) ? group.members : []).map((member: string) => {
        const character = context.characters.find((item) => item.avatar === member);
        return String(character?.avatar ?? member);
      })
    : owner && !owner.startsWith('group:')
      ? [owner]
      : [];
  const first = characterIds.length
    ? context.characters.find((item) => String(item.avatar) === characterIds[0])
    : undefined;
  const name = isGroup
    ? String(group?.name ?? 'Group chat')
    : String(first?.data?.name || first?.name || st.currentChatFile());
  return {
    id,
    name,
    metadata: context.chatMetadata ?? {},
    characterIds,
    characterId: characterIds[0] ?? null,
    personaId: st.activePersonaId(),
    personaCharacterId: null,
    groupId: context.groupId ? String(context.groupId) : null,
    mode: isGroup ? 'group' : 'solo',
  };
}

route('GET', '/chats/:chatId', (_request, params) => {
  assertCurrentChat(params.chatId);
  return buildChat();
});

route('GET', '/chats/:chatId/messages', (request, params) => {
  assertCurrentChat(params.chatId);
  const limit = Number(request.query.get('limit') ?? 0) || 0;
  const before = request.query.get('before');
  return st.listMessages(limit, before);
});

route('POST', '/chats/:chatId/messages', (request, params) => {
  assertCurrentChat(params.chatId);
  const body = request.body ?? {};
  return st.insertMessage({
    role: body.role ?? 'assistant',
    characterId: body.characterId ?? null,
    content: String(body.content ?? body.mes ?? ''),
    name: body.name,
  });
});

route('DELETE', '/chats/:chatId/messages/:messageId', (_request, params) => {
  assertCurrentChat(params.chatId);
  return { deleted: st.deleteMessage(params.messageId) };
});

route('PATCH', '/chats/:chatId/messages/:messageId/extra', (request, params) => {
  assertCurrentChat(params.chatId);
  const patch = request.body && typeof request.body === 'object' ? request.body : {};
  return st.mergeMessageExtra(params.messageId, patch);
});

route('POST', '/chats/:chatId/messages/:messageId/swipes', (request, params) => {
  assertCurrentChat(params.chatId);
  return st.appendSwipe(params.messageId, String(request.body?.content ?? ''));
});

route('PUT', '/chats/:chatId/messages/:messageId/active-swipe', (request, params) => {
  assertCurrentChat(params.chatId);
  return st.setActiveSwipe(params.messageId, Number(request.body?.index ?? 0));
});

/**
 * Replace a message's content.
 *
 * Registered after the `active-swipe` route on purpose: a path parameter matches
 * across slashes, so the more specific suffix has to be tried first.
 */
route('PUT', '/chats/:chatId/messages/:messageId', (request, params) => {
  assertCurrentChat(params.chatId);
  return st.updateMessageContent(params.messageId, String(request.body?.content ?? ''));
});

route('PUT', '/chats/:chatId/messages/:messageId', (request, params) => {
  assertCurrentChat(params.chatId);
  return st.updateMessageContent(params.messageId, String(request.body?.content ?? ''));
});

/**
 * Branch the chat at a message.
 *
 * SillyTavern owns branching (it has to copy the metadata, rewrite the chat file
 * and switch to it), so the route delegates to its own `/branch-create` command
 * rather than reimplementing it.
 */
route('POST', '/chats/:chatId/branch', async (request, params) => {
  assertCurrentChat(params.chatId);
  const upToMessageId = request.body?.upToMessageId;
  const index = upToMessageId ? st.messageIndexOf(String(upToMessageId)) : -1;
  const target = index >= 0 ? index : st.ctx().chat.length - 1;
  await st.st().executeSlashCommandsWithOptions(`/branch-create ${target}`);
  return buildChat();
});

/* ------------------------------------------------------------------ *
 * Characters and personas
 * ------------------------------------------------------------------ */

route('GET', '/characters', () => st.listCharacters());

route('GET', '/characters/personas/list', () => st.listPersonas());

route('PATCH', '/characters/personas/:id', (request, params) =>
  st.updatePersona(params.id, request.body && typeof request.body === 'object' ? request.body : {}),
);

/* ------------------------------------------------------------------ *
 * Lorebooks (SillyTavern world info)
 * ------------------------------------------------------------------ */

interface StWorldEntry {
  uid?: number | string;
  key?: string[];
  content?: string;
  disable?: boolean;
  comment?: string;
}

interface StWorldBook {
  entries?: Record<string, StWorldEntry>;
}

function worldEntryToLorebookEntry(bookName: string, uid: string, entry: StWorldEntry) {
  return {
    id: `${bookName}:${uid}`,
    lorebookId: bookName,
    keys: Array.isArray(entry.key) ? entry.key : [],
    content: String(entry.content ?? ''),
    enabled: !entry.disable,
    comment: entry.comment ?? '',
  };
}

route('GET', '/lorebooks', () => {
  const names: string[] = st.ctx().getWorldInfoNames?.() ?? [];
  return names.map((name) => ({
    id: name,
    name,
    description: '',
    enabled: true,
    isGlobal: true,
    hiddenFromLibrary: false,
    scope: { mode: 'all', chatIds: [] },
    characterIds: [],
    personaIds: [],
    sourceAgentId: null,
    entries: [],
  }));
});

route('GET', '/lorebooks/:id/entries', async (_request, params) => {
  const book = (await st.ctx().loadWorldInfo?.(params.id)) as StWorldBook | null;
  const entries = Object.entries(book?.entries ?? {}).map(([uid, entry]) =>
    worldEntryToLorebookEntry(params.id, uid, entry),
  );
  return { entries };
});

/**
 * The entries SillyTavern would insert into a prompt for this chat.
 *
 * The port takes the books the chat actually has attached — the one selected for
 * the chat and the character's own embedded book — rather than every keyword
 * match, because Mochi OS asks for the chat's lore, not for a keyword scan of a
 * specific prompt.
 */
route('GET', '/lorebooks/scan/:chatId', async () => {
  const context = st.ctx();
  const names = new Set<string>();
  const selected = context.chatMetadata?.world_info;
  if (selected) names.add(String(selected));
  const owner = st.activeOwner();
  if (owner && !owner.startsWith('group:')) {
    const character = context.characters.find((item) => String(item.avatar) === owner);
    const embedded = character?.data?.character_book?.name;
    if (embedded) names.add(String(embedded));
  }
  const entries: Array<Record<string, any>> = [];
  for (const name of names) {
    const book = (await context.loadWorldInfo?.(name)) as StWorldBook | null;
    for (const [uid, entry] of Object.entries(book?.entries ?? {})) {
      if (entry.disable) continue;
      entries.push(worldEntryToLorebookEntry(name, uid, entry));
    }
  }
  return { entries, lorebookIds: [...names] };
});

/* ------------------------------------------------------------------ *
 * Presets, capability packages, settings
 * ------------------------------------------------------------------ */

route('GET', '/prompts', () => []);

route('GET', '/capability-packages/installed', () => []);

route('GET', '/app-settings/:key', (_request, params) => {
  const settings = st.readChatSettings();
  return { key: params.key, value: JSON.stringify(settings[params.key] ?? null) };
});

route('PUT', '/app-settings/:key', (request, params) => {
  const value = request.body?.value;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  st.writeChatSettings({ [params.key]: parsed });
  return { key: params.key, value: typeof value === 'string' ? value : JSON.stringify(value) };
});

/* ------------------------------------------------------------------ *
 * Mochi OS phone data
 * ------------------------------------------------------------------ */

route('GET', '/mochios-data/:chatId', (request) =>
  readPhoneData(request.query.get('category') ?? undefined),
);

route('PUT', '/mochios-data/:chatId', (request) => {
  const rawYaml = request.body?.rawYaml;
  // A targeted per-message write carries no document; the port has no server
  // file to patch, and Mochi OS edits thread messages through the chat API
  // instead, so the stored document is returned untouched.
  if (typeof rawYaml !== 'string') return readPhoneData();
  return savePhoneData(rawYaml);
});

route('DELETE', '/mochios-data/:chatId', () => deletePhoneData());

route('POST', '/mochios-data/:chatId/generate', (request) =>
  generatePhoneData({
    messages: Array.isArray(request.body?.messages) ? request.body.messages : [],
    userPrompt: request.body?.userPrompt,
    category: request.body?.category,
    contactName: request.body?.contactName,
    characterName: request.body?.characterName,
    userName: request.body?.userName,
    continuationOnly: Boolean(request.body?.continuationOnly),
    signal: request.signal,
  }),
);

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

/**
 * Translate through SillyTavern's own `/translate` command when its Translate
 * extension is installed, and report an empty result when it is not — the caller
 * surfaces a failure toast, which is the honest outcome.
 */
route('POST', '/translation/translate', async (request) => {
  const text = String(request.body?.text ?? '');
  if (!text.trim()) return { translated: '' };
  try {
    const out = await st.st().executeSlashCommandsWithOptions(`/translate ${text}`);
    return { translated: typeof out === 'string' ? out.trim() : '' };
  } catch {
    return { translated: '' };
  }
});
