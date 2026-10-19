/**
 * Custom stickers for the open conversation.
 *
 * The engine let a chat carry its own sticker pack. SillyTavern has no per-chat
 * sticker set, so the pack is empty: sticker messages still render as text, and
 * the picker simply offers none. The shape is kept so the widgets and the picker
 * need no changes if a pack is ever wired up.
 */
import { useMemo } from 'react';

export interface ConversationSticker {
  id?: string;
  name: string;
  url?: string;
}

const EMPTY_LIST: ConversationSticker[] = [];

export function useConversationCustomStickers(): {
  list: ConversationSticker[];
  map: Map<string, string>;
} {
  const map = useMemo(() => new Map<string, string>(), []);
  return useMemo(() => ({ list: EMPTY_LIST, map }), [map]);
}
