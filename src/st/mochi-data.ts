/**
 * Mochi OS phone storage and thread archiving.
 *
 * The engine kept a `phone_data` YAML file per chat and archived each thread
 * turn into the roleplay transcript. Both survive here, mapped onto SillyTavern:
 *
 * - The phone document (contacts, groups, the user's own profile) lives in the
 *   open chat's metadata, which SillyTavern writes into the first line of the
 *   chat's JSONL — so a phone travels with export, import and branching.
 * - Thread turns stay in roleplay message history, exactly as in the engine. The
 *   Mochi OS view itself inserts them through the chat API, so nothing is
 *   duplicated here; this module only produces the canonical turn text.
 */
import yaml from 'yaml';
import type { MochiOsPhoneData, MochiOsPhoneDataResponse } from '../shared';
import { readChatMeta, writeChatMeta } from './adapter';
import { generateMochiOutput } from './generate';
import { refreshLorebookPrompt } from './lorebooks';
import { readMochiSettings } from './mochi-settings';
import { renderMochiPhotos } from './image-generation';
import {
  cleanAndExtractRawYaml,
  isMochiGroupRecordTag,
  parseMochiChatResponse,
  parseChatHistoryBlocks,
  parseEnvironmentYaml,
  serializeChatHistoryYaml,
  type MochiChatRecordType,
} from '../components/chat/mochi-os/mochi-os.utils';
import type { MochiMessage } from '../components/chat/mochi-os/mochi-os.types';

const THREAD_CATEGORIES = new Set(['private_chats', 'group_chats']);
const THREAD_OUTPUT_TAGS = 'chat_history|privatechat_history|groupchat_history|group_message|messages|message|private_chat|chat|environment';
// A tag mentioned in reasoning is not a block opener. Never let an unfinished
// mention consume the next real environment (and hide its intervening reply).
const ENVIRONMENT_BLOCK = /<environment\b[^>]*>(?:(?!<environment\b)[\s\S])*?<\/environment\s*>/gi;

function environmentBlocks(text: string): string[] {
  return [...text.matchAll(ENVIRONMENT_BLOCK)].map((match) => match[0]);
}

/** Keep environment payloads opaque while still discarding a hidden outer block. */
function preserveEnvironmentBlocks(text: string, clean: (masked: string) => string): string {
  const environments: string[] = [];
  // Keep an environment-shaped marker so a stray prefill reasoning closer can
  // still recognize this prefix as real output, not hidden thoughts.
  const masked = text.replace(ENVIRONMENT_BLOCK, (block) => `<environment>\u0000mochi-environment:${environments.push(block) - 1}\u0000</environment>`);
  return clean(masked).replace(/<environment>\u0000mochi-environment:(\d+)\u0000<\/environment>/g, (token, index) => environments[Number(index)] ?? token);
}

/** Foreign XML blocks are model commentary, not transcript/data fields. */
function stripUnrelatedOutputTags(text: string, allowedTags: string): string {
  // Environment YAML is opaque output, not commentary. Mask it while cleaning
  // other tags so comments, custom fields and tag-like scalar values survive.
  // A foreign outer block (e.g. <debug>) still removes any masked data inside it.
  const clean = (source: string) => {
    const foreignBlock = new RegExp(`<(?!(${allowedTags})\\b)([a-z][\\w:-]*)\\b[^>]*>[\\s\\S]*?<\\/\\2\\s*>`, 'gi');
    let cleaned = source;
    let previous: string;
    do {
      previous = cleaned;
      cleaned = cleaned.replace(foreignBlock, '');
    } while (cleaned !== previous);
    return cleaned
      .replace(new RegExp(`<\\/?(?!(?:${allowedTags})\\b)[a-z][\\w:-]*\\b[^>]*>`, 'gi'), '')
      .replace(/<\|[^>]*\|>/g, '');
  };
  return allowedTags.split('|').includes('environment') ? preserveEnvironmentBlocks(text, clean) : clean(text);
}

interface StoredMeta {
  phoneDataYaml?: string;
}

function isThreadCategory(category?: string): boolean {
  return THREAD_CATEGORIES.has(String(category ?? ''));
}

function recordTypeFor(category?: string): MochiChatRecordType {
  return category === 'group_chats' ? 'group' : 'private';
}

function storeMeta(): StoredMeta {
  return readChatMeta() as StoredMeta;
}

