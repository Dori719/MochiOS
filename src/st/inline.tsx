/**
 * The phone transcripts inside roleplay messages.
 *
 * A roleplay turn can carry a Mochi record — a private chat, a group chat — as
 * XML-ish text with an `<environment>` block beside it. In the engine that text
 * was parsed and replaced by a live widget as the message was rendered, so the
 * turn read as a chat transcript rather than as a pile of YAML.
 *
 * SillyTavern renders messages its own way, so the replacement happens after it
 * has rendered: the message's text is split with the engine's own parsers, the
 * prose parts are handed back to SillyTavern's formatter (so quotes, italics and
 * code keep the look they would have had), and the record parts become widgets
 * mounted in place. A message with no record is left exactly as SillyTavern drew
 * it.
 */
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { renderMochiGroupChatBlocks } from '../components/chat/mochi-os/MochiGroupChatWidget';
import { renderMochiPrivateChatBlocks } from '../components/chat/mochi-os/MochiPrivateChatWidget';
import { ctx } from './adapter';
import { mochiQueryClient } from './query-client';
import { ensureMochiStyles } from './stylesheet';

/** Wrapper this module inserts in place of a message's rendered text. */
const BLOCKS_CLASS = 'mochi-inline-blocks';

/**
 * A record only becomes a widget when an `<environment>` block follows it (see
 * `parseMochiChatContent`), so both have to be present before the parsers are
 * worth running over a message.
 */
export const RECORD_HINT = /(?:privatechat_history|groupchat_history|chat_history)/i;
export const ENVIRONMENT_HINT = /<environment>/i;

/** Whether a message could hold a widget at all. */
export function mayContainMochiWidget(text: string): boolean {
  return RECORD_HINT.test(text) && ENVIRONMENT_HINT.test(text);
}

interface Mounted {
  container: HTMLElement;
  root: Root;
}

const mounted = new Map<number, Mounted>();

function messageTextElement(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#chat .mes[mesid="${index}"] .mes_text`);
}

/**
 * A prose part, formatted by SillyTavern itself.
 *
 * Calling its formatter keeps the part indistinguishable from the rest of the
 * chat: macros, markdown and its sanitiser all run exactly as they would have.
 */
function formatText(text: string, index: number): ReactNode {
  const context = ctx();
  const message = context.chat?.[index];
  const html = context.messageFormatting(
    text,
    String(message?.name ?? ''),
    Boolean(message?.is_system),
    Boolean(message?.is_user),
    index,
  );
  return <div className="mochi-inline-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The message's text as text parts and widgets, or `null` when it holds none. */
function renderBlocks(text: string, index: number): ReactNode {
  const renderText = (part: string): ReactNode => formatText(part, index);
  // Both readers return `null` when the message holds none of their records.
  return renderMochiGroupChatBlocks(text, renderText) ?? renderMochiPrivateChatBlocks(text, renderText);
}

function mount(index: number, textElement: HTMLElement, text: string): void {
  const blocks = renderBlocks(text, index);
  // The quick check above can pass on text the parser still rejects (an
  // incomplete record, for instance); SillyTavern's rendering then stands.
  if (!blocks) return;

  ensureMochiStyles();

  const container = document.createElement('div');
  container.className = BLOCKS_CLASS;
  textElement.replaceChildren(container);

  const root = createRoot(container);
  root.render(<QueryClientProvider client={mochiQueryClient()}>{blocks}</QueryClientProvider>);
  mounted.set(index, { container, root });
}

/**
 * Unmounts widgets whose message has been re-rendered.
 *
 * SillyTavern replaces a message's contents on an edit or a swipe, which throws
 * away the element a widget was mounted into without telling React. The roots
 * are unmounted on the next task, once the render that replaced them is done.
 */
function sweep(): void {
  for (const [index, entry] of mounted) {
    if (entry.container.isConnected) continue;
    mounted.delete(index);
    queueMicrotask(() => entry.root.unmount());
  }
}

/**
 * Brings the transcript widgets in the open chat up to date.
 *
 * Cheap to call: messages without a record are skipped by a substring test, and
 * messages that already have a mounted widget are left alone.
 */
export function refreshMochiWidgets(): void {
  const chat = ctx().chat;
  if (!Array.isArray(chat)) return;

  sweep();

  for (let index = 0; index < chat.length; index += 1) {
    const text = typeof chat[index]?.mes === 'string' ? chat[index].mes : '';
    if (!text || !mayContainMochiWidget(text)) continue;

    const textElement = messageTextElement(index);
    if (!textElement) continue;

    const existing = mounted.get(index);
    if (existing?.container.isConnected && textElement.contains(existing.container)) continue;

    mount(index, textElement, text);
  }
}

/** Unmounts every widget, leaving SillyTavern's own rendering in place. */
export function disposeMochiWidgets(): void {
  for (const entry of mounted.values()) queueMicrotask(() => entry.root.unmount());
  mounted.clear();
}
