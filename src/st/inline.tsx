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
import { Fragment, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { MochiGroupChatWidget } from '../components/chat/mochi-os/MochiGroupChatWidget';
import { MochiPrivateChatWidget } from '../components/chat/mochi-os/MochiPrivateChatWidget';
import { MochiForumWidget, parseForumWidget } from '../components/chat/mochi-os/MochiForumWidget';
import { parseMochiChatContent } from '../components/chat/mochi-os/mochi-os.utils';
import { ctx } from './adapter';
import { mochiQueryClient } from './query-client';
import { ensureMochiStyles } from './stylesheet';
import { mayContainMochiWidget } from './widget-records';

export { mayContainMochiWidget, RECORD_HINT } from './widget-records';

/** Wrapper this module inserts in place of a message's rendered text. */
const BLOCKS_CLASS = 'mochi-inline-blocks';

interface Mounted {
  container: HTMLElement;
  root: Root;
  text: string;
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
  const forumPattern = /<(forum|forum_post|forum_comment)\b[^>]*>((?:(?!<(?:forum|forum_post|forum_comment)\b)[\s\S])*?)<\/\1\s*>/gi;
  const forumParts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(forumPattern)) {
    const data = parseForumWidget(match[0], match[1].toLowerCase());
    if (!data) continue;
    const before = text.slice(cursor, match.index);
    if (before) forumParts.push(<Fragment key={`before-${match.index}`}>{renderBlocks(before, index) || formatText(before, index)}</Fragment>);
    forumParts.push(<MochiForumWidget key={`forum-${match.index}`} data={data} />);
    cursor = match.index! + match[0].length;
  }
  if (forumParts.length) {
    const after = text.slice(cursor);
    if (after) forumParts.push(<Fragment key="after-forum">{renderBlocks(after, index) || formatText(after, index)}</Fragment>);
    return forumParts;
  }
  // One pass renders every record, including private and group records in the
  // same turn. Choosing the first successful reader hid the other record type.
  const parts = parseMochiChatContent(text, ctx().name1);
  if (!parts.length) return null;
  return parts.map((part, partIndex) => part.type === 'text'
    ? <Fragment key={`text-${partIndex}`}>{formatText(part.value, index)}</Fragment>
    : part.value.chat.type === 'group'
      ? <MochiGroupChatWidget key={`widget-${partIndex}`} data={part.value} />
      : <MochiPrivateChatWidget key={`widget-${partIndex}`} data={part.value} />);
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
  mounted.set(index, { container, root, text });
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
    if (entry.container.isConnected && messageTextElement(index)?.contains(entry.container)) continue;
    mounted.delete(index);
    queueMicrotask(() => entry.root.unmount());
  }
}

/**
 * Brings the transcript widgets in the open chat up to date.
 *
 * Cheap to call: messages without a record are skipped by a substring test, and
 * unchanged mounted widgets are left alone. Content changes repaint existing
 * roots too, even when the host has not replaced their DOM container.
 */
export function refreshMochiWidgets(): void {
  const chat = ctx().chat;
  if (!Array.isArray(chat)) return;

  sweep();

  for (let index = 0; index < chat.length; index += 1) {
    const text = typeof chat[index]?.mes === 'string' ? chat[index].mes : '';
    const existing = mounted.get(index);
    if (!existing && (!text || !mayContainMochiWidget(text))) continue;
    const textElement = messageTextElement(index);
    if (!textElement) continue;

    if (existing) {
      if (existing.text === text) continue;
      const blocks = mayContainMochiWidget(text) ? renderBlocks(text, index) : null;
      if (blocks) {
        existing.text = text;
        existing.root.render(<QueryClientProvider client={mochiQueryClient()}>{blocks}</QueryClientProvider>);
      } else {
        mounted.delete(index);
        queueMicrotask(() => existing.root.unmount());
        if (typeof ctx().updateMessageBlock === 'function') ctx().updateMessageBlock(index, chat[index]);
        else textElement.textContent = text;
      }
      continue;
    }

    mount(index, textElement, text);
  }
}

/** Unmounts every widget, leaving SillyTavern's own rendering in place. */
export function disposeMochiWidgets(): void {
  for (const entry of mounted.values()) queueMicrotask(() => entry.root.unmount());
  mounted.clear();
}
