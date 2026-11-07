import { activeChatId, ctx, insertMessage, readChatMeta, writeChatMeta } from './adapter';
import { forumStateFromHistory } from '../components/chat/mochi-os/mochi-forum-history';
import { appendForumComments } from '../components/chat/mochi-os/mochi-forum-data';
import yaml from 'yaml';
import { generateMochiOutput } from './generate';
import { refreshLorebookPrompt } from './lorebooks';
import type { ForumState } from '../components/chat/mochi-os/mochi-forum-data';
import type { MochiPromptMessage } from './preset';

export function readForumState(): ForumState {
  const state = forumStateFromHistory(ctx().chat);
  const saved = readChatMeta().forum;
  // Locally authored comments remain attached only to surviving generated posts.
  for (const [key, post] of Object.entries(state.posts)) {
    const comments = saved?.posts?.[key]?.comments;
    if (Array.isArray(comments)) state.posts[key] = appendForumComments(post, comments.filter(comment => comment?.own === true));
  }
  return state;
}
export function saveForumState(chatId: string, state: ForumState) {
  if (!chatId || activeChatId() !== chatId) throw new Error('The chat changed. Reopen Forum in the current chat.');
  writeChatMeta({ ...readChatMeta(), forum: { version: 1, ...state } });
}
/** Archive only parsed, accepted content, never provider reasoning or unrelated tags. */
export async function archiveForumResponse(chatId: string, tag: 'forum' | 'forum_post' | 'forum_comment', data: unknown, signal: AbortSignal) {
  if (signal.aborted) return;
  if (!chatId || activeChatId() !== chatId) throw new Error('The chat changed. Reopen Forum in the current chat.');
  await insertMessage({ role: 'assistant', name: 'Forum', content: `<${tag}>\n${yaml.stringify(data).trim()}\n</${tag}>`, extra: { mochiosForum: { type: tag } } });
}
export async function archiveForumPosts(chatId: string, posts: ForumState['posts'], signal: AbortSignal) {
  if (signal.aborted) return;
  if (activeChatId() !== chatId) throw new Error('The chat changed. Reopen Forum in the current chat.');
  const content = Object.values(posts).map(post => `<forum_post>\n${yaml.stringify(post).trim()}\n</forum_post>`).join('\n\n');
  await insertMessage({ role: 'assistant', name: 'Forum', content, extra: { mochiosForum: { type: 'forum_post' } } });
}
export async function generateForumOutput(chatId: string, messages: MochiPromptMessage[], userName: string, profileId: string | null | undefined, signal: AbortSignal) {
  const prompt = await refreshLorebookPrompt(messages, userName);
  return generateMochiOutput(prompt, { chatId, profileId, signal });
}
