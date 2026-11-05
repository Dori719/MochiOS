import { DEFAULT_FORMAT_GUIDES, type MochiFormatGuideData } from '../components/chat/mochi-os/mochi-os.constants';
import type { MochiOsSettings } from '../shared/mochi-os.schema';

/** Resolve per app, rather than assuming every app has a drawing variant. */
export function resolveMochiFormatGuide(guides: MochiFormatGuideData, key: string, settings: MochiOsSettings) {
  const drawing = settings.formatGuideMode === 'drawing_tags' ? guides.formatGuideDrawing?.tags
    : settings.formatGuideMode === 'drawing_natural' ? guides.formatGuideDrawing?.natural : undefined;
  const content = drawing?.[key];
  const usesDrawing = typeof content === 'string' && content.trim().length > 0;
  return {
    content: usesDrawing ? content : guides.formatGuide?.[key] ?? DEFAULT_FORMAT_GUIDES.formatGuide[key] ?? '',
    usesDrawing,
    profileId: settings.connectionProfileId,
  };
}
