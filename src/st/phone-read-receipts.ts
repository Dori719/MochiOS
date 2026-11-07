import yaml from 'yaml';
import { activeChatId, readMessage, updateMessageContent } from './adapter';
import { parseChatHistoryBlocks, unquoteUserFlagKey } from '../components/chat/mochi-os/mochi-os.utils';

export interface ReadReceiptTarget {
  recordIndex: number;
  itemIndex: number;
}

/** Preserve the YAML document while changing only explicit incoming unread flags. */
export function markPrivateItemsRead(source: string, targets: ReadReceiptTarget[], manualValue?: boolean): string {
  let recordIndex = -1;
  return source.replace(/(<(?:chat_history|privatechat_history|groupchat_history|group_message)\b[^>]*>)([\s\S]*?)(<\/(?:chat_history|privatechat_history|groupchat_history|group_message)>)/gi,
    (raw, opener: string, body: string, closer: string) => {
      const block = parseChatHistoryBlocks(raw)[0];
      if (!block) return raw;
      recordIndex++;
      const wanted = targets.filter((target) => target.recordIndex === recordIndex);
      if (!wanted.length) return raw;
      const document = yaml.parseDocument(body.trim().replace(/^(\s*)\{\{([^}]+)\}\}:/gm, '$1"{{$2}}":'));
      const items = document.get('messages');
      if (document.errors.length || !yaml.isSeq(items)) return raw;
      const maps = items.items.filter(yaml.isMap);
      let changed = false;
      for (const { itemIndex } of wanted) {
        const item = maps[itemIndex];
        if (block.messages[itemIndex]?.me !== 0 || !item) continue;
        if (manualValue === undefined && item.get('userRead') !== false) continue;
        item.set('userRead', manualValue ?? true);
        item.delete('userReadManual');
        changed = true;
      }
      return changed ? `${opener}\n${unquoteUserFlagKey(document.toString().trim())}\n${closer}` : raw;
    });
}

export async function savePrivateReadReceipts(params: {
  chatId: string;
  messageId: string;
  expectedContent: string;
  expectedSwipe: number;
  targets: ReadReceiptTarget[];
  manualValue?: boolean;
}): Promise<boolean> {
  if (activeChatId() !== params.chatId) return false;
  const message = readMessage(params.messageId);
  if (!message || Number(message.activeSwipeIndex ?? 0) !== params.expectedSwipe) return false;
  const source = String(message.content ?? '');
  // A visibility save can finish between rendering the action and clicking it.
  // Permit only receipt-field changes; edits/deletions still invalidate targets.
  const withoutReceipts = (value: string) => value.replace(/^[ \t]*userRead(?:Manual)?:[^\r\n]*(?:\r?\n|$)/gm, '');
  if (source !== params.expectedContent && (params.manualValue === undefined || withoutReceipts(source) !== withoutReceipts(params.expectedContent))) return false;
  const content = markPrivateItemsRead(source, params.targets, params.manualValue);
  if (content === source) return params.manualValue !== undefined;
  await updateMessageContent(params.messageId, content);
  return true;
}
