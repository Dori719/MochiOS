/** The historical hook name remains, but the library belongs to Mochi, not a chat. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getStickerSnapshot, loadMochiStickers, subscribeStickers, type MochiSticker } from '../st/stickers';

export type ConversationSticker = MochiSticker;

export function useConversationCustomStickers() {
  const snapshot = useSyncExternalStore(subscribeStickers, getStickerSnapshot, getStickerSnapshot);
  useEffect(() => { void loadMochiStickers().catch(() => {}); }, []);
  const map = useMemo(() => new Map(snapshot.list.map((sticker) => [sticker.name, sticker.url])), [snapshot.list]);
  return useMemo(() => ({ ...snapshot, map }), [snapshot, map]);
}
