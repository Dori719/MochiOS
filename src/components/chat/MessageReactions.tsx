// ──────────────────────────────────────────────
// Conversation message reactions — pill row.
//
// Renders the reaction chips for a message. Clicking a chip toggles the user's own
// reaction; hovering shows a tooltip naming who reacted. The add affordance lives in
// the hover toolbar (`ReactionAddButton`).
//
// This is the engine's component with two changes the port needs:
//
// 1. The engine styled the pill and its tooltip with Tailwind utilities bound to its
//    own chat-chrome variables (`--card`, `--border`, `--primary`, …) and rendered the
//    tooltip into `document.body` through a portal. SillyTavern neither defines those
//    variables nor has Tailwind, and a portalled node leaves the Mochi OS scope, so the
//    port styles both from `port-chrome.css` using the `.mari-message-reactions` hooks
//    that `mochi-os.css` already targets — the pill row itself needs no new classes.
// 2. The tooltip renders in place. It is `position: fixed`, so it still escapes the
//    phone's clipping and sits over the message list exactly as the portal did.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageReaction } from '@marinara-engine/shared';
import { USER_REACTOR, customEmojiReactionName } from '../../lib/reactions';
import { useTranslation as useUiTranslation } from 'react-i18next';

interface MessageReactionsProps {
  reactions: MessageReaction[];
  /** Resolve a reactor id ("user" or a character id) to a display name for tooltips. */
  resolveReactorName: (reactorId: string) => string;
  /** Toggle the user's membership in this reaction entry (identity: emoji + segment). */
  onToggle: (reaction: MessageReaction) => void;
  /** Remove character membership from this reaction entry. */
  onRemoveCharacter: (reaction: MessageReaction) => void;
}

export function MessageReactions({
  reactions,
  resolveReactorName,
  onToggle,
  onRemoveCharacter,
}: MessageReactionsProps) {
  if (reactions.length === 0) return null;
  return (
    <div className="mari-message-reactions">
      {reactions.map((reaction) => (
        <ReactionPill
          // A whole-message row can also hold orphaned segment entries, so the same
          // emoji may legitimately appear more than once — key by segment too.
          key={`${reaction.segment ?? 'm'}:${reaction.segmentSpeaker ?? ''}:${reaction.emoji}`}
          reaction={reaction}
          mine={reaction.by.includes(USER_REACTOR)}
          who={reaction.by.map(resolveReactorName).join(', ')}
          onToggle={() => onToggle(reaction)}
          onRemoveCharacter={() => onRemoveCharacter(reaction)}
        />
      ))}
    </div>
  );
}

function ReactionPill({
  reaction,
  mine,
  who,
  onToggle,
  onRemoveCharacter,
}: {
  reaction: MessageReaction;
  mine: boolean;
  who: string;
  onToggle: () => void;
  onRemoveCharacter: () => void;
}) {
  const { t: localizeUi } = useUiTranslation();
  const [show, setShow] = useState(false);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; ready: boolean }>({ top: 0, left: 0, ready: false });
  const name = customEmojiReactionName(reaction.emoji);
  const hasCharacterReaction = reaction.by.some((reactor) => reactor !== USER_REACTOR);
  const pointerTypeRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const onRemoveCharacterRef = useRef(onRemoveCharacter);

  useEffect(() => {
    onRemoveCharacterRef.current = onRemoveCharacter;
  }, [onRemoveCharacter]);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  // Position the tooltip centered above the chip, before paint (no flicker).
  useLayoutEffect(() => {
    if (!show || !wrapRef.current || !tipRef.current) {
      setPos((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const pad = 8;
    let top = rect.top - 6 - tip.height;
    let left = rect.left + rect.width / 2 - tip.width / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - pad - tip.width));
    top = Math.max(pad, Math.min(top, window.innerHeight - pad - tip.height));
    setPos({ top, left, ready: true });
  }, [show]);

  return (
    <>
      <button
        ref={wrapRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (hasCharacterReaction && (pointerTypeRef.current === 'mouse' || event.detail === 0)) {
            onRemoveCharacter();
          } else onToggle();
          pointerTypeRef.current = null;
        }}
        onPointerDown={(event) => {
          suppressClickRef.current = false;
          pointerTypeRef.current = event.pointerType;
          if (event.pointerType !== 'touch' || !hasCharacterReaction) return;
          clearLongPress();
          longPressTimerRef.current = window.setTimeout(() => {
            suppressClickRef.current = true;
            onRemoveCharacterRef.current();
          }, 500);
        }}
        onKeyDown={() => {
          suppressClickRef.current = false;
        }}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        aria-label={localizeUi('ui.chat.reactionpill.value1ReactedWithValue2', {
          value1: who,
          value2: name ? localizeUi('ui.chat.conversationinput.value1', { value1: name }) : reaction.emoji,
        })}
        aria-pressed={mine}
      >
        {reaction.imageUrl ? (
          <img src={reaction.imageUrl} alt={reaction.emoji} className="mochi-reaction-emoji-image" loading="lazy" />
        ) : (
          <span className="mochi-reaction-emoji">{reaction.emoji}</span>
        )}
        <span className="mochi-reaction-count">{reaction.by.length}</span>
      </button>
      {show && (
        <div
          ref={tipRef}
          className="mochi-reaction-tooltip"
          style={{ top: pos.top, left: pos.left, visibility: pos.ready ? 'visible' : 'hidden' }}
        >
          {reaction.imageUrl ? (
            <img src={reaction.imageUrl} alt="" className="mochi-reaction-tooltip-image" />
          ) : (
            <span className="mochi-reaction-tooltip-emoji">{reaction.emoji}</span>
          )}
          <span className="mochi-reaction-tooltip-text">
            {name ? (
              <>
                <span className="mochi-reaction-tooltip-name">:{name}:</span>{' '}
                {localizeUi('ui.chat.reactionpill.reactedBy')} {who}
              </>
            ) : (
              <>
                {localizeUi('ui.chat.reactionpill.reactedBy')} {who}
              </>
            )}
          </span>
        </div>
      )}
    </>
  );
}
