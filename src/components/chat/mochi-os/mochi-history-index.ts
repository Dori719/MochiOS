import {
  mochiRoleplayBubbleId,
  parseChatHistoryBlocks,
  type MochiChatRecordType,
  type MochiRoleplayLocation,
  type ParsedChatHistoryBlock,
} from './mochi-os.utils';

interface RoleplayMessage {
  id: string;
  role?: string;
  content: string;
}

interface BubbleTarget {
  targetName: string;
  recordType?: MochiChatRecordType;
  threadIndex: number;
  threadMessageId?: string;
}

export interface MochiRoleplayHistoryIndex<T extends RoleplayMessage = RoleplayMessage> {
  records: Array<{ message: T; block: ParsedChatHistoryBlock; recordIndex: number }>;
  blocks: ParsedChatHistoryBlock[];
  messagesById: ReadonlyMap<string, T>;
  locate(target: BubbleTarget): MochiRoleplayLocation | null;
}

const normalize = (name?: string) => (name || '').trim().toLowerCase();
const runtimeId = /:mochi:\d+:\d+$/;
// Hydration has always required an archived phone tag. Bare `messages:` YAML
// can occur in roleplay prose and must not become an unrelated phone thread.
const hasRecord = /<(?:chat_history|privatechat_history|groupchat_history|group_message)\b/i;

/** Keep parsed records, not a second archive. Edits/swipes invalidate only the
 * changed message; deletions and chat/persona switches cannot leave stale keys. */
export function createMochiRoleplayHistoryIndexer(parser = parseChatHistoryBlocks) {
  const cache = new Map<string, { content: string; blocks: ParsedChatHistoryBlock[] }>();
  let previousUser: string | undefined;
  return function indexHistory<T extends RoleplayMessage>(messages: T[], userName?: string): MochiRoleplayHistoryIndex<T> {
    const user = normalize(userName);
    if (user !== previousUser) { cache.clear(); previousUser = user; }
    const liveIds = new Set<string>();
    const records: MochiRoleplayHistoryIndex<T>['records'] = [];
    const blocks: ParsedChatHistoryBlock[] = [];
    const messagesById = new Map(messages.map((message) => [message.id, message]));
    const byBubble = new Map<string, MochiRoleplayLocation & { type: MochiChatRecordType }>();
    const byAlias = new Map<string, MochiRoleplayLocation[]>();
    const offsets = new Map<string, number>();
    for (const message of messages) {
      if (message.role !== 'assistant' || !hasRecord.test(message.content)) continue;
      liveIds.add(message.id);
      let parsed = cache.get(message.id);
      if (!parsed || parsed.content !== message.content) {
        parsed = { content: message.content, blocks: parser(message.content, userName) };
        cache.set(message.id, parsed);
      }
      parsed.blocks.forEach((block, recordIndex) => {
        records.push({ message, block, recordIndex });
        const type = block.type === 'group' ? 'group' : 'private';
        const targetName = block.target || block.contactname || block.name || 'Character';
        const key = `${type}:${normalize(targetName)}`;
        const recordStartIndex = offsets.get(key) || 0;
        const recordHasUserMessages = block.messages.some((item) => item.me === 1);
        const locations = block.messages.map((_, indexInRecord): MochiRoleplayLocation => ({
          roleplayMessageId: message.id, recordIndex, indexInRecord,
          recordStartIndex, targetName, recordHasUserMessages,
        }));
        offsets.set(key, recordStartIndex + locations.length);
        blocks.push({ ...block, messages: block.messages.map((item, itemIndex) => {
          const id = mochiRoleplayBubbleId(message.id, recordIndex, itemIndex);
          byBubble.set(id, { ...locations[itemIndex], type });
          return { ...item, id };
        }) });
        for (const alias of new Set([block.target, block.contactname, block.name].map(normalize).filter(Boolean))) {
          for (const aliasKey of [`${type}:${alias}`, `*:${alias}`]) {
            const previous = byAlias.get(aliasKey) || [];
            const start = previous.length;
            for (const location of locations) previous.push({ ...location, recordStartIndex: start });
            byAlias.set(aliasKey, previous);
          }
        }
      });
    }
    for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id);
    return {
      records, blocks, messagesById,
      locate(target) {
        const source = target.threadMessageId ? byBubble.get(target.threadMessageId) : undefined;
        if (source) {
          if (target.recordType && source.type !== target.recordType) return null;
          const { type: _type, ...location } = source;
          return location;
        }
        if (target.threadMessageId && runtimeId.test(target.threadMessageId)) return null;
        return byAlias.get(`${target.recordType || '*'}:${normalize(target.targetName)}`)?.[target.threadIndex] || null;
      },
    };
  };
}
