/**
 * The composer's media picker.
 *
 * Only emoji and Mochi's global sticker library belong in this popover.
 */
import { useEffect, useRef, useState } from 'react';
import { useConversationCustomStickers } from '../../hooks/use-conversation-custom-stickers';
import {
  deleteMochiSticker, exportBrowserStickersJson, exportMochiStickersJson, importMochiStickers, loadMochiStickers, MAX_STICKER_NAME_LENGTH,
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

const EMOJI_GROUPS: Array<{ label: string; emojis: string[] }> = [
  {
    label: 'Smileys',
    emojis: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😗 😋 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👻 💀 👽 🤖 💩'.split(
      ' ',
    ),
  },
  {
    label: 'Gestures',
    emojis: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 💪 🦾 🖕 ✍️ 🫰 🫱 🫲 🫳 🫴'.split(
      ' ',
    ),
  },
  {
    label: 'Hearts',
    emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭'.split(
      ' ',
    ),
  },
  {
    label: 'Things',
    emojis: '🎉 🎊 🎈 🎁 🎀 🍀 🌸 🌺 🌻 🌹 🥀 🌷 🌱 🌿 🍁 🍂 🍃 🌞 🌝 🌚 ⭐ 🌟 ✨ ⚡ 🔥 💧 🌈 ☀️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 🌊 🍕 🍔 🍟 🌮 🍣 🍜 🍰 🧁 🍫 🍩 ☕ 🍵 🍺 🍷 🥂 🎮 🎧 🎵 🎶 📱 💻 ⌚ 📷 🎬 🚗 ✈️ 🏠 🏫 🏥 🏦 🛒 🎡 🎢 🗽 ⛰️ 🏖️ 🌃 🌆 🌇 🌉 🎆 🎇 🕯️ 🔮 🧸 🪄 🪅'.split(
      ' ',
    ),
  },
];

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
  const [drafts, setDrafts] = useState<StickerDraft[]>([]);
  const [renameDraft, setRenameDraft] = useState<{ id: string; name: string; originalName: string } | null>(null);
  const [working, setWorking] = useState(false);
  const stickers = useConversationCustomStickers();
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const nextDraftKey = useRef(0);
  const busy = working || stickers.loading;
  const editing = drafts.length > 0 || renameDraft !== null;
  const savedNames = stickers.list.flatMap(namesFor);
  const draftErrors = drafts.map((draft, index) => {
    const usedNames = [...savedNames, ...drafts.filter((_, other) => other !== index).flatMap(namesFor)];
    return stickerNameError(draft.name, usedNames)
      || draft.aliases?.map((alias) => stickerNameError(alias, usedNames)).find(Boolean);
  });
  const renameError = renameDraft ? stickerNameError(renameDraft.name, stickers.list.filter((sticker) => sticker.id !== renameDraft.id).flatMap(namesFor)) : null;
  const error = importError || (!editing ? stickers.error : null);

  const reviewUploads = (uploads: StickerUpload[]) => {
    const usedNames = [...savedNames];
    setDrafts(uploads.map((upload) => {
      const name = upload.name ?? suggestStickerName(upload.file.name, usedNames);
      usedNames.push(name, ...upload.aliases ?? []);
      return { ...upload, name, key: ++nextDraftKey.current };
    }));
  };

  const cancelEdit = () => { setDrafts([]); setRenameDraft(null); setImportError(null); };

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
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      }}
      onPointerDown={(event) => {
        // This panel lives inside the composer shell, whose focus handler closes
        // the picker; presses inside it must not bubble.
        event.stopPropagation();
      }}
    >
      <div className="mochi-media-picker-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? 'active' : ''}
            aria-pressed={tab.id === activeTab}
            onClick={() => onActiveTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mochi-media-picker-body">
        {activeTab === 'emoji' &&
          EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="mochi-media-group">
              <span className="mochi-media-group-label">{group.label}</span>
              <div className="mochi-emoji-grid">
                {group.emojis.map((emoji) => (
                  <button key={emoji} type="button" title={emoji} onClick={() => onEmojiSelect(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}

        {activeTab === 'stickers' && (
          <div className="mochi-sticker-tab">
            <div className="mochi-sticker-tools">
              <button type="button" className="mochi-media-empty-action" disabled={busy || editing} onClick={() => fileRef.current?.click()}>
                Upload images
              </button>
              <button type="button" className="mochi-media-empty-action" disabled={busy || editing} onClick={() => jsonRef.current?.click()}>
                Import JSON
              </button>
              <button type="button" className="mochi-media-empty-action" disabled={busy || editing || !stickers.list.length} onClick={() => void downloadBackup()}>
                Export JSON
              </button>
              {stickers.error && <button type="button" className="mochi-media-empty-action" disabled={busy || editing} onClick={() => { setImportError(null); void loadMochiStickers().catch(() => {}); }}>Retry storage</button>}
              {(stickers.warning || (!stickers.loaded && stickers.error)) && <button type="button" className="mochi-media-empty-action" disabled={busy || editing} onClick={() => void downloadBackup(true)}>Export browser JSON</button>}
            </div>
            {stickers.loaded && <p className="mochi-media-empty-hint">Saved in the extension folder: {stickers.location}.</p>}
            {stickers.warning && <p className="mochi-media-error" role="alert">{stickers.warning}</p>}
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
                    <button type="button" className="mochi-sticker-discard" aria-label={`Discard upload ${draft.file.name}`} disabled={busy} onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}>×</button>
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
                  setRenameDraft(null); setNotice('Sticker renamed.');
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
            {!stickers.list.length && !busy && !editing && <p className="mochi-media-empty-hint">Upload PNG, JPEG, GIF, or WebP images (up to 10 MB each), or import a JSON backup. Select a saved sticker to send it.</p>}
            {notice && <p className="mochi-media-empty-hint" role="status">{notice}</p>}
            <div className="mochi-sticker-grid">
              {stickers.list.map((sticker) => (
                <div className="mochi-sticker-cell" key={sticker.id}>
                  <button type="button" className="mochi-sticker-send" title={`Send ${sticker.name}`} disabled={busy || editing} onClick={() => onStickerSelect(sticker.name)}>
                    <img src={sticker.url} alt={sticker.name} loading="lazy" />
                    <span>{sticker.name}</span>
                  </button>
                  <button type="button" className="mochi-sticker-rename" aria-label={`Rename ${sticker.name}`} disabled={busy || editing} onClick={() => {
                    setImportError(null); setNotice(null);
                    setRenameDraft({ id: sticker.id, name: sticker.name, originalName: sticker.name });
                  }}>Rename</button>
                  <button type="button" className="mochi-sticker-delete" aria-label={`Remove ${sticker.name} from sticker library`} disabled={busy || editing} onClick={async () => {
                    setImportError(null); setNotice(null);
                    try { await deleteMochiSticker(sticker.id); }
                    catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker removal failed.'); }
                  }}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'stickers' && error && <p className="mochi-media-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
