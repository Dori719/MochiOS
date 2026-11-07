import yaml from 'yaml';

export const FORUM_SECTIONS = ['nearby', 'discover', 'trending'] as const;
export type ForumSection = typeof FORUM_SECTIONS[number];
export interface ForumSummary {
  title: string; content: string; author: string; category: string;
  views: string; comments: string; likes: string; hot: string;
}
export interface ForumComment { name: string; time: string; c: string; reply?: { name: string; time: string }; own?: boolean }
export interface ForumPost { title: string; author: string; date: string; time: string; views: string; commentCount: string; content: string; comments: ForumComment[] }
export interface ForumFeed { date: string; time: string; pinned: ForumSummary | null; nearby: ForumSummary[]; discover: ForumSummary[]; trending: ForumSummary[] }
export interface ForumState { feed: ForumFeed | null; posts: Record<string, ForumPost> }
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function envelope(raw: string, tag: string) {
  // An opener mentioned in prose must not consume the actual output opener.
  // Ignore completed reasoning blocks before looking for the requested envelope.
  const source = raw.replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>((?:(?!<${tag}\\b)[\\s\\S])*?)<\\/${tag}\\s*>`, 'i'));
  if (!match) throw new Error(`The response is missing <${tag}>. Please try again.`);
  let parsed: unknown;
  try {
    parsed = yaml.parse(match[1].replace(/^\s*```(?:ya?ml)?\s*\n|\n\s*```\s*$/g, ''), { maxAliasCount: 50 });
  } catch {
    throw new Error('The model returned invalid Forum YAML. Please generate again; your existing forum has been kept.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The forum response is not a valid YAML document. Please try again.');
  return parsed as Record<string, any>;
}
function summary(value: unknown): ForumSummary {
  const row = object(value);
  if (!text(row.title).trim()) throw new Error('A forum thread is missing its title. Please try again.');
  return Object.fromEntries(['title', 'content', 'author', 'category', 'views', 'comments', 'likes', 'hot'].map(key => [key, text(row[key])])) as unknown as ForumSummary;
}
function comments(value: unknown): ForumComment[] {
  if (!Array.isArray(value)) throw new Error('The response is missing its comment list. Please try again.');
  return value.map(item => {
    const row = object(item);
    if (!text(row.name).trim() || !text(row.c).trim() || !/^\d{2}:\d{2}$/.test(text(row.time))) throw new Error('A comment is missing its author, text, or HH:MM time. Please try again.');
    const reply = object(row.reply);
    return { name: text(row.name), time: text(row.time), c: text(row.c), ...(text(reply.name) && text(reply.time) ? { reply: { name: text(reply.name), time: text(reply.time) } } : {}) };
  });
}
export function parseForumFeed(raw: string): ForumFeed {
  const doc = envelope(raw, 'forum');
  const lists = Object.fromEntries(FORUM_SECTIONS.map(key => {
    if (!Array.isArray(doc[key])) throw new Error(`The response is missing the ${key} section. Please try again.`);
    return [key, doc[key].map(summary)];
  })) as Pick<ForumFeed, ForumSection>;
  return { date: text(doc.date), time: text(doc.time), pinned: doc.pinned ? summary(doc.pinned) : null, ...lists };
}
export function parseForumPost(raw: string): ForumPost {
  const doc = envelope(raw, 'forum_post');
  if (!text(doc.title).trim() || !text(doc.content).trim() || !text(doc.author).trim()) throw new Error('The response is missing the post title, author, or content. Please try again.');
  return { title: text(doc.title), author: text(doc.author), content: text(doc.content), date: text(doc.date), time: text(doc.time), views: text(doc.views), commentCount: text(doc.commentCount), comments: comments(doc.comments) };
}
export function parseForumPostBatch(raw: string, feed: ForumFeed, userNames: string[]): Record<string, ForumPost> {
  const source = raw.replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const blocks = [...source.matchAll(/<forum_post\b[^>]*>(?:(?!<forum_post\b)[\s\S])*?<\/forum_post\s*>/gi)];
  const posts = blocks.map(block => parseForumPost(block[0]));
  const entries = FORUM_SECTIONS.flatMap(section => feed[section].map((item, index) => ({ item, key: forumThreadKey(feed, section, index) })));
  if (feed.pinned) entries.unshift({ item: feed.pinned, key: forumThreadKey(feed, 'pinned', 0) });
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/^[@＠]+/, '').toLocaleLowerCase();
  const result: Record<string, ForumPost> = {};
  for (const { item, key } of entries) {
    const matches = posts.filter(post => normalize(post.title) === normalize(item.title) && (!item.author || normalize(post.author) === normalize(item.author)));
    if (matches.length !== 1) throw new Error(`The post response is incomplete or ambiguous for “${item.title}”. Please generate again; your existing forum has been kept.`);
    result[key] = { ...matches[0], comments: excludeForumUserComments(matches[0].comments, userNames) };
  }
  if (!blocks.length) throw new Error('The response is missing <forum_post> blocks. Please generate again.');
  return result;
}

export function forumFeedEnvelope(feed: ForumFeed): string {
  return `<forum>\n${yaml.stringify(feed).trim()}\n</forum>`;
}
export function excludeForumUserComments(rows: ForumComment[], names: string[]): ForumComment[] {
  const identities = new Set(names.map(name => name.normalize('NFKC').trim().toLocaleLowerCase()));
  return rows.filter(comment => !identities.has(comment.name.normalize('NFKC').trim().toLocaleLowerCase()));
}
export function parseForumComments(raw: string, userNames: string | string[]): ForumComment[] {
  return excludeForumUserComments(comments(envelope(raw, 'forum_comment').comments), Array.isArray(userNames) ? userNames : [userNames]);
}
export function forumThreadKey(feed: ForumFeed, section: ForumSection | 'pinned', index: number): string {
  return JSON.stringify([feed.date, feed.time, section, index, section === 'pinned' ? feed.pinned : feed[section][index]]);
}
export function appendForumComments(post: ForumPost, additions: ForumComment[]): ForumPost {
  const seen = new Set(post.comments.map(row => JSON.stringify([row.name, row.time, row.c, row.reply])));
  const fresh = additions.filter(row => { const key = JSON.stringify([row.name, row.time, row.c, row.reply]); if (seen.has(key)) return false; seen.add(key); return true; });
  const count = /^\d+$/.test(post.commentCount) ? Number(post.commentCount) + fresh.length : post.comments.length + fresh.length;
  return { ...post, comments: [...post.comments, ...fresh], commentCount: String(count) };
}
