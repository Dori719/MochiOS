/** Only Mochi's persisted native image files are rendered as generated photos. */
export function mochiGeneratedPhoto(item?: Record<string, any>): string | null {
  return typeof item?.image === 'string' && /^\/user\/images\/mochi-os-photos(?:-[^/\\]+)?\/[^/\\]+$/.test(item.image) && !item.image.includes('..') ? item.image : null;
}

export function mochiPhotoFolder(characterName: string): string {
  const name = characterName.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 100);
  return `mochi-os-photos-${name || 'Unknown character'}`;
}
