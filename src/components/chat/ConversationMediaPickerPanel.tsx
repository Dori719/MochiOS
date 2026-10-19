/**
 * The composer's media picker.
 *
 * The engine's panel hosted its own emoji, kaomoji, GIF, sticker and custom-emoji
 * pickers, each backed by an engine service. The port keeps the panel and its
 * tabs — Mochi OS decides which tabs to offer and what to do with a selection —
 * and supplies the parts that need no service: a built-in emoji grid and a
 * kaomoji grid. GIFs are pasted by URL, and the sticker tab reads the
 * conversation's sticker pack, which the port leaves empty.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type ConversationMediaPickerTabId = 'emoji' | 'kaomoji' | 'gifs' | 'stickers' | 'tools';
export type ConversationMediaPickerTab = { id: ConversationMediaPickerTabId; label: string };

interface ConversationMediaPickerPanelProps {
  tabs: ConversationMediaPickerTab[];
  activeTab: ConversationMediaPickerTabId;
  onActiveTabChange: (tab: ConversationMediaPickerTabId) => void;
  onClose: () => void;
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (gifUrl: string) => void;
  onStickerSelect: (name: string) => void;
  toolsContent?: ReactNode;
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
    emojis: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤟 💪 🦾 🖕 ✍️ 🫰 🫱 🫲 🫳 🫴'.split(
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

const KAOMOJI = [
  '(｡•́︿•̀｡)',
  '(๑•̀ㅂ•́)و✧',
  '(づ｡◕‿‿◕｡)づ',
  '(ノ◕ヮ◕)ノ*:･ﾟ✧',
  '(╯°□°）╯︵ ┻━┻',
  '┬─┬ノ( º _ ºノ)',
  '(っ˘̩╭╮˘̩)っ',
  '(๑´ω`๑)',
  'ヽ(•‿•)ノ',
  '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
  '(＠_＠;)',
  '(✿◠‿◠)',
  '(¬_¬)',
  '(¬‿¬)',
  '(⌐■_■)',
  '(°ロ°)',
  '(ー_ー゛)',
  '(*/ω＼*)',
  '(´;ω;`)',
  '(๑>ᴗ<๑)',
  'Σ(°△°|||)︴',
  '(ಥ_ಥ)',
  '(≧▽≦)',
  '(・∀・)',
  'ヽ(´ー`)ﾉ',
  '(o´▽`o)',
];

export function ConversationMediaPickerPanel({
  tabs,
  activeTab,
  onActiveTabChange,
  onClose,
  onEmojiSelect,
  onGifSelect,
  onStickerSelect,
  toolsContent,
  className,
}: ConversationMediaPickerPanelProps) {
  const [gifUrl, setGifUrl] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [onClose]);

  const submitGif = () => {
    const url = gifUrl.trim();
    if (!url) return;
    onGifSelect(url);
    setGifUrl('');
  };

  return (
    <div
      ref={rootRef}
      className={`mochi-media-picker-popover ${className ?? ''}`}
      data-conversation-media-picker
      data-chat-input-popup="media"
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

        {activeTab === 'kaomoji' && (
          <div className="mochi-kaomoji-grid">
            {KAOMOJI.map((kaomoji) => (
              <button key={kaomoji} type="button" onClick={() => onEmojiSelect(kaomoji)}>
                {kaomoji}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'gifs' && (
          <div className="mochi-gif-tab">
            <p>Paste an image or GIF address.</p>
            <div className="mochi-gif-row">
              <input
                type="text"
                value={gifUrl}
                placeholder="https://…"
                onChange={(event) => setGifUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitGif();
                }}
              />
              <button type="button" onClick={submitGif}>
                Add
              </button>
            </div>
          </div>
        )}

        {activeTab === 'stickers' && (
          <div className="mochi-media-empty">
            <p>No stickers in this chat.</p>
            <p className="mochi-media-empty-hint">
              SillyTavern stores stickers with its own sticker extension, not per conversation.
            </p>
            <button
              type="button"
              className="mochi-media-empty-action"
              onClick={() => {
                // Kept so the tab is not a dead end: a name typed here is inserted
                // as a `:name:` sticker token, which is what the archive stores.
                const name = window.prompt('Sticker name');
                if (name) onStickerSelect(name.trim());
              }}
            >
              Insert a sticker token
            </button>
          </div>
        )}

        {activeTab === 'tools' && <div className="mochi-media-tools">{toolsContent}</div>}
      </div>
    </div>
  );
}
