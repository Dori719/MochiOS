import { ctx } from './adapter';
import { imageDataUrl, stickerFileType, newStickerId } from './sticker-format';

export function imageLink(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Enter an HTTP or HTTPS image link.');
  return url.href;
}

export async function uploadAvatarImage(file: File): Promise<string> {
  const { mimeType, extension } = await stickerFileType(file);
  const data = await imageDataUrl(file, mimeType);
  const response = await fetch('/api/images/upload', {
    method: 'POST', credentials: 'same-origin', headers: ctx().getRequestHeaders(),
    body: JSON.stringify({ image: data.slice(data.indexOf(',') + 1), format: extension,
      filename: `avatar-${newStickerId()}.${extension}`, ch_name: 'mochi-os-avatars' }),
  });
  if (!response.ok) throw new Error(`Picture upload failed (${response.status}).`);
  const result = await response.json();
  const path = typeof result.path === 'string' ? result.path.replace(/^\//, '') : '';
  if (!/^(?:user\/)?images\/mochi-os-avatars\/[^/\\]+$/.test(path) || path.includes('..')) {
    throw new Error('The server returned an invalid image path.');
  }
  return `/${path}`;
}

/** Only delete files created by Mochi's avatar uploader, never remote or ST avatars. */
export async function deleteAvatarImage(value: unknown): Promise<void> {
  if (typeof value !== 'string') return;
  const path = value.replace(/^\//, '');
  if (!/^(?:user\/)?images\/mochi-os-avatars\/avatar-[\w-]+\.(png|jpg|jpeg|webp|gif)$/.test(path)) return;
  const response = await fetch('/api/images/delete', {
    method: 'POST', credentials: 'same-origin', headers: ctx().getRequestHeaders(),
    body: JSON.stringify({ path }),
  });
  if (!response.ok && response.status !== 404) throw new Error('The new picture was saved, but the previous avatar could not be deleted.');
}

export interface AvatarCrop { x: number; y: number; zoom: number }

export function avatarCropRect(width: number, height: number, crop: AvatarCrop) {
  const size = Math.min(width, height) / crop.zoom;
  return { x: (width - size) * crop.x, y: (height - size) * crop.y, size };
}

export async function cropAvatarImage(image: HTMLImageElement, crop: AvatarCrop): Promise<File> {
  const rect = avatarCropRect(image.naturalWidth, image.naturalHeight, crop);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not crop this picture. Please try again.');
  context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, 512, 512);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not crop this picture.')), 'image/png'));
  return new File([blob], 'avatar.png', { type: 'image/png' });
}