/** Parse a stored phone document, tolerating a document that is only text. */
function parsePhoneData(rawYaml: string): MochiOsPhoneData | null {
  const document = extractDocument(rawYaml);
  if (!document) return null;
  try {
    const parsed = yaml.parse(document);
    if (!parsed || typeof parsed !== 'object') return null;
    // The format guide nests its document under phone_data, while the view
    // consumes user/characters/groups directly. Keep the editor YAML untouched.
    const phone = parsed.phone_data && typeof parsed.phone_data === 'object' ? parsed.phone_data : parsed;
    return phone as MochiOsPhoneData;
  } catch (error) {
    console.warn('[Mochi OS] stored phone data is not valid YAML', error);
    return null;
  }
}

/**
 * The document inside a raw reply.
 *
 * A model answers with its `<phone_data>` wrapper (the format guide asks for
 * one), and older stored data can still carry it. The wrapper is not part of the
 * document, so it is removed before anything parses or saves it — while the
 * document's own comments survive, because they are what the editor shows.
 */
function extractDocument(rawText: string): string {
  const cleaned = unwrapPhoneDataXml(cleanAndExtractRawYaml(rawText ?? '')).trim();
  if (!cleaned) return '';
  const tagged = cleaned.match(/<phone_data>([\s\S]*?)<\/phone_data>/i);
  return (tagged ? tagged[1] : cleaned).trim();
}

/** Some providers wrap the requested YAML in a generic XML envelope. */
function unwrapPhoneDataXml(text: string): string {
  return text.replace(/<xml\s*>\s*(phone_data\s*:[\s\S]*?)\s*<\/xml\s*>/gi, '$1');
}

/** `GET /mochios-data/:chatId` — the phone document for the open chat. */
export function readPhoneData(category?: string): MochiOsPhoneDataResponse {
  if (isThreadCategory(category)) {
    // Thread categories are read from roleplay message history, which the Mochi
    // OS view parses itself; there is no file to return.
    return { phoneData: null, rawYaml: null, logYaml: null };
  }
  const rawYaml = typeof storeMeta().phoneDataYaml === 'string' ? (storeMeta().phoneDataYaml as string) : '';
  return {
    phoneData: parsePhoneData(rawYaml),
    rawYaml: rawYaml || null,
    logYaml: null,
  };
}

/** `PUT /mochios-data/:chatId` — store the phone document. */
export function savePhoneData(rawYaml: string): MochiOsPhoneDataResponse {
  const cleaned = extractDocument(rawYaml ?? '');
  const meta = readChatMeta();
  writeChatMeta({ ...meta, phoneDataYaml: cleaned });
  return { phoneData: parsePhoneData(cleaned), rawYaml: cleaned || null, logYaml: null };
}

/** `DELETE /mochios-data/:chatId` — drop the phone document. */
export function deletePhoneData(): MochiOsPhoneDataResponse {
  const meta = { ...readChatMeta() };
  delete meta.phoneDataYaml;
  writeChatMeta(meta);
  return { phoneData: null, rawYaml: null, logYaml: null };
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * The user's own lines, as the engine's server resolved them.
 *
 * `continuationOnly` means the user asked for another reply without typing
 * anything, so the trailing instruction is not something they said and must not
 * be archived. Otherwise the explicit prompt wins, falling back to the last
 * user-role message in the assembled prompt.
 */
export function resolveUserMessageLines(params: {
  userPrompt?: string;
  messages?: Array<{ role?: string; content?: string }>;
  continuationOnly?: boolean;
}): string[] {
  if (params.continuationOnly) return [];

  const clean = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\[Text\]\s*/i, '').trim())
      .filter((line) => line.length > 0 && line !== '[Start Interaction]');

  if (typeof params.userPrompt === 'string' && params.userPrompt.trim()) {
    return clean(params.userPrompt);
  }

  const lastUser = [...(params.messages ?? [])].reverse().find((message) => message?.role === 'user');
  return lastUser?.content ? clean(lastUser.content) : [];
}

function isUserItem(rawItem?: Record<string, any>): boolean {
  const flag = rawItem?.['{{user}}'];
  return flag === true || flag === 'true' || flag === 1 || flag === '1' || rawItem?.me === 1 || rawItem?.me === true || rawItem?.user === true || rawItem?.isUser === true;
}

function nowClock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Turn the user's resolved lines into record items, keeping quote replies. */
function userItems(
  lines: string[],
  time: string,
  userName: string | undefined,
  recordType: MochiChatRecordType,
): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sender = recordType === 'group' && userName ? { sender: userName } : {};
    const quoteMatch = /^\[Quote(?:\s+([^\]]+))?\]\s*([\s\S]*)$/i.exec(line);
    if (quoteMatch) {
      const next = lines[index + 1] ?? '';
      out.push({
        me: 1,
        type: 'quote',
        text: next,
        t: time,
        rawItem: {
          t: 'quote',
          quote: { ...(quoteMatch[1] ? { name: quoteMatch[1].trim() } : {}), c: quoteMatch[2].trim() },
        },
        ...sender,
      });
      index += 1;
      continue;
    }
    if (line.startsWith('[Quote')) {
      out.push({ me: 1, type: 'quote', text: '', t: time, rawItem: { t: 'quote' }, ...sender });
      continue;
    }
    const sticker = /^\[Sticker\]\s*(.+)$/i.exec(line);
    if (sticker) {
      out.push({ me: 1, type: 'sticker', text: sticker[1].trim(), t: time, ...sender });
      continue;
    }
    out.push({ me: 1, type: 'text', text: line, t: time, ...sender });
  }
  return out;
}

export interface GeneratePhoneDataInput {
  profileId?: string | null;
  chatId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | string; content: string; name?: string }>;
  userPrompt?: string;
  category?: string;
  contactName?: string;
  characterName?: string;
  userName?: string;
  continuationOnly?: boolean;
  /** Authored phone bubbles, not model echoes or lossy text markers. */
  userMessages?: MochiMessage[];
  signal?: AbortSignal;
}

/** Select only this request's output envelope, not prose or another phone app.
 * Old bare YAML remains readable, but XML from an unrelated response never
 * falls through into the parser's direct-message fallback. */
function extractGeneratedThread(cleaned: string, recordType: MochiChatRecordType, targetNames: string[]): { contents: string[]; environments: string[] } {
  const source = stripUnrelatedOutputTags(cleaned, THREAD_OUTPUT_TAGS);
  const pattern = /<(chat_history|privatechat_history|groupchat_history|group_message|messages|message|private_chat|chat)\b[^>]*>[\s\S]*?<\/(?:\1|chat_history|privatechat_history|groupchat_history|group_message)\s*>/gi;
  const records = [...source.matchAll(pattern)];
  const wantedNames = targetNames.map((name) => name.trim().toLowerCase());
  const selected = records.filter((match) => {
    const opener = match[0].slice(0, match[0].indexOf('>') + 1);
    const tag = match[1].toLowerCase();
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(opener)?.[1]?.toLowerCase();
    const target = /\btarget\s*=\s*["']([^"']+)["']/i.exec(opener)?.[1]?.trim().toLowerCase();
    if (target && !wantedNames.includes(target)) return false;
    if (type === 'private' || type === 'group') return type === recordType;
    if (isMochiGroupRecordTag(tag)) return recordType === 'group';
    if (tag === 'privatechat_history' || tag === 'private_chat') return recordType === 'private';
    return true;
  });
  if (!selected.length) {
    const content = source.replace(ENVIRONMENT_BLOCK, '').trim();
    if (records.length || /<\/?[a-z][\w-]*\b[^>]*>/i.test(content)) return { contents: [], environments: [] };
    return { contents: [content], environments: environmentBlocks(source) };
  }
  // Models may split one reply into several envelopes for the same thread.
  // Keep every matching envelope in order, still saving them as one native turn.
  return {
    contents: selected.map((record) => record[0].replace(ENVIRONMENT_BLOCK, '')),
    environments: selected.flatMap((record) => {
      const index = records.indexOf(record);
      // Environment can precede, sit inside or follow its record. Never borrow
      // metadata belonging to a neighbouring, unrelated thread.
      const start = index === 0 ? 0 : record.index!;
      const end = records[index + 1]?.index ?? source.length;
      return environmentBlocks(source.slice(start, end));
    }),
  };
}

/**
 * `POST /mochios-data/:chatId/generate`.
 *
 * A data generation returns the cleaned phone document. A thread generation
 * returns the canonical turn — the record the client then writes into roleplay
 * history — with the user's own lines folded in when the model did not echo
 * them, exactly as the engine's route did.
 */
