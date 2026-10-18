/**
 * Phone storage.
 *
 * The engine kept a `phone_data` YAML file per character and archived each
 * thread turn as a message in the roleplay transcript. Here both live in
 * SillyTavern's `chat_metadata`, which the host writes into the first line of
 * the chat's JSONL — so a phone travels with chat export, import and branching
 * without any extension-side file handling.
 */
import { useMemo } from 'react';
import type { MochiOsPhoneData } from '../mochi/schema';
import { readChatMeta, writeChatMeta } from '../st/adapter';
import { getState, setState, useStore, type MochiThreadRecord } from './store';
import { appendPrivateChatTurn, extractAndParsePhoneDataYaml } from './records';

/**
 * Turns kept per thread.
 *
 * The whole archive is replayed into every prompt, so an unbounded thread
 * silently eats the context window. Oldest records are dropped first: recent
 * turns carry the state a character is actually continuing from.
 */
const MAX_RECORDS_PER_THREAD = 40;

/** Bumped when the stored shape changes, so old blobs can be migrated or dropped. */
const META_VERSION = 1;

interface StoredMeta {
  version?: number;
  phoneDataYaml?: string;
  threads?: MochiThreadRecord[];
}

/** Load the active chat's phone into the store. */
export async function hydratePhone(): Promise<void> {
  const meta = readChatMeta() as StoredMeta;
  const rawPhoneYaml = typeof meta.phoneDataYaml === 'string' ? meta.phoneDataYaml : '';

  let phoneData: MochiOsPhoneData | null = null;
  if (rawPhoneYaml.trim()) {
    try {
      phoneData = extractAndParsePhoneDataYaml(rawPhoneYaml, false) as MochiOsPhoneData | null;
    } catch (error) {
      console.warn('[Mochi OS] stored phone data did not parse; keeping it as text only', error);
    }
  }

  const threads = Array.isArray(meta.threads)
    ? meta.threads.filter(
        (thread): thread is MochiThreadRecord =>
          Boolean(thread) && typeof thread.id === 'string' && typeof thread.yaml === 'string',
      )
    : [];

  setState({ phoneData, phoneDataYaml: rawPhoneYaml, threads, openThreadId: null });
}

/** Write the store's phone back into the active chat's metadata. */
export async function persistPhone(): Promise<void> {
  const { phoneDataYaml, threads } = getState();
  const meta: StoredMeta = { version: META_VERSION, phoneDataYaml, threads };
  await writeChatMeta(meta);
}

function mutateStore(mutate: (state: ReturnType<typeof getState>) => Partial<ReturnType<typeof getState>>) {
  const next = mutate(getState());
  setState(next);
  void persistPhone();
}

/* ------------------------------------------------------------------ *
 * Phone data (contacts, groups, profile)
 * ------------------------------------------------------------------ */

export function setPhoneData(rawYaml: string): void {
  let phoneData: MochiOsPhoneData | null = null;
  try {
    phoneData = extractAndParsePhoneDataYaml(rawYaml, false) as MochiOsPhoneData | null;
  } catch (error) {
    console.warn('[Mochi OS] generated phone data is not valid YAML', error);
  }
  mutateStore(() => ({ phoneData, phoneDataYaml: rawYaml }));
}

export function deletePhoneData(): void {
  mutateStore(() => ({ phoneData: null, phoneDataYaml: '', threads: [], openThreadId: null }));
}

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'thread'
  );
}

export function findThread(id: string | null): MochiThreadRecord | null {
  if (!id) return null;
  return getState().threads.find((thread) => thread.id === id) ?? null;
}

/** Open a thread, creating its archive on first use. */
export function openThread(target: string, type: 'private' | 'group'): MochiThreadRecord {
  const existing = getState().threads.find(
    (thread) => thread.target === target && thread.type === type,
  );
  if (existing) {
    setState({ openThreadId: existing.id });
    return existing;
  }

  const record: MochiThreadRecord = {
    id: `${type === 'group' ? 'group' : 'dm'}-${slug(target)}`,
    target,
    type,
    yaml: '',
    updatedAt: Date.now(),
  };
  mutateStore((state) => ({ threads: [...state.threads, record], openThreadId: record.id }));
  return record;
}

export function closeThread(): void {
  setState({ openThreadId: null });
}

/** Count the `<chat_history>` records in an archive. */
function countRecords(yaml: string): number {
  return (yaml.match(/<(?:chat_history|privatechat_history|groupchat_history)(?:\s[^>]*)?>/gi) || []).length;
}

/** Drop the oldest records once an archive passes the retention cap. */
function trimArchive(yaml: string): string {
  if (countRecords(yaml) <= MAX_RECORDS_PER_THREAD) return yaml;
  const pattern =
    /<(?:chat_history|privatechat_history|groupchat_history)(?:\s[^>]*)?>[\s\S]*?<\/(?:chat_history|privatechat_history|groupchat_history)>(?:\s*<environment>[\s\S]*?<\/environment>)?/gi;
  const blocks = yaml.match(pattern) ?? [];
  const excess = blocks.length - MAX_RECORDS_PER_THREAD;
  if (excess <= 0) return yaml;
  const kept = blocks.slice(excess).join('\n\n');
  console.info(`[Mochi OS] trimmed ${excess} archived turn(s) to fit the retention cap`);
  return `${kept.trim()}\n`;
}

/** Append a finalized turn to a thread's archive. */
export function appendTurn(threadId: string, turnYaml: string): void {
  mutateStore((state) => ({
    threads: state.threads.map((thread) =>
      thread.id === threadId
        ? { ...thread, yaml: trimArchive(appendPrivateChatTurn(thread.yaml, turnYaml)), updatedAt: Date.now() }
        : thread,
    ),
  }));
}

/** Replace a thread's archive wholesale (regeneration, YAML editor, import). */
export function replaceThreadArchive(threadId: string, yaml: string): void {
  mutateStore((state) => ({
    threads: state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, yaml: trimArchive(yaml), updatedAt: Date.now() } : thread,
    ),
  }));
}

export function deleteThread(threadId: string): void {
  mutateStore((state) => ({
    threads: state.threads.filter((thread) => thread.id !== threadId),
    openThreadId: state.openThreadId === threadId ? null : state.openThreadId,
  }));
}

/* ------------------------------------------------------------------ *
 * Compatibility surface for the ported widgets
 * ------------------------------------------------------------------ */

/**
 * The engine's `useMochiOSPhoneData` query hook.
 *
 * The engine served this from `GET /api/mochios-data/:chatId`; here it reads the
 * already-hydrated store, and the widget keeps its `{ data }` destructuring.
 */
export function useMochiOSPhoneData(_chatId?: string | null): {
  data: { phoneData: MochiOsPhoneData | null; rawYaml: string | null };
} {
  const phoneData = useStore((state) => state.phoneData);
  const phoneDataYaml = useStore((state) => state.phoneDataYaml);
  return useMemo(() => ({ data: { phoneData, rawYaml: phoneDataYaml || null } }), [phoneData, phoneDataYaml]);
}