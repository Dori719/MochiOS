/** Compatibility readers for older phone turns split into physical ST messages. */
import yaml from 'yaml';
import {
  parseChatHistoryBlocks,
  serializeChatHistoryYaml,
  type ParsedChatHistoryBlock,
} from '../components/chat/mochi-os/mochi-os.utils';

type RecordData = Record<string, any>;

export interface TranscriptPart {
  content: string;
  name: string;
  characterId?: string;
  isUser: boolean;
}

function serialize(block: ParsedChatHistoryBlock, messages = block.messages, environmentYaml?: string): string {
  const content = serializeChatHistoryYaml({
    targetName: block.target || block.contactname || block.name || 'Character',
    recordType: block.type === 'group' ? 'group' : 'private',
    date: block.date,
    time: block.time,
    members: block.members,
    environmentYaml,
    messages: messages.map((message) => ({ ...message, t: message.time, d: message.date })),
  });
  // Keep a private contact's display alias without changing its thread key.
  return block.contactname && block.contactname !== block.target
    ? content.replace(/^contactname:[\s\S]*?(?=\ndate:)/m, yaml.stringify({ contactname: block.contactname }).trim())
    : content;
}

export function transcriptBlock(content: string): ParsedChatHistoryBlock | null {
  const blocks = parseChatHistoryBlocks(content);
  return blocks.length === 1 && blocks[0].messages.length > 0 ? blocks[0] : null;
}

/** Legacy split format. New writes keep the complete transcript in one ST message. */
export function splitPhoneTranscript(content: string): TranscriptPart[] | null {
  const block = transcriptBlock(content);
  if (!block) return null;
  // Roleplay messages can include prose around a widget. Never discard that
  // user-authored context while splitting a dedicated phone-generated turn.
  const surrounding = content.replace(/<(?:chat_history|privatechat_history|groupchat_history|group_message)\b[^>]*>[\s\S]*?<\/(?:chat_history|privatechat_history|groupchat_history|group_message)>/gi, '')
    .replace(/<environment>[\s\S]*?<\/environment>/gi, '').trim();
  if (surrounding) return null;
  const environment = [...content.matchAll(/<environment>[\s\S]*?<\/environment>/gi)].at(-1)?.[0];
  return block.messages.map((message) => ({
    content: serialize(block, [message], environment),
    name: message.me === 1 ? 'User' : block.type === 'group'
      ? message.sender || 'Unknown sender'
      : block.target || block.contactname || block.name || 'Unknown sender',
    characterId: message.rawItem?.sender?.id ?? message.rawItem?.sender?.characterId,
    isUser: message.me === 1,
  }));
}

/** Reconstruct from the actual messages, not a second copy of the active transcript. */
export function combinePhoneTranscript(contents: string[]): string {
  if (contents.length === 1) return contents[0];
  const blocks = contents.map((content) => transcriptBlock(content));
  const first = blocks.find((block) => block !== null);
  if (!first || blocks.some((block) => !block || block.target !== first.target || block.type !== first.type) || contents.some((content) => splitPhoneTranscript(content) === null)) {
    return contents.join('\n\n');
  }
  const environment = [...contents.join('\n').matchAll(/<environment>[\s\S]*?<\/environment>/gi)].at(-1)?.[0];
  return serialize(first, blocks.flatMap((block) => block?.messages ?? []), environment);
}

/** Resolve a phone nickname/contact alias to an actual card; unknown NPCs keep their own name. */
export function resolvePhoneCharacter(
  name: string,
  characterId: string | null | undefined,
  characters: RecordData[],
  phoneDataYaml?: string,
): RecordData | undefined {
  const key = name.trim().toLowerCase();
  const byId = characters.find((character) => characterId && String(character.avatar) === characterId);
  const byName = characters.find((character) => [character.data?.name, character.name].some((value) => typeof value === 'string' && value.trim().toLowerCase() === key));
  if (byName) return byName;
  if (phoneDataYaml) {
    try {
      const parsed = yaml.parse(phoneDataYaml);
      const phone = parsed?.phone_data ?? parsed;
      const contacts = [...(Array.isArray(phone?.characters) ? phone.characters : []), ...(Array.isArray(phone?.private_contacts) ? phone.private_contacts : [])];
      const contact = contacts.find((item) => [item.id, item.name, item.contactname, item.nickname].some((value) => typeof value === 'string' && value.trim().toLowerCase() === key));
      if (contact) {
        const match = characters.find((character) => String(character.avatar) === contact.id || [character.data?.name, character.name].some((value) => typeof value === 'string' && value.trim().toLowerCase() === String(contact.name ?? '').trim().toLowerCase()));
        if (match) return match;
      }
    } catch { /* An invalid phone document must not assign an unrelated card. */ }
  }
  // A supplied id is a fallback only when it agrees with a known name, or no name was supplied.
  return !key ? byId : undefined;
}
