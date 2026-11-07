import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, Pin, MessageSquare, X, CornerDownRight, Archive, Eye, Users } from 'lucide-react';
import { archiveForumPosts, archiveForumResponse, readForumState, saveForumState } from '../../../st/forum';
import { onEvent, offEvent } from '../../../st/adapter';
import { forumFeedEnvelope, parseForumPostBatch } from './mochi-forum-data';
import { appendForumComments, FORUM_SECTIONS, forumThreadKey, parseForumComments, parseForumFeed, type ForumComment, type ForumSection, type ForumState, type ForumSummary } from './mochi-forum-data';

const sections = {
  nearby: { title: 'Nearby', description: 'Local news, familiar places, everyday life.' },
  discover: { title: 'Discover', description: 'Questions, interests, and unexpected finds.' },
  trending: { title: 'Trending', description: 'The conversations getting everyone talking.' },
};
const displayName = (name: string) => name.trim().replace(/^[@＠]+\s*/, '');
export type ForumRequest = (key: 'forum' | 'forumPost' | 'forumComment', input: string, signal: AbortSignal, feedContext?: string) => Promise<string>;
export function MochiForum({ chatId, userName, userNames, clock, onClose, request }: { chatId: string; userName: string; userNames: string[]; clock: string; onClose: () => void; request: ForumRequest }) {
  const [state, setState] = useState<ForumState>(readForumState);
  const [section, setSection] = useState<ForumSection | 'saved'>('nearby');
  const [thread, setThread] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<ForumComment | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const post = thread ? state.posts[thread] : null;
  const commit = (next: ForumState) => { saveForumState(chatId, next); stateRef.current = next; setState(next); };
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const restore = (_index?: unknown, source?: string) => {
      if (source === 'mochios') return;
      controller.current?.abort(); controller.current = null; setBusy('');
      const next = readForumState();
      saveForumState(chatId, next);
      const feedChanged = JSON.stringify(stateRef.current.feed) !== JSON.stringify(next.feed);
      if (feedChanged) { setSelectedPosts(new Set()); setSelecting(false); }
      stateRef.current = next; setState(next); setError(''); setReply(null);
      if (feedChanged || !next.feed) { setThread(null); setDraft(''); }
      if (!next.feed) setSection('nearby');
    };
    const events = ['MESSAGE_DELETED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED'];
    const restoreMutation = () => restore();
    events.forEach(event => onEvent(event, restoreMutation));
    onEvent('CHARACTER_MESSAGE_RENDERED', restore);
    return () => { events.forEach(event => offEvent(event, restoreMutation)); offEvent('CHARACTER_MESSAGE_RENDERED', restore); };
  }, [chatId]);
  const back = () => {
    controller.current?.abort(); controller.current = null; setBusy('');
    if (reply) { setReply(null); return; }
    if (thread) { setThread(null); setDraft(''); setError(''); return; }
    if (selecting) { setSelecting(false); setSelectedPosts(new Set()); return; }
    if (section === 'saved') { setSection('nearby'); setError(''); return; }
    onClose();
  };
  useEffect(() => {
    const escape = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); back();
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('mochios:escape', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('mochios:escape', escape, true); };
  });
  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [section, thread]);
  async function run(label: string, work: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort; setBusy(label); setError('');
    try { await work(abort.signal); }
    catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Forum could not finish the request. Please try again.'); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(''); } }
  }
  const refresh = () => run('Updating the board…', async signal => {
    const feed = parseForumFeed(await request('forum', 'Generate the forum for the current roleplay world and location. Follow the platform culture and 80/20 immersion rule. Return <forum>.', signal));
    if (signal.aborted) return;
    await archiveForumResponse(chatId, 'forum', feed, signal);
    if (!signal.aborted) { commit({ feed, posts: { ...stateRef.current.posts } }); setSelectedPosts(new Set()); setSelecting(false); }
  });
  const generateSelected = () => run(`Generating ${selectedPosts.size} selected posts…`, async signal => {
    const source = stateRef.current.feed;
    if (!source || !selectedPosts.size) return;
    const subset = { ...source, pinned: source.pinned && selectedPosts.has(forumThreadKey(source, 'pinned', 0)) ? source.pinned : null,
      nearby: [], discover: [], trending: [] } as typeof source;
    const keys = new Map<string, string>();
    if (subset.pinned) keys.set(forumThreadKey(subset, 'pinned', 0), forumThreadKey(source, 'pinned', 0));
    for (const section of FORUM_SECTIONS) {
      source[section].forEach((item, index) => {
        const originalKey = forumThreadKey(source, section, index);
        if (!selectedPosts.has(originalKey)) return;
        subset[section].push(item);
        keys.set(forumThreadKey(subset, section, subset[section].length - 1), originalKey);
      });
    }
    const raw = await request('forumPost', 'Generate a separate <forum_post> for each entry in the provided selection only. Preserve titles and authors exactly. Do not add other posts.', signal, forumFeedEnvelope(subset));
    if (signal.aborted) return;
    const parsed = parseForumPostBatch(raw, subset, [userName, ...userNames]);
    const posts = Object.fromEntries(Object.entries(parsed).map(([key, post]) => [keys.get(key)!, post]));
    await archiveForumPosts(chatId, posts, signal);
    if (!signal.aborted) { commit({ ...stateRef.current, posts: { ...stateRef.current.posts, ...posts } }); setSelectedPosts(new Set()); setSelecting(false); }
  });
  const togglePost = (key: string) => setSelectedPosts(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const openThread = (key: string) => setThread(key);
  const send = () => {
    if (!thread || !post || !draft.trim()) return;
    const own: ForumComment = { name: userName, time: clock, c: draft.trim(), own: true, ...(reply ? { reply: { name: reply.name, time: reply.time } } : {}) };
    try { commit({ ...state, posts: { ...state.posts, [thread]: appendForumComments(post, [own]) } }); setDraft(''); setReply(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Your comment could not be saved.'); }
  };
  const moreComments = () => {
    if (!thread || !post) return;
    const key = thread;
    void run('Loading new replies…', async signal => {
      const additions = parseForumComments(await request('forumComment', `Continue this discussion with new comments only. The user is ${userName}; never speak for them or repeat existing comments. Respond to their latest comment if present.\n${JSON.stringify(post)}\nReturn <forum_comment>.`, signal), [userName, ...userNames]);
      await archiveForumResponse(chatId, 'forum_comment', { title: post.title, author: post.author, comments: additions }, signal);
      if (!signal.aborted) commit({ ...stateRef.current, posts: { ...stateRef.current.posts, [key]: appendForumComments(stateRef.current.posts[key], additions) } });
    });
  };
  const row = (item: ForumSummary, key: string, pinned = false, rank?: number) => <li key={key} className={rank ? 'forum-ranked-thread' : undefined}>
    {rank && <span className={`forum-rank${rank <= 3 ? ' forum-rank-leading' : ''}`} aria-label={`Rank ${rank}`}>{rank}</span>}
    <button className={`forum-thread-row ${pinned ? 'forum-pinned' : ''}${selecting && selectedPosts.has(key) ? ' forum-thread-selected' : ''}`} aria-pressed={selecting ? selectedPosts.has(key) : undefined} onClick={() => selecting ? togglePost(key) : openThread(key)} disabled={Boolean(busy)}>
      {selecting && <span className="forum-selection-label">{selectedPosts.has(key) ? 'Selected' : 'Select post'}{state.posts[key] ? ' · Already generated' : ''}</span>}
      {pinned ? <span className="forum-tag"><Pin size={13} /> Board announcement</span> : <span className="forum-feed-author"><span className="forum-avatar" aria-hidden="true">{Array.from(displayName(item.author) || '?')[0]}</span><strong>{displayName(item.author) || 'Community member'}</strong>{item.hot && <span className="forum-heat">{item.hot}</span>}</span>}
      <span className="forum-thread-copy"><strong>{item.title}</strong>{item.content && <span className="forum-excerpt">{item.content}</span>}</span>
      <span className="forum-thread-footer">{item.category && <span className="forum-category">{item.category}</span>}<span className="forum-reply-count"><MessageSquare size={14} />{state.posts[key]?.commentCount || item.comments || '0'} replies</span><span>{item.views || '0'} views</span></span>
    </button>
  </li>;
  const feed = state.feed;
  const pinned = feed?.pinned ? row(feed.pinned, forumThreadKey(feed, 'pinned', 0), true) : null;
  const listed = section !== 'saved' && feed ? feed[section].map((item, index) => ({ item, key: forumThreadKey(feed, section, index) })) : [];
  return <section className="forum-app" aria-label="Forum">
    <header className="forum-header"><button className="forum-icon" onClick={back} aria-label={thread ? 'Back to threads' : section === 'saved' ? 'Back to discussions' : 'Back to home'}><ArrowLeft size={20} /></button><h1>{thread ? 'Discussion' : section === 'saved' ? 'Read threads' : 'Forum'}</h1><button className="forum-icon" onClick={() => post ? moreComments() : void refresh()} disabled={Boolean(busy)} aria-label={post ? 'Generate new replies' : 'Refresh forum'}><RefreshCw size={18} /></button></header>
    {!thread && section !== 'saved' && <nav className="forum-tabs" aria-label="Forum sections">{FORUM_SECTIONS.map(key => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { controller.current?.abort(); controller.current = null; setBusy(''); setSection(key); setError(''); }}>{sections[key].title}</button>)}</nav>}
    {!thread && feed && section !== 'saved' && <div className="forum-batch-toolbar"><span>{selecting ? `${selectedPosts.size} selected across sections` : 'Choose which posts to generate'}</span><button disabled={Boolean(busy)} onClick={() => { setSelecting(!selecting); setSelectedPosts(new Set()); }}>{selecting ? 'Done selecting' : 'Select posts'}</button></div>}
    {busy && <div className="forum-status" role="status"><span>{busy}</span><button onClick={() => { controller.current?.abort(); controller.current = null; setBusy(''); }}>Cancel</button></div>}
    {error && <div className="forum-error" role="alert"><p>{error}</p><button onClick={() => setError('')}>Dismiss</button></div>}
    <div className={`forum-body${(thread && !post) || (!post && section !== 'saved' && !feed) ? ' forum-body-empty' : ''}`} ref={bodyRef} aria-busy={Boolean(busy)}>
      {thread && !post ? <div className="forum-empty"><Users size={32} strokeWidth={1.5} /><h2>No saved post</h2><p>Select this post from the feed to generate it with your next batch.</p><button className="forum-primary" onClick={() => { setSelectedPosts(previous => new Set([...previous, thread])); setSelecting(true); setThread(null); }}>Select for generation</button></div> : post ? <>
        <article className="forum-post"><h2>{post.title}</h2><div className="forum-byline"><span className="forum-avatar" aria-hidden="true">{Array.from(displayName(post.author))[0]}</span><div><strong>{displayName(post.author)}</strong><span className="forum-meta">{[post.date, post.time].filter(Boolean).join(' · ')}</span></div><span className="forum-author-label">Author</span></div><p className="forum-prose">{post.content}</p><div className="forum-post-activity"><span><Eye size={15} />{post.views || '0'} views</span><span><MessageSquare size={15} />{post.commentCount || post.comments.length} replies</span></div></article>
        <div className="forum-section-heading forum-replies-heading"><h3>Replies <span>{post.comments.length}</span></h3><button onClick={moreComments} disabled={Boolean(busy)}><RefreshCw size={14} /> Load new replies</button></div>
        {post.comments.length === 0 && <p className="forum-empty-inline">No replies yet. Start the conversation below.</p>}
        <ol className="forum-comments">{post.comments.map((comment, index) => {
          const target = comment.reply ? post.comments.findIndex(row => row.name === comment.reply!.name && row.time === comment.reply!.time) : -1;
          return <li key={index} id={`forum-comment-${index}`} tabIndex={-1}><span className="forum-avatar forum-comment-avatar" aria-hidden="true">{Array.from(displayName(comment.name))[0]}</span><div className="forum-comment-content"><div className="forum-comment-head"><strong>{displayName(comment.name)}{comment.own ? <span className="forum-author-label">You</span> : comment.name === post.author ? <span className="forum-author-label">Author</span> : null}</strong><span>{comment.time}</span></div>{comment.reply && (target >= 0 ? <button className="forum-quote" onClick={() => { const node = document.getElementById(`forum-comment-${target}`); node?.scrollIntoView({ block: 'center', behavior: 'auto' }); node?.focus({ preventScroll: true }); }}><span>{displayName(comment.reply.name)} · {comment.reply.time}</span><span className="forum-quote-excerpt">{post.comments[target].c}</span></button> : <span className="forum-meta">Reply to {displayName(comment.reply.name)} · {comment.reply.time}</span>)}<p className="forum-prose">{comment.c}</p><div className="forum-comment-actions"><button className="forum-reply" onClick={() => { setReply(comment); inputRef.current?.focus(); }}><CornerDownRight size={14} aria-hidden="true" />Reply</button></div></div></li>;
        })}</ol>
      </> : section === 'saved' ? <><div className="forum-intro"><h2>Your reading history</h2><p>Opened threads stay here when the board refreshes.</p></div><ul className="forum-threads">{Object.entries(state.posts).reverse().map(([key, item]) => row({ ...item, comments: item.commentCount, category: '', likes: '', hot: '' }, key))}</ul>{!Object.keys(state.posts).length && <p className="forum-empty-inline">Open a thread to keep it here.</p>}</> : !feed ? <div className="forum-empty"><Users size={32} strokeWidth={1.5} /><h2>A window into your world</h2><p>Bring the local conversations, discoveries, and big debates from this roleplay into your board.</p><button className="forum-primary" onClick={() => void refresh()} disabled={Boolean(busy)}>Generate forum</button></div> : section ? <>
        <ul className="forum-threads" aria-label={`${sections[section].title} discussions`}>{pinned}{listed.map(({ item, key }, index) => row(item, key, false, section === 'trending' ? index + 1 : undefined))}</ul>{listed.length === 0 && <p className="forum-empty-inline">No threads in this section yet. Refresh the board to discover more.</p>}
        <p className="forum-footnote">Updated {feed.date} {feed.time}</p>
      </> : null}
    </div>
    {!thread && selecting && feed && section !== 'saved' && <div className="forum-batch-actions"><button disabled={Boolean(busy) || !selectedPosts.size} onClick={() => setSelectedPosts(new Set())}>Clear</button><button className="forum-primary" disabled={Boolean(busy) || !selectedPosts.size} onClick={() => void generateSelected()}>Generate selected ({selectedPosts.size})</button></div>}
    {!thread && <nav className="forum-bottom-nav" aria-label="Forum navigation"><button aria-current={section !== 'saved' ? 'page' : undefined} onClick={() => { setSection('nearby'); }}><MessageSquare size={19} /><span>Discussions</span></button><button aria-current={section === 'saved' ? 'page' : undefined} onClick={() => { controller.current?.abort(); controller.current = null; setBusy(''); setSection('saved'); }}><Archive size={19} /><span>Read threads</span></button></nav>}
    {post && <form className="forum-composer" onSubmit={event => { event.preventDefault(); send(); }}>
      {reply && <div className="forum-reply-target"><span>Replying to <strong>{displayName(reply.name)}</strong> · {reply.time}</span><button type="button" className="forum-icon" aria-label="Cancel reply" onClick={() => setReply(null)}><X size={16} /></button></div>}
      <label htmlFor="forum-comment-input">Comment as {displayName(userName)}</label><div className="forum-compose-row"><textarea id="forum-comment-input" ref={inputRef} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add to the discussion…" rows={2} /><button className="forum-primary" type="submit" disabled={!draft.trim() || Boolean(busy)}>Post</button></div>
    </form>}
  </section>;
}
