import { FORUM_SECTIONS, appendForumComments, forumThreadKey, parseForumFeed, parseForumPost, parseForumComments, type ForumPost, type ForumState } from './mochi-forum-data';
import yaml from 'yaml';

/** Replay surviving roleplay turns in physical order, including the active swipe. */
export function forumStateFromHistory(messages: Array<{ mes?: string; is_user?: boolean }>): ForumState {
  const state: ForumState = { feed: null, posts: {} };
  const versions = new Map<string, ForumPost>();
  const identity = (title: string, author: string) => JSON.stringify([title.trim(), author.trim()]);
  for (const message of messages) {
    if (message.is_user || typeof message.mes !== 'string') continue;
    const source = message.mes.replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    for (const match of source.matchAll(/<(forum|forum_post|forum_comment)\b[^>]*>((?:(?!<(?:forum|forum_post|forum_comment)\b)[\s\S])*?)<\/\1\s*>/gi)) {
      try {
        const tag = match[1].toLowerCase();
        if (tag === 'forum') state.feed = parseForumFeed(match[0]);
        else if (tag === 'forum_post') {
          const post = parseForumPost(match[0]);
          versions.set(identity(post.title, post.author), post);
        } else {
          const doc = yaml.parse(match[2], { maxAliasCount: 50 });
          if (typeof doc?.title !== 'string' || typeof doc?.author !== 'string') continue;
          const key = identity(doc.title, doc.author);
          const post = versions.get(key);
          if (post) versions.set(key, appendForumComments(post, parseForumComments(match[0], [])));
        }
      } catch { /* Invalid or incomplete turns never supersede valid history. */ }
    }
  }
  if (!state.feed) return state;
  const feed = state.feed;
  const entries = FORUM_SECTIONS.flatMap(section => feed[section].map((item, index) => ({ item, key: forumThreadKey(feed, section, index) })));
  if (feed.pinned) entries.unshift({ item: feed.pinned, key: forumThreadKey(feed, 'pinned', 0) });
  for (const { item, key } of entries) {
    const post = item.author ? versions.get(identity(item.title, item.author)) : [...versions.values()].reverse().find(post => post.title.trim() === item.title.trim());
    if (post) state.posts[key] = post;
  }
  return state;
}
