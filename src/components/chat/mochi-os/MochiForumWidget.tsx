import { useState, type CSSProperties } from 'react';
import { Users, FileText, MessageSquare, ChevronDown, Pin } from 'lucide-react';
import { useMochiOsSettings } from '../../../hooks/use-mochi-os-settings';
import { DEFAULT_MOCHI_OS_SETTINGS } from '@mochi-os/shared';
import { buildMochiCustomTokens } from './mochi-os.color';
import { useMochiThemeMode } from './use-mochi-theme-mode';
import { FORUM_SECTIONS, parseForumFeed, parseForumPost, parseForumComments, type ForumFeed, type ForumPost, type ForumComment, type ForumSection } from './mochi-forum-data';

export type ForumWidgetData = { type: 'forum'; feed: ForumFeed } | { type: 'forum_post'; post: ForumPost } | { type: 'forum_comment'; comments: ForumComment[] };
export function parseForumWidget(raw: string, tag: string): ForumWidgetData | null {
  try {
    if (tag === 'forum') return { type: tag, feed: parseForumFeed(raw) };
    if (tag === 'forum_post') return { type: tag, post: parseForumPost(raw) };
    if (tag === 'forum_comment') return { type: tag, comments: parseForumComments(raw, []) };
  } catch { /* Invalid records remain ordinary roleplay text. */ }
  return null;
}
const name = (value: string) => value.trim().replace(/^[@＠]+\s*/, '');
export function MochiForumWidget({ data }: { data: ForumWidgetData }) {
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const mode = useMochiThemeMode(settings.theme);
  const rgb = settings.customRgb;
  const color = `#${[rgb.r, rgb.g, rgb.b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<ForumSection>('nearby');
  const label = data.type === 'forum' ? 'Forum Feed' : data.type === 'forum_post' ? 'Forum Post' : 'Forum Replies';
  const Icon = data.type === 'forum' ? Users : data.type === 'forum_post' ? FileText : MessageSquare;
  const comments = data.type === 'forum_post' ? data.post.comments : data.type === 'forum_comment' ? data.comments : [];
  const count = data.type === 'forum' ? FORUM_SECTIONS.reduce((sum, key) => sum + data.feed[key].length, 0) : comments.length;
  return <section className={`mochi-scope mochi-forum-widget forum-widget-${data.type} theme-${settings.theme} color-${settings.colorPreset}`}
    style={(settings.colorPreset === 'custom' ? buildMochiCustomTokens(color, mode) : undefined) as CSSProperties} aria-label={`${label} transcript`}>
    <button className="forum-widget-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><Icon size={23} /><span><strong>{label}</strong>{data.type === 'forum_post' && <span className="forum-widget-post-title">{data.post.title}</span>}<small>{data.type === 'forum_post' ? `${name(data.post.author)} · ` : ''}{count} {data.type === 'forum' ? 'threads' : 'replies'} · {open ? 'Collapse' : `Open ${data.type === 'forum' ? 'feed' : data.type === 'forum_post' ? 'post' : 'replies'}`}</small></span><ChevronDown size={18} /></button>
    {open && <div className="forum-widget-content">
      {data.type === 'forum' ? <>
        <nav className="forum-tabs" aria-label="Forum transcript sections">{FORUM_SECTIONS.map(key => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}>{key[0].toUpperCase() + key.slice(1)}</button>)}</nav>
        {data.feed.pinned && <article className="forum-widget-pinned"><span><Pin size={13} /> Pinned</span><h3>{data.feed.pinned.title}</h3><p>{data.feed.pinned.content}</p></article>}
        {data.feed[section].map((item, index) => <article className="forum-widget-thread" key={index}>{section === 'trending' && <span className="forum-widget-rank">{index + 1}</span>}<div><small>{name(item.author)}{item.category && ` · ${item.category}`}</small><h3>{item.title}</h3><p>{item.content}</p><small>{item.comments || '0'} replies · {item.views || '0'} views</small></div></article>)}
        {!data.feed[section].length && <p className="forum-widget-empty">No threads in this section.</p>}
      </> : <>
        {data.type === 'forum_post' && <article className="forum-widget-post"><strong>{name(data.post.author)}</strong><small>{data.post.date} · {data.post.time}</small><p>{data.post.content}</p><small>{data.post.views || '0'} views · {data.post.commentCount || comments.length} replies</small></article>}
        <ol className="forum-widget-comments">{comments.map((comment, index) => <li key={index}><header><strong>{name(comment.name)}</strong><time>{comment.time}</time></header>{comment.reply && <div className="forum-widget-reference">Reply to {name(comment.reply.name)} · {comment.reply.time}</div>}<p>{comment.c}</p></li>)}</ol>
        {!comments.length && <p className="forum-widget-empty">No replies in this record.</p>}
      </>}
    </div>}
  </section>;
}
