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
import { listLorebooks, readLorebookEntries, scanLorebooks } from './lorebooks';
import { editPhoneMessage, updatePhoneMessageReactions } from './phone-actions';

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
  specificity: number;
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
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, specificity: path.replace(/:[^/]+/g, '').length });
  // Phone callers use both encoded and raw owner/chat ids, so parameters can
  // span slashes. Specific suffixes must win over /chats/:chatId itself.
  routes.sort((a, b) => b.specificity - a.specificity);
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
  const group = isGroup && context.groupId
    ? context.groups?.find((item: Record<string, any>) => String(item.id) === String(context.groupId))
    : null;
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
    metadata: {
      ...(context.chatMetadata ?? {}),
      activeLorebookIds: [...new Set([
        ...(Array.isArray(context.chatMetadata?.activeLorebookIds) ? context.chatMetadata.activeLorebookIds : []),
        ...(typeof context.chatMetadata?.world_info === 'string' && context.chatMetadata.world_info ? [context.chatMetadata.world_info] : []),
      ])],
    },
    characterIds,
    characterId: characterIds[0] ?? null,
    personaId: st.activePersonaId(),
    userName: context.name1 || 'User',
    personaCharacterId: null,
    groupId: context.groupId ? String(context.groupId) : null,
    mode: isGroup ? 'group' : 'solo',
  };
}

route('GET', '/chats/:chatId', (_request, params) => {
  assertCurrentChat(params.chatId);
  return buildChat();
});

/** A phone-specific choice belongs to this roleplay, never every other chat. */
route('PUT', '/chats/:chatId/mochi-persona', (request, params) => {
  assertCurrentChat(params.chatId);
  const personaId = request.body?.personaId;
  if (typeof personaId !== 'string' || !st.listPersonas().some((persona) => persona.id === personaId)) {
    throw new ApiError(400, 'Mochi OS: the selected persona no longer exists');
  }
  st.writeChatMeta({ ...st.readChatMeta(), linkedPersonaId: personaId });
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

route('DELETE', '/chats/:chatId/messages/:messageId', async (_request, params) => {
  assertCurrentChat(params.chatId);
  return { deleted: await st.deleteMessage(params.messageId) };
});

route('PATCH', '/chats/:chatId/messages/:messageId/extra', (request, params) => {
  assertCurrentChat(params.chatId);
  const patch = request.body && typeof request.body === 'object' ? request.body : {};
  return st.mergeMessageExtra(params.messageId, patch);
});

route('PATCH', '/chats/:chatId/messages/:messageId/phone-reactions', (request, params) => {
  assertCurrentChat(params.chatId);
  const body = request.body ?? {};
  if (!Number.isInteger(body.itemIndex) || body.itemIndex < 0 || !Array.isArray(body.reactions)) throw new ApiError(400, 'Invalid phone reaction target');
  if (body.recordIndex !== undefined && (!Number.isInteger(body.recordIndex) || body.recordIndex < 0)) throw new ApiError(400, 'Invalid phone record target');
  return updatePhoneMessageReactions({
    messageId: params.messageId, recordType: body.recordType === 'group' ? 'group' : 'private',
    targetName: String(body.targetName ?? ''), recordIndex: body.recordIndex, itemIndex: body.itemIndex, itemId: body.itemId,
    reactions: body.reactions,
  });
});

route('PATCH', '/chats/:chatId/messages/:messageId/phone-message', (request, params) => {
  assertCurrentChat(params.chatId);
  const body = request.body ?? {};
  if (!Number.isInteger(body.itemIndex) || body.itemIndex < 0 || (typeof body.content !== 'string' && body.delete !== true)) throw new ApiError(400, 'Invalid phone message edit');
  if (body.recordIndex !== undefined && (!Number.isInteger(body.recordIndex) || body.recordIndex < 0)) throw new ApiError(400, 'Invalid phone record target');
  if (body.expectedContent !== undefined && typeof body.expectedContent !== 'string') throw new ApiError(400, 'Invalid phone edit snapshot');
  return editPhoneMessage({
    messageId: params.messageId, recordType: body.recordType === 'group' ? 'group' : 'private',
    targetName: String(body.targetName ?? ''), recordIndex: body.recordIndex, itemIndex: body.itemIndex, itemId: body.itemId,
    content: body.content, delete: body.delete === true, expectedContent: body.expectedContent,
  });
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
  const index = upToMessageId ? st.messageEndIndexOf(String(upToMessageId)) : -1;
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

route('GET', '/lorebooks', () => listLorebooks());

route('GET', '/lorebooks/:id/entries', async (_request, params) => {
  return { entries: await readLorebookEntries(params.id) };
});

/**
 * The entries SillyTavern would insert into a prompt for this chat.
 *
 * The port takes the books the chat actually has attached — the one selected for
 * the chat and the character's own embedded book — rather than every keyword
 * match, because Mochi OS asks for the chat's lore, not for a keyword scan of a
 * specific prompt.
 */
route('GET', '/lorebooks/scan/:chatId', async (_request, params) => {
  assertCurrentChat(params.chatId);
  const result = await scanLorebooks();
  assertCurrentChat(params.chatId);
  return result;
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
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('mochios:settings', { detail: { key: params.key } }));
  return { key: params.key, value: typeof value === 'string' ? value : JSON.stringify(value) };
});

/* ------------------------------------------------------------------ *
 * Mochi OS phone data
 * ------------------------------------------------------------------ */

route('GET', '/mochios-data/:chatId', (request, params) => {
  assertCurrentChat(params.chatId);
  return readPhoneData(request.query.get('category') ?? undefined);
});

route('PUT', '/mochios-data/:chatId', (request, params) => {
  assertCurrentChat(params.chatId);
  const rawYaml = request.body?.rawYaml;
  // A targeted per-message write carries no document; the port has no server
  // file to patch, and Mochi OS edits thread messages through the chat API
  // instead, so the stored document is returned untouched.
  if (typeof rawYaml !== 'string') return readPhoneData();
  return savePhoneData(rawYaml);
});

route('DELETE', '/mochios-data/:chatId', (_request, params) => {
  assertCurrentChat(params.chatId);
  return deletePhoneData();
});

route('POST', '/mochios-data/:chatId/generate', async (request, params) => {
  assertCurrentChat(params.chatId);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  st.onEvent('CHAT_CHANGED', cancel);
  request.signal?.addEventListener('abort', cancel, { once: true });
  if (request.signal?.aborted) cancel();
  try {
    const result = await generatePhoneData({
      chatId: params.chatId,
      messages: Array.isArray(request.body?.messages) ? request.body.messages : [],
      userPrompt: request.body?.userPrompt,
      category: request.body?.category,
      contactName: request.body?.contactName,
      characterName: request.body?.characterName,
      userName: request.body?.userName,
      continuationOnly: Boolean(request.body?.continuationOnly),
      userMessages: Array.isArray(request.body?.userMessages) ? request.body.userMessages : undefined,
      signal: controller.signal,
    });
    assertCurrentChat(params.chatId);
    return result;
  } finally {
    st.offEvent('CHAT_CHANGED', cancel);
    request.signal?.removeEventListener('abort', cancel);
  }
});

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
