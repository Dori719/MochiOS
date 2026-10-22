/** Persist a bubble action by its transcript item, without touching other turns. */
import yaml from 'yaml';
import type { MessageReaction } from '../shared';
import { deleteMessage, readMessage, updateMessageContent } from './adapter';
import { parseChatHistoryBlocks, removeMochiThreadMessage, unquoteUserFlagKey } from '../components/chat/mochi-os/mochi-os.utils';

interface PhoneMessageTarget {
  messageId: string;
  recordType: 'private' | 'group';
  targetName: string;
  recordIndex?: number;
  itemIndex: number;
  itemId?: string;
  expectedContent?: string;
}

/** Change only the selected YAML map; retain aliases, timestamps, prose and media. */
async function updatePhoneItem(params: PhoneMessageTarget, action: { reactions?: MessageReaction[]; content?: string; delete?: boolean }): Promise<Record<string, any> | null> {
  const message = readMessage(params.messageId);
  if (!message) throw new Error('Mochi OS: the connected roleplay message could not be found.');
  const source = String(message.content ?? '');
  if (params.expectedContent !== undefined && params.expectedContent !== source) {
    throw new Error('Mochi OS: the saved record changed. Reopen your edit and try again.');
  }
  const wanted = params.targetName.trim().toLowerCase();
  const pattern = /(<(?:chat_history|privatechat_history|groupchat_history|group_message)\b[^>]*>)([\s\S]*?)(<\/(?:chat_history|privatechat_history|groupchat_history|group_message)>)/gi;
  let changed = false;
  let recordIndex = -1;
  const content = source.replace(pattern, (raw, opener: string, body: string, closer: string) => {
    if (changed) return raw;
    const block = parseChatHistoryBlocks(raw)[0];
    if (!block) return raw;
    recordIndex++;
    if (params.recordIndex !== undefined && params.recordIndex !== recordIndex) return raw;
    if (block.type !== params.recordType || ![block.target, block.contactname, block.name].some((name) => name?.trim().toLowerCase() === wanted)) return raw;
    const item = block.messages[params.itemIndex];
    if (!item || (params.itemId && item.id && item.id !== String(params.itemId).trim())) return raw;
    const document = yaml.parseDocument(body.trim().replace(/^(\s*)\{\{([^}]+)\}\}:/gm, '$1"{{$2}}":'));
    const items = document.get('messages');
    if (document.errors.length || !yaml.isSeq(items)) return raw;
    const maps = items.items.filter(yaml.isMap);
    const target = maps[params.itemIndex];
    if (!target) return raw;
    if (action.delete) {
      const kept = new Set(removeMochiThreadMessage(block.messages, params.itemIndex));
      for (let index = maps.length - 1; index >= 0; index--) {
        if (!kept.has(block.messages[index])) items.delete(items.items.indexOf(maps[index]));
      }
      changed = true;
      if (!kept.size) return '';
    } else {
      if (action.reactions) {
        if (action.reactions.length) target.set('reactions', document.createNode(action.reactions));
        else target.delete('reactions');
      }
      if (typeof action.content === 'string') target.set('c', action.content);
      changed = true;
    }
    return `${opener}\n${unquoteUserFlagKey(document.toString().trim())}\n${closer}`;
  });
  if (!changed) throw new Error('Mochi OS: the saved phone message changed or could not be found. Reopen it and try again.');
  if (action.delete && !content.replace(/<environment>[\s\S]*?<\/environment>/gi, '').trim()) {
    await deleteMessage(params.messageId);
    return null;
  }
  return updateMessageContent(params.messageId, content);
}

export function updatePhoneMessageReactions(params: PhoneMessageTarget & { reactions: MessageReaction[] }): Promise<Record<string, any> | null> {
  return updatePhoneItem(params, { reactions: params.reactions });
}

export function editPhoneMessage(params: PhoneMessageTarget & { content?: string; delete?: boolean }): Promise<Record<string, any> | null> {
  return updatePhoneItem(params, { content: params.content, delete: params.delete });
}
