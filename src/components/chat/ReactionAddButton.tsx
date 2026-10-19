/**
 * The add-reaction button on a Mochi OS message.
 *
 * The engine's button opened its full emoji picker (standard emojis plus a grid
 * of the user's custom emojis, loaded over HTTP). SillyTavern has no custom
 * emoji registry for the port to read, so this offers a compact quick-reaction
 * row — which is how reactions are actually used on a phone — styled with the
 * ported `.mochi-reaction-btn` and `.mochi-*` tokens.
 */
import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { useTranslation as useUiTranslation } from 'react-i18next';

interface ReactionAddButtonProps {
  /** Called with the chosen emoji token (unicode or `:name:`) and its image url. */
  onPick: (emoji: string, imageUrl: string | null) => void;
  className?: string;
  /** Matches the action bar's tab discipline (-1 while the bar is hidden). */
  tabIndex?: number;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];

export function ReactionAddButton({ onPick, className, tabIndex }: ReactionAddButtonProps) {
  const { t: localizeUi } = useUiTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The row renders once per message, so a closed picker must cost nothing and
  // an open one has to close on any press outside it.
  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  return (
    <div className="mochi-reaction-add" ref={wrapRef}>
      <button
        type="button"
        className={className ?? 'mochi-reaction-btn'}
        tabIndex={tabIndex}
        title={localizeUi('ui.chat.reactionaddbutton.addReaction', 'Add reaction')}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <SmilePlus size={13} />
      </button>
      {open && (
        <div className="mochi-reaction-add-popover" onPointerDown={(event) => event.stopPropagation()}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPick(emoji, null);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
