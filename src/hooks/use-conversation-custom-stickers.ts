/** The historical hook name remains, but the library belongs to Mochi, not a chat. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getStickerSnapshot, loadMochiStickers, subscribeStickers, type MochiSticker } from '../st/stickers';

export type ConversationSticker = MochiSticker;

export function useConversationCustomStickers() {
  const snapshot = useSyncExternalStore(subscribeStickers, getStickerSnapshot, getStickerSnapshot);
  useEffect(() => { void loadMochiStickers().catch(() => {}); }, []);
  const map = useMemo(() => new Map(snapshot.list.flatMap((sticker) =>
    [sticker.name, ...sticker.aliases ?? []].map((name) => [name, sticker.url] as const))), [snapshot.list]);
  return useMemo(() => ({ ...snapshot, map }), [snapshot, map]);
}