export async function generatePhoneData(input: GeneratePhoneDataInput): Promise<{ rawOutput: string }> {
  const category = input.category ?? 'data_generation';
  const settings = readMochiSettings();
  const signal = input.signal;
  const prompt = await refreshLorebookPrompt(input.messages, input.userName);
  const raw = await generateMochiOutput(prompt, {
    profileId: settings.connectionProfileId,
    chatId: input.chatId,
    signal,
    isCancelled: () => Boolean(signal?.aborted),
  });
  const cleaned = preserveEnvironmentBlocks(raw, cleanAndExtractRawYaml);

  if (!isThreadCategory(category)) {
    const sourceWithEnvironment = stripUnrelatedOutputTags(unwrapPhoneDataXml(cleaned), 'phone_data|environment');
    const source = sourceWithEnvironment.replace(ENVIRONMENT_BLOCK, '');
    const document = source.match(/<phone_data\b[^>]*>([\s\S]*?)<\/phone_data\s*>/i)?.[1]?.trim();
    let output = document ? `<phone_data>\n${document}\n</phone_data>` : source.trim();
    if (!output || (!document && /<\/?[a-z][\w-]*\b[^>]*>/i.test(output))) throw new Error('Mochi OS returned no phone data');
    // Generation excludes pictures; restore user-managed values by stable ID
    // (or name for older documents) before the view saves the replacement YAML.
    const previous = readPhoneData().phoneData;
    const next = parsePhoneData(output);
    if (previous && next) {
      let restored = false;
      if (previous.user?.avatar !== undefined && next.user) {
        next.user.avatar = previous.user.avatar;
        restored = true;
      }
      for (const key of ['characters', 'groups', 'private_contacts'] as const) {
        for (const entry of next[key] ?? []) {
          const old = previous[key]?.find((item) => entry.id && item.id === entry.id)
            ?? previous[key]?.find((item) => entry.name && item.name === entry.name);
          if (old?.avatar !== undefined) { entry.avatar = old.avatar; restored = true; }
        }
      }
      if (restored) output = `<phone_data>\n${yaml.stringify({ phone_data: next }).trim()}\n</phone_data>`;
    }
    const environments = environmentBlocks(sourceWithEnvironment);
    // The storage parser needs a document boundary when old bare YAML is
    // followed by environment XML; the view still receives both intact.
    const phoneOutput = environments.length && !/^<phone_data\b/i.test(output) ? `<phone_data>\n${output}\n</phone_data>` : output;
    return { rawOutput: [phoneOutput, ...environments].join('\n\n') };
  }

  const recordType = recordTypeFor(category);
  const targetName = (recordType === 'group'
    ? input.contactName || input.characterName || 'Group'
    : input.characterName || input.contactName || 'Character').trim();
  const thread = extractGeneratedThread(cleaned, recordType, [targetName, input.contactName || '', input.characterName || '']);
  const parsed = thread.contents.flatMap((content) => {
    const replies = parseMochiChatResponse(content, targetName, { structuredOnly: true });
    // A valid earlier envelope must not hide a later incompatible message list.
    if (!replies.length) throw new Error('Mochi OS returned no incoming chat messages');
    return replies;
  });

  const firstTime = parsed.find((reply) => reply.time)?.time ?? nowClock();
  const lines = resolveUserMessageLines({
    userPrompt: input.userPrompt,
    messages: input.messages,
    continuationOnly: input.continuationOnly,
  });

  const messages: Array<Record<string, any>> = [];
  const authoredInputs = Array.isArray(input.userMessages) ? input.userMessages.filter((message) => message.me === 1) : null;
  if (authoredInputs && !input.continuationOnly) {
    messages.push(...authoredInputs.map((message) => ({
      ...message, me: 1, t: message.t || firstTime,
      ...(recordType === 'group' ? { sender: input.userName } : {}),
    })));
  }
  // Only fold the user's lines in when the model did not already archive them.
  if (!authoredInputs && lines.length > 0 && !parsed.some((reply) => isUserItem(reply.rawItem))) {
    messages.push(...userItems(lines, firstTime, input.userName, recordType));
  }
  for (const reply of parsed) {
    // Never archive a model-authored group line as though the user said it.
    if (recordType === 'group' && !isUserItem(reply.rawItem) && input.userName && reply.sender?.trim().toLowerCase() === input.userName.trim().toLowerCase()) continue;
    if (input.continuationOnly && isUserItem(reply.rawItem)) continue;
    if (authoredInputs && isUserItem(reply.rawItem)) continue;
    messages.push({
      me: isUserItem(reply.rawItem) ? 1 : 0,
      type: reply.type,
      text: reply.text,
      t: reply.time,
      dur: reply.dur,
      sender: reply.sender,
      rawItem: reply.rawItem,
    });
  }

  if (!messages.some((message) => message.me !== 1)) throw new Error('Mochi OS returned no incoming chat messages');

  await renderMochiPhotos(messages, settings, input.chatId, signal, input.characterName);

  const environment = parseEnvironmentYaml(thread.environments.at(-1) || '');
  const records = thread.contents.flatMap((content) => parseChatHistoryBlocks(content));
  const record = records[0];
  const finalOutput = serializeChatHistoryYaml({
    targetName,
    recordType,
    date: record?.date || environment?.date,
    time: record?.time || environment?.time,
    members: Math.max(...records.map((item) => item.members || 0)) || undefined,
    messages: messages as any,
    // Parsing is only for clock/date fallbacks; never use it to rewrite or
    // decide whether the generated environment is allowed into the transcript.
    environmentYaml: thread.environments.join('\n\n') || undefined,
  });

  return { rawOutput: finalOutput };
}
