/**
 * View models.
 *
 * Derives what the phone shows from the stored YAML using the engine's own
 * parsers, so a thread reads exactly as it did there: the same record merge, the
 * same user-side detection, the same environment block.
 */
import type { MochiOsCharacterData, MochiOsGroupData, MochiOsPhoneData } from '../mochi/schema';
import {
  mergeMochiChatHistoryBlocks,
  parseChatHistoryBlocks,
  parseEnvironmentYaml,
  type ParsedChatHistoryBlock,
  type ParsedEnvironment,
  type ParsedMochiChatWidget,
} from '../mochi/utils';
import type { MochiThreadRecord } from '../core/store';

export interface ContactView {
  name: string;
  bio: string;
  status: string;
  avatar: string;
}

export interface GroupView {
  name: string;
  description: string;
  members: string[];
  memberCount: number;
}

const EMPTY_ENVIRONMENT: ParsedEnvironment = {};

/**
 * Read a thread archive into the widget shape the ported renderers take.
 *
 * Each archived turn is its own `<chat_history>` record; they are merged by
 * target so the phone shows one continuous thread rather than one card per turn,
 * and the newest `<environment>` block describes the current moment.
 */
export function threadView(
  record: MochiThreadRecord | null,
  userName: string,
): ParsedMochiChatWidget | null {
  if (!record?.yaml?.trim()) return null;

  const blocks = parseChatHistoryBlocks(record.yaml, userName, { recordType: record.type });
  if (!blocks.length) return null;

  const merged = mergeMochiChatHistoryBlocks(blocks as ParsedChatHistoryBlock[]) as ParsedChatHistoryBlock[];
  const chat = merged[0];
  if (!chat) return null;

  // The environment sits after its record; the last one in the archive is the
  // most recent state the model wrote.
  const environments = [...record.yaml.matchAll(/<environment>([\s\S]*?)<\/environment>/gi)]
    .map((match) => parseEnvironmentYaml(match[1]))
    .filter((value): value is ParsedEnvironment => Boolean(value));

  return {
    chat: {
      ...chat,
      target: chat.target ?? record.target,
      contactname: record.type === 'private' ? (chat.contactname ?? record.target) : undefined,
      name: chat.name ?? record.target,
    },
    environment: environments.length ? environments[environments.length - 1]! : EMPTY_ENVIRONMENT,
  };
}

/** Last message in a thread, for the conversation list preview. */
export function threadPreview(record: MochiThreadRecord, userName: string): { text: string; time?: string } {
  const view = threadView(record, userName);
  const messages = view?.chat.messages ?? [];
  const last = messages[messages.length - 1];
  if (!last) return { text: '' };
  const prefix = last.me ? '' : last.sender ? `${last.sender}: ` : '';
  return { text: `${prefix}${last.text ?? ''}`.slice(0, 120), time: last.time ?? view?.chat.time };
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,;、]/)
      .map((part) => part.trim())
      .filter(Boolean) as T[];
  }
  return [];
}

function pickName(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

/**
 * Contacts from the generated `phone_data`.
 *
 * `characters`, `private_contacts` and `groups` are all accepted because the
 * data guide has used each name, and a generated document should not lose its
 * roster just because the model picked a different key.
 */
export function contactsFrom(phoneData: MochiOsPhoneData | null): ContactView[] {
  if (!phoneData) return [];
  const seen = new Set<string>();
  const contacts: ContactView[] = [];

  const push = (entry: MochiOsCharacterData) => {
    const name = pickName(entry?.contactname, entry?.name, entry?.nickname);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({
      name,
      bio: pickName(entry?.bio, entry?.description, entry?.email),
      status: pickName(entry?.onlinestyle, entry?.online_style, entry?.onlineStyle),
      avatar: pickName(entry?.avatar),
    });
  };

  for (const entry of asArray<MochiOsCharacterData>(phoneData.characters)) push(entry);
  for (const entry of asArray<MochiOsCharacterData>(phoneData.private_contacts)) push(entry);
  return contacts;
}

export function groupsFrom(phoneData: MochiOsPhoneData | null): GroupView[] {
  const groups = asArray<MochiOsGroupData>(phoneData?.groups);
  return groups
    .map((group) => {
      const main = asArray<string>(group?.main_members ?? group?.mainMembers);
      const other = asArray<string>(group?.other_members ?? group?.otherMembers);
      const members = [...new Set([...main, ...other].filter(Boolean))];
      return {
        name: pickName(group?.name),
        description: pickName(group?.description),
        members,
        memberCount: members.length,
      };
    })
    .filter((group) => group.name.length > 0);
}

export function userProfileFrom(phoneData: MochiOsPhoneData | null): { name: string; bio: string; email: string } {
  const user = phoneData?.user ?? {};
  return {
    name: pickName(user.nickname, user.id, user.name),
    bio: pickName(user.bio),
    email: pickName(user.email),
  };
}