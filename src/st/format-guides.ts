import { DEFAULT_FORMAT_GUIDES, type MochiFormatGuideData } from '../components/chat/mochi-os/mochi-os.constants';
import type { MochiOsSettings } from '../shared/mochi-os.schema';
import { PRIVATE_READ_RECEIPT_RULES } from '../components/chat/mochi-os/private-chat-guide';

/** Resolve per app, rather than assuming every app has a drawing variant. */
export function resolveMochiFormatGuide(guides: MochiFormatGuideData, key: string, settings: MochiOsSettings) {
  const drawing = settings.formatGuideMode === 'drawing_tags' ? guides.formatGuideDrawing?.tags
    : settings.formatGuideMode === 'drawing_natural' ? guides.formatGuideDrawing?.natural : undefined;
  const content = drawing?.[key];
  const usesDrawing = typeof content === 'string' && content.trim().length > 0;
  const selected = usesDrawing ? content : guides.formatGuide?.[key] ?? DEFAULT_FORMAT_GUIDES.formatGuide[key] ?? '';
  return {
    content: (key === 'privateChat' || key === 'groupChat') && !selected.includes('Always generate userRead: false')
      ? selected + (key === 'groupChat' ? PRIVATE_READ_RECEIPT_RULES.replace('Private-chat', 'Group-chat') : PRIVATE_READ_RECEIPT_RULES) : selected,
    usesDrawing,
    profileId: settings.connectionProfileId,
  };
}
