/**
 * The composer's media picker.
 *
 * Only emoji and Mochi's global sticker library belong in this popover.
 */
import { useEffect, useRef, useState } from 'react';
import { useConversationCustomStickers } from '../../hooks/use-conversation-custom-stickers';
import { deleteMochiSticker, importMochiStickers } from '../../st/stickers';

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
  const stickers = useConversationCustomStickers();
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
              <button type="button" className="mochi-media-empty-action" disabled={stickers.loading} onClick={() => fileRef.current?.click()}>
                {stickers.loading ? 'Loading…' : 'Import stickers'}
              </button>
            </div>
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
                setImportError(null);
                try { await importMochiStickers(files); }
                catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker import failed.'); }
              }}
            />
            {!stickers.list.length && !stickers.loading && <p className="mochi-media-empty-hint">Import PNG, JPEG, GIF, or WebP images (up to 10 MB each). Select a saved sticker to send it.</p>}
            <div className="mochi-sticker-grid">
              {stickers.list.map((sticker) => (
                <div className="mochi-sticker-cell" key={sticker.id}>
                  <button type="button" className="mochi-sticker-send" title={`Send ${sticker.name}`} onClick={() => onStickerSelect(sticker.name)}>
                    <img src={sticker.url} alt={sticker.name} loading="lazy" />
                    <span>{sticker.name}</span>
                  </button>
                  <button type="button" className="mochi-sticker-delete" aria-label={`Remove ${sticker.name} from sticker library`} disabled={stickers.loading} onClick={async () => {
                    setImportError(null);
                    try { await deleteMochiSticker(sticker.id); }
                    catch (error) { setImportError(error instanceof Error ? error.message : 'Sticker removal failed.'); }
                  }}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {(importError || stickers.error) && <p className="mochi-media-error" role="alert">{importError || stickers.error}</p>}
      </div>
    </div>
  );
}
