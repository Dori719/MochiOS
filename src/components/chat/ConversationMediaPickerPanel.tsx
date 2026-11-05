/**
 * The composer's media picker.
 *
 * Only emoji and Mochi's global sticker library belong in this popover.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Download, Grid2X2, Hand, Heart, ImagePlus, Info, Link, LoaderCircle, Pencil, RefreshCw, Search, Smile, Sparkles, Sticker, Trash2, Upload, X } from 'lucide-react';
import { filterEmojiGroups, type EmojiCategoryId } from './conversation-emoji';
import { useConversationCustomStickers } from '../../hooks/use-conversation-custom-stickers';
import {
  clearMochiStickers, deleteMochiSticker, exportBrowserStickersJson, exportMochiStickersJson, importMochiStickers, loadMochiStickers, MAX_STICKER_NAME_LENGTH,
  readStickerBackup, renameMochiSticker, stickerFileType, stickerNameError, suggestStickerName,
  type StickerUpload,
} from '../../st/stickers';

export type ConversationMediaPickerTabId = 'emoji' | 'stickers';
export type ConversationMediaPickerTab = { id: ConversationMediaPickerTabId; label: string };

interface ConversationMediaPickerPanelProps {
  tabs: ConversationMediaPickerTab[];
  activeTab: ConversationMediaPickerTabId;
  onActiveTabChange: (tab: ConversationMediaPickerTabId) => void;
  onClose: () => void;
  onEmojiSelect: (emoji: string) => void;
  onStickerSelect: (name: string) => void;
  className?: string;
}

const CATEGORIES = [
  { id: 'all', label: 'All', icon: Grid2X2 },
  { id: 'smileys', label: 'Smileys', icon: Smile },
  { id: 'gestures', label: 'Gestures', icon: Hand },
  { id: 'hearts', label: 'Hearts', icon: Heart },
  { id: 'things', label: 'Things', icon: Sparkles },
] as const;

type StickerDraft = StickerUpload & { key: number; name: string };

function UploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt="" className="mochi-sticker-upload-preview" /> : null;
}

const namesFor = (sticker: { name: string; aliases?: string[] }) => [sticker.name, ...sticker.aliases ?? []];

export function ConversationMediaPickerPanel({
  tabs,
  activeTab,
  onActiveTabChange,
  onClose,
  onEmojiSelect,
  onStickerSelect,
  className,
}: ConversationMediaPickerPanelProps) {
  const [importError, setImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [drafts, setDrafts] = useState<StickerDraft[]>([]);
  const [renameDraft, setRenameDraft] = useState<{ id: string; name: string; originalName: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [stickerQuery, setStickerQuery] = useState('');
  const [category, setCategory] = useState<EmojiCategoryId>('all');
  const [focusedChoice, setFocusedChoice] = useState('');
  const [savedRenameId, setSavedRenameId] = useState<string | null>(null);
  const stickers = useConversationCustomStickers();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const nextDraftKey = useRef(0);
  const busy = working || stickers.loading;
  const editing = drafts.length > 0 || renameDraft !== null || linkDraft !== null || confirmClear;
  const savedNames = stickers.list.flatMap(namesFor);
  const draftErrors = drafts.map((draft, index) => {
    const usedNames = [...savedNames, ...drafts.filter((_, other) => other !== index).flatMap(namesFor)];
    return stickerNameError(draft.name, usedNames)
      || draft.aliases?.map((alias) => stickerNameError(alias, usedNames)).find(Boolean);
  });
  const renameError = renameDraft ? stickerNameError(renameDraft.name, stickers.list.filter((sticker) => sticker.id !== renameDraft.id).flatMap(namesFor)) : null;
  const error = importError || (!editing ? stickers.error : null);
  const query = activeTab === 'emoji' ? emojiQuery : stickerQuery;
  const emojiGroups = filterEmojiGroups(emojiQuery, category);
  const emojiChoices = emojiGroups.flatMap((group) => group.emojis.map((emoji) => emoji.value));
  const filteredStickers = stickers.list.filter((sticker) => namesFor(sticker).some((name) => name.normalize('NFKC').toLowerCase().includes(stickerQuery.normalize('NFKC').trim().toLowerCase())));
  const choices = activeTab === 'emoji' ? emojiChoices : filteredStickers.map((sticker) => sticker.id);
  const tabbableChoice = choices.includes(focusedChoice) ? focusedChoice : choices[0];

  const changeQuery = (value: string) => {
    if (activeTab === 'emoji') { setEmojiQuery(value); if (value) setCategory('all'); }
    else setStickerQuery(value);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  const dismiss = () => {
    rootRef.current?.closest('.c-bar')?.querySelector<HTMLButtonElement>('#plusBtn')?.focus({ preventScroll: true });
    onClose();
  };

  const navigateChoices = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (!target.matches('[data-media-choice]')) return;
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-media-choice]:not(:disabled)') ?? []);
    const index = buttons.indexOf(target as HTMLButtonElement);
    const grid = target.closest('.mochi-emoji-grid, .mochi-sticker-grid');
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key in offsets ? Math.max(0, Math.min(buttons.length - 1, index + offsets[event.key])) : -1;
    if (next < 0) return;
    event.preventDefault(); buttons[next]?.focus({ preventScroll: true });
    const bounds = buttons[next]?.getBoundingClientRect();
    const body = bodyRef.current;
    if (bounds && body) {
      const viewport = body.getBoundingClientRect();
      if (bounds.top < viewport.top) body.scrollTop -= viewport.top - bounds.top;
      else if (bounds.bottom > viewport.bottom) body.scrollTop += bounds.bottom - viewport.bottom;
    }
  };

  const reviewUploads = (uploads: StickerUpload[]) => {
    setManaging(true);
    const usedNames = [...savedNames];
    setDrafts(uploads.map((upload) => {
      const name = upload.name ?? suggestStickerName(upload.file.name, usedNames);
      usedNames.push(name, ...upload.aliases ?? []);
      return { ...upload, name, key: ++nextDraftKey.current };
    }));
  };

  const cancelEdit = () => { setDrafts([]); setRenameDraft(null); setLinkDraft(null); setConfirmClear(false); setImportError(null); };

  const downloadBackup = async (browser = false) => {
    setImportError(null); setNotice(null); setWorking(true);
    try {
      const json = await (browser ? exportBrowserStickersJson() : exportMochiStickersJson());
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `mochi-stickers-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setNotice('JSON backup downloaded.');
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker export failed.'); }
    finally { setWorking(false); }
  };

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // Wait for the updated library and the editor removal to commit before
  // returning focus to the renamed sticker. No storage refresh is needed.
  useEffect(() => {
    if (!savedRenameId || busy || editing) return;
    const choice = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-media-choice]') ?? [])
      .find((button) => button.dataset.mediaChoice === savedRenameId);
    if (choice) {
      choice.focus({ preventScroll: true });
      const body = bodyRef.current;
      if (body) body.scrollTop += choice.getBoundingClientRect().top - body.getBoundingClientRect().top;
    }
    setSavedRenameId(null);
  }, [savedRenameId, busy, editing, stickers.list]);

  useEffect(() => {
    const handleOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className={`mochi-media-picker-popover ${className ?? ''}`}
      data-conversation-media-picker
      data-chat-input-popup="media"
      aria-label="Emoji and stickers"
      role="dialog"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
        else navigateChoices(event);
      }}
      onPointerDown={(event) => {
        // This panel lives inside the composer shell, whose focus handler closes
        // the picker; presses inside it must not bubble.
        event.stopPropagation();
      }}
    >
      <div className="mochi-media-picker-header">
      <div className="mochi-media-picker-tabs" role="tablist" aria-label="Choose emoji or stickers" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || editing || working) return;
        event.preventDefault();
        const current = tabs.findIndex((tab) => tab.id === activeTab);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        onActiveTabChange(tabs[index].id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? 'active' : ''}
            role="tab"
            id={`${panelId}-${tab.id}-tab`}
            aria-selected={tab.id === activeTab}
            aria-controls={`${panelId}-panel`}
            tabIndex={tab.id === activeTab ? 0 : -1}
            disabled={working || editing}
            onClick={() => { onActiveTabChange(tab.id); if (bodyRef.current) bodyRef.current.scrollTop = 0; }}
          >
            {tab.id === 'emoji' ? <Smile size={17} aria-hidden="true" /> : <Sticker size={17} aria-hidden="true" />}
            {tab.label}
          </button>
        ))}
      </div>
      <button type="button" className="mochi-media-icon-button mochi-media-close" aria-label="Close emoji and stickers" onClick={dismiss}><X size={18} aria-hidden="true" /></button>
      </div>

      {!editing && <div className="mochi-media-search" data-emoji-search-shell>
        <Search size={17} aria-hidden="true" />
        <input ref={searchRef} type="search" aria-label={activeTab === 'emoji' ? 'Search emoji' : 'Search stickers'} placeholder={activeTab === 'emoji' ? 'Search emoji…' : 'Find a sticker…'} value={query} autoComplete="off" spellCheck={false} onChange={(event) => changeQuery(event.target.value)} />
        {query && <button type="button" className="mochi-media-icon-button" aria-label="Clear search" onClick={() => { changeQuery(''); searchRef.current?.focus(); }}><X size={15} aria-hidden="true" /></button>}
      </div>}

      {activeTab === 'emoji' && <div className="mochi-emoji-categories" role="group" aria-label="Emoji categories">
        {CATEGORIES.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-label={label} title={label} aria-pressed={category === id} onClick={() => {
          setCategory(id); setEmojiQuery(''); if (bodyRef.current) bodyRef.current.scrollTop = 0;
        }}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
      </div>}

      {activeTab === 'stickers' && <div className="mochi-sticker-library-bar">
        <span>{stickerQuery ? `${filteredStickers.length} of ${stickers.list.length}` : stickers.list.length} sticker{stickers.list.length === 1 ? '' : 's'}</span>
        <button type="button" className="mochi-media-icon-button" aria-label="Refresh stickers" title="Refresh stickers" disabled={busy || editing} onClick={() => { setImportError(null); void loadMochiStickers().catch(() => {}); }}><RefreshCw size={16} aria-hidden="true" /></button>
        <button type="button" className="mochi-sticker-manage" aria-pressed={managing} disabled={working || editing} onClick={() => setManaging((value) => !value)}><Pencil size={14} aria-hidden="true" />{managing ? 'Done' : 'Manage'}</button>
      </div>}

      <div ref={bodyRef} id={`${panelId}-panel`} className="mochi-media-picker-body" role="tabpanel" aria-labelledby={`${panelId}-${activeTab}-tab`} aria-busy={activeTab === 'stickers' && busy}>
        {activeTab === 'emoji' &&
          emojiGroups.map((group) => (
            <div key={group.label} className="mochi-media-group">
              <span className="mochi-media-group-label">{group.label}</span>
              <div className="mochi-emoji-grid">
                {group.emojis.map((emoji) => (
                  <button key={emoji.value} type="button" title={emoji.label} aria-label={emoji.label} data-media-choice={emoji.value} tabIndex={tabbableChoice === emoji.value ? 0 : -1} onFocus={() => setFocusedChoice(emoji.value)} onClick={() => onEmojiSelect(emoji.value)}>
                    {emoji.value}
                  </button>
                ))}
              </div>
            </div>
          ))}
        {activeTab === 'emoji' && !emojiChoices.length && <div className="mochi-media-empty" role="status"><Search size={28} aria-hidden="true" /><strong>No emoji found</strong><p>Try a word like “smile”, “love”, or “party”.</p><button type="button" className="mochi-media-empty-action" onClick={() => changeQuery('')}>Clear search</button></div>}

        {activeTab === 'stickers' && (
          <div className="mochi-sticker-tab">
            {error && <div className="mochi-media-error" role="alert"><p>{error}</p>{stickers.error && <button type="button" className="mochi-media-empty-action" disabled={busy} onClick={() => { setImportError(null); void loadMochiStickers().catch(() => {}); }}>Retry storage</button>}</div>}
            {notice && <p className="mochi-media-notice" role="status">{notice}</p>}
            {!stickers.loaded && busy && <div className="mochi-media-empty" role="status"><LoaderCircle className="mochi-media-loading" size={24} aria-hidden="true" /><strong>Loading your stickers…</strong></div>}
            {stickers.warning && <details className="mochi-sticker-recovery"><summary><Info size={15} aria-hidden="true" />{stickers.warning.startsWith('Recovered') ? 'Saved images recovered' : 'Sticker library needs attention'}</summary><p>{stickers.warning}</p></details>}
            {managing && <div className="mochi-sticker-management">
            <strong>Add & back up stickers</strong>
            <div className="mochi-sticker-tools">
              <button type="button" className="mochi-media-empty-action mochi-sticker-primary" disabled={busy || editing} onClick={() => fileRef.current?.click()}>
                <Upload size={16} aria-hidden="true" />Upload images
              </button>
              <button type="button" className="mochi-media-empty-action" disabled={busy || editing} onClick={() => { setLinkDraft(''); setImportError(null); }}><Link size={16} aria-hidden="true" />Add image link</button>
              <button type="button" className="mochi-media-empty-action" disabled={busy || editing} onClick={() => jsonRef.current?.click()}>
                <Upload size={16} aria-hidden="true" />Import JSON
              </button>
              <button type="button" className="mochi-media-empty-action" disabled={busy || editing || !stickers.list.length} onClick={() => void downloadBackup()}>
                <Download size={16} aria-hidden="true" />Export JSON
              </button>
              {(stickers.warning || (!stickers.loaded && stickers.error)) && <button type="button" className="mochi-media-empty-action" disabled={busy || editing} onClick={() => void downloadBackup(true)}>Export browser JSON</button>}
            </div>
            <details className="mochi-sticker-storage-details"><summary>Storage & recovery</summary>
              {stickers.loaded && <p className="mochi-media-empty-hint">Saved on the SillyTavern server: <span>{stickers.location}</span></p>}
              <button type="button" className="mochi-sticker-erase" disabled={busy || editing} onClick={() => { setConfirmClear(true); setImportError(null); setNotice(null); }}><Trash2 size={15} aria-hidden="true" />Erase all stickers</button>
            </details>
            </div>}
            {confirmClear && <div className="mochi-sticker-editor" role="group" aria-label="Confirm sticker reset">
              <strong>Erase the shared sticker library?</strong>
              <p className="mochi-media-empty-hint">This removes all saved stickers across Mochi chats. Existing sticker messages may lose their images. This cannot be undone.</p>
              <div className="mochi-sticker-editor-actions">
                <button type="button" className="mochi-media-empty-action mochi-sticker-erase" disabled={busy} onClick={async () => {
                  setWorking(true); setImportError(null);
                  try { await clearMochiStickers(); setConfirmClear(false); setNotice('All stickers erased. You can add new stickers now.'); }
                  catch (error) { setImportError(error instanceof Error ? error.message : 'Could not erase stickers. Try again.'); }
                  finally { setWorking(false); }
                }}>{busy ? 'Erasing…' : 'Erase all stickers'}</button>
                <button type="button" className="mochi-sticker-cancel" disabled={busy} onClick={cancelEdit}>Cancel</button>
              </div>
            </div>}
            {linkDraft !== null && <form className="mochi-sticker-editor" onSubmit={async (event) => {
              event.preventDefault(); setWorking(true); setImportError(null);
              try {
                const url = new URL(linkDraft.trim());
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Enter an HTTP or HTTPS image link.');
                const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
                if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
                const blob = await response.blob();
                const type = await stickerFileType(blob);
                const name = decodeURIComponent(url.pathname.split('/').pop() || `sticker.${type.extension}`);
                reviewUploads([{ file: new File([blob], name, { type: type.mimeType }) }]);
                setLinkDraft(null);
              } catch (error) { setImportError(error instanceof TypeError ? 'Could not download this image. The host may block downloads; upload the image instead.' : error instanceof Error ? error.message : 'Image download failed.'); }
              finally { setWorking(false); }
            }}>
              <label>Sticker image link<input autoFocus type="url" className="mochi-sticker-name-input" value={linkDraft} required disabled={busy} onChange={(event) => setLinkDraft(event.target.value)} placeholder="https://…" /></label>
              <div className="mochi-sticker-editor-actions">
                <button type="submit" className="mochi-media-empty-action" disabled={busy || !linkDraft.trim()}>{busy ? 'Downloading…' : 'Next: name sticker'}</button>
                <button type="button" className="mochi-sticker-cancel" disabled={busy} onClick={cancelEdit}>Cancel</button>
              </div>
            </form>}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              aria-label="Import sticker images"
              onChange={async (event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (!files.length) return;
                setImportError(null); setNotice(null); setWorking(true);
                try {
                  await Promise.all(files.map(stickerFileType));
                  reviewUploads(files.map((file) => ({ file })));
                }
                catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker import failed.'); }
                finally { setWorking(false); }
              }}
            />
            <input
              ref={jsonRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Import sticker JSON backup"
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                setImportError(null); setNotice(null); setWorking(true);
                try {
                  const uploads = await readStickerBackup(file);
                  if (!uploads.length) throw new Error('This backup contains no stickers.');
                  reviewUploads(uploads);
                } catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker JSON import failed.'); }
                finally { setWorking(false); }
              }}
            />
            {drafts.length > 0 && (
              <form className="mochi-sticker-editor" aria-label="Review sticker names" onSubmit={async (event) => {
                event.preventDefault();
                if (busy || draftErrors.some(Boolean)) return;
                setImportError(null); setWorking(true);
                try {
                  await importMochiStickers(drafts.map(({ file, name, aliases }) => ({ file, name, aliases })));
                  setNotice(`${drafts.length} sticker${drafts.length === 1 ? '' : 's'} saved.`);
                  setDrafts([]);
                } catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker save failed.'); }
                finally { setWorking(false); }
              }}>
                <strong>Review sticker names</strong>
                <p className="mochi-media-empty-hint">Edit names before saving. Names must be unique, ignoring case.</p>
                {drafts.map((draft, index) => (
                  <div className="mochi-sticker-upload" key={draft.key}>
                    <UploadPreview file={draft.file} />
                    <label className="mochi-sticker-name-field">
                      <span className="mochi-sticker-file-name" title={draft.file.name}>{draft.file.name}</span>
                      <input
                        type="text"
                        aria-label={`Sticker name for ${draft.file.name}`}
                        aria-invalid={Boolean(draftErrors[index])}
                        aria-describedby={draftErrors[index] ? `mochi-sticker-draft-error-${draft.key}` : undefined}
                        className="mochi-sticker-name-input"
                        value={draft.name}
                        maxLength={MAX_STICKER_NAME_LENGTH}
                        autoComplete="off"
                        disabled={busy}
                        onChange={(event) => {
                          const name = event.currentTarget.value;
                          setImportError(null);
                          setDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, name } : item));
                        }}
                      />
                      {draftErrors[index] && <span className="mochi-sticker-name-error" id={`mochi-sticker-draft-error-${draft.key}`} role="alert">{draftErrors[index]}</span>}
                    </label>
                    <button type="button" className="mochi-sticker-discard" aria-label={`Discard upload ${draft.file.name}`} disabled={busy} onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}><X size={16} aria-hidden="true" /></button>
                  </div>
                ))}
                <div className="mochi-sticker-editor-actions">
                  <button type="submit" className="mochi-media-empty-action mochi-sticker-save" disabled={busy || draftErrors.some(Boolean)}>{busy ? 'Saving…' : 'Save stickers'}</button>
                  <button type="button" className="mochi-sticker-cancel" disabled={busy} onClick={cancelEdit}>Cancel</button>
                </div>
              </form>
            )}
            {renameDraft && (
              <form className="mochi-sticker-editor" aria-label="Rename saved sticker" onSubmit={async (event) => {
                event.preventDefault();
                if (busy || renameError) return;
                setImportError(null); setWorking(true);
                try {
                  await renameMochiSticker(renameDraft.id, renameDraft.name);
                  setSavedRenameId(renameDraft.id);
                  setFocusedChoice(renameDraft.id);
                  setStickerQuery('');
                  setRenameDraft(null);
                  setNotice('Sticker renamed.');
                } catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker rename failed.'); }
                finally { setWorking(false); }
              }}>
                <strong>Rename {renameDraft.originalName}</strong>
                <label className="mochi-sticker-name-field">
                  Sticker name
                  <input
                    type="text"
                    className="mochi-sticker-name-input"
                    aria-label="New sticker name"
                    aria-invalid={Boolean(renameError)}
                    aria-describedby={renameError ? 'mochi-sticker-rename-error' : undefined}
                    value={renameDraft.name}
                    maxLength={MAX_STICKER_NAME_LENGTH}
                    autoComplete="off"
                    disabled={busy}
                    autoFocus
                    onChange={(event) => { setImportError(null); setRenameDraft({ ...renameDraft, name: event.currentTarget.value }); }}
                  />
                  {renameError && <span className="mochi-sticker-name-error" id="mochi-sticker-rename-error" role="alert">{renameError}</span>}
                </label>
                <p className="mochi-media-empty-hint">Previous names stay reserved so older messages keep their sticker images.</p>
                <div className="mochi-sticker-editor-actions">
                  <button type="submit" className="mochi-media-empty-action mochi-sticker-rename-save" disabled={busy || Boolean(renameError)}>{busy ? 'Saving…' : 'Save name'}</button>
                  <button type="button" className="mochi-sticker-cancel" disabled={busy} onClick={cancelEdit}>Cancel</button>
                </div>
              </form>
            )}
            {!stickers.list.length && !busy && !editing && !managing && !error && <div className="mochi-media-empty"><ImagePlus size={30} aria-hidden="true" /><strong>Your stickers belong here</strong><p>Add images once. Use them in every Mochi chat.</p><button type="button" className="mochi-media-empty-action" onClick={() => setManaging(true)}>Add stickers</button><span className="mochi-media-empty-hint">PNG, JPEG, GIF, WebP · up to 10 MB each</span></div>}
            {stickers.list.length > 0 && !filteredStickers.length && <div className="mochi-media-empty" role="status"><Search size={28} aria-hidden="true" /><strong>No stickers found</strong><p>Try a sticker’s name or a previous name.</p><button type="button" className="mochi-media-empty-action" onClick={() => changeQuery('')}>Clear search</button></div>}
            <div className="mochi-sticker-grid">
              {filteredStickers.map((sticker) => (
                <div className="mochi-sticker-cell" key={sticker.id}>
                  <button type="button" className="mochi-sticker-send" title={`Send ${sticker.name}`} aria-label={`Send ${sticker.name}`} data-media-choice={sticker.id} tabIndex={tabbableChoice === sticker.id ? 0 : -1} disabled={busy || editing} onFocus={() => setFocusedChoice(sticker.id)} onClick={() => onStickerSelect(sticker.name)}>
                    <img src={sticker.url} alt="" loading="lazy" />
                    <span>{sticker.name}</span>
                  </button>
                  {managing && <div className="mochi-sticker-cell-actions"><button type="button" className="mochi-sticker-rename" aria-label={`Rename ${sticker.name}`} disabled={busy || editing} onClick={() => {
                    setImportError(null); setNotice(null);
                    setRenameDraft({ id: sticker.id, name: sticker.name, originalName: sticker.name });
                  }}>Rename</button>
                  <button type="button" className="mochi-sticker-delete" aria-label={`Remove ${sticker.name} from sticker library`} disabled={busy || editing} onClick={async () => {
                    setImportError(null); setNotice(null);
                    try { await deleteMochiSticker(sticker.id); }
                    catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker removal failed.'); }
                  }}><Trash2 size={14} aria-hidden="true" /></button></div>}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
      <div className="mochi-media-picker-footer">{activeTab === 'emoji' ? 'Add an emoji to your message' : managing ? 'Names stay linked to older messages' : 'Select a sticker to send'}</div>
    </div>
  );
}
