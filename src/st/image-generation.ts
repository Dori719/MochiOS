import { activeChatId, ctx } from './adapter';
import { getMochiTokenLimits } from './context-budget';
import type { MochiOsSettings } from '../shared/mochi-os.schema';
import { mochiPhotoFolder } from './generated-photo';
import { DEFAULT_MOCHI_OS_SETTINGS } from '../shared/mochi-os.schema';

/** Only image-bearing response fields are accepted; arbitrary prose is not a URL. */
export function extractMochiImage(response: any): string | null {
  const safe = (value: unknown): string | null => typeof value === 'string'
    && /^(?:https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(value) ? value : null;
  const message = response?.choices?.[0]?.message;
  for (const part of response?.candidates?.[0]?.content?.parts || []) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) return safe(`data:${inline.mimeType ?? inline.mime_type};base64,${inline.data}`);
  }
  for (const part of [...(message?.images || []), ...(Array.isArray(message?.content) ? message.content : [])]) {
    const image = safe(part?.image_url?.url ?? part?.image_url ?? (part?.type === 'image' ? part.url : null));
    if (image) return image;
    if (part?.inlineData?.data) return safe(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
  }
  const data = response?.data?.[0];
  if (data?.b64_json) return `data:image/png;base64,${data.b64_json}`;
  if (safe(data?.url)) return data.url;
  const text = typeof message?.content === 'string' ? message.content : '';
  return safe(text.trim()) || safe(/!\[[^\]]*\]\(([^\s)]+)\)/.exec(text)?.[1]);
}

export function mochiPhotoPrompt(item: Record<string, any>): string | null {
  if (String(item.t ?? item.type).toLowerCase() !== 'imgdesc') return null;
  const description = String(item.c ?? item.content ?? '').trim();
  if (!description) return null;
  // Explicit allowlist: no sender, dialogue, history, or other reply fields.
  return [description, item.prompt ? JSON.stringify(item.prompt) : ''].filter(Boolean).join('\n\n');
}

/** Complete every image before the caller archives or displays any of the turn. */
export async function renderMochiPhotos(
  messages: Array<Record<string, any>>, settings: MochiOsSettings, chatId: string, signal?: AbortSignal, characterName?: string,
): Promise<void> {
  if (settings.formatGuideMode === 'general') return;
  const assertCurrent = () => {
    if (signal?.aborted) throw new DOMException('Image generation cancelled', 'AbortError');
    if (activeChatId() !== chatId) throw new Error('Mochi OS: the selected SillyTavern chat changed');
  };
  for (const message of messages) {
    if (message.me === 1) continue;
    const originalPrompt = mochiPhotoPrompt(message.rawItem || {});
    if (!originalPrompt) continue;
    const config = settings.imageApi ?? DEFAULT_MOCHI_OS_SETTINGS.imageApi;
    const prompt = [config.prefix.trim(), originalPrompt, config.suffix.trim()].filter(Boolean).join('\n\n');
    const imageConfig: Record<string, string> = {};
    if (config.aspectRatio !== 'auto') imageConfig.aspectRatio = config.aspectRatio;
    if (config.format !== 'openai' && config.resolution !== 'auto') imageConfig.imageSize = config.resolution;
    assertCurrent();
    const context = ctx();
    const profileId = settings.imageConnectionProfileId || context.extensionSettings.connectionManager?.selectedProfile;
    if (!profileId) throw new Error('Select an Image API connection profile before generating photos.');
    const service = context.ConnectionManagerRequestService;
    const profile = service?.getProfile(profileId);
    const api = context.CONNECT_API_MAP?.[profile?.api]?.selected || profile?.api;
    if (api !== 'openai') throw new Error('Image API requires a chat-completion connection profile.');
    const response = await service.sendRequest(profileId, [{ role: 'user', content: [prompt, Object.keys(imageConfig).length ? `Image output preferences: ${JSON.stringify(imageConfig)}` : ''].filter(Boolean).join('\n\n') }],
      getMochiTokenLimits(undefined, profileId).responseLength,
      { stream: false, extractData: false, includePreset: true, signal });
    assertCurrent();
    const image = extractMochiImage(response);
    if (!image) throw new Error('Image API returned no image. Use an image-generating chat-completion model.');
    // Save returned bytes through ST's native image storage so history survives reloads.
    const downloaded = await fetch(image, { signal });
    if (!downloaded.ok) throw new Error('Could not download the generated photo.');
    const blob = await downloaded.blob();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('Image API returned an unsupported image format.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the generated photo.'));
      reader.readAsDataURL(blob);
    });
    assertCurrent();
    const format = blob.type.split('/')[1];
    const sender = String(message.sender || characterName || '').trim();
    const character = context.characters.find((entry) => String(entry.name ?? entry.data?.name ?? '').toLowerCase() === sender.toLowerCase())
      ?? (!context.groupId && context.characterId !== undefined ? context.characters[Number(context.characterId)] : undefined);
    const folder = mochiPhotoFolder(character?.name || character?.data?.name || sender || context.name2 || 'Unknown character');
    const saved = await fetch('/api/images/upload', {
      method: 'POST', headers: context.getRequestHeaders(), signal,
      body: JSON.stringify({ image: dataUrl.split(',')[1], format, filename: `${crypto.randomUUID()}.${format}`, ch_name: folder }),
    });
    if (!saved.ok) throw new Error('Could not save the generated photo.');
    const result = await saved.json();
    if (typeof result.path !== 'string' || !result.path.replace(/^\//, '').startsWith(`user/images/${folder}/`)) throw new Error('Unexpected generated photo storage path.');
    assertCurrent();
    message.rawItem = { ...message.rawItem, image: `/${result.path.replace(/^\//, '')}` };
  }
}
