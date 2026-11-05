import { useEffect, useRef, useState } from 'react';
import { Info, Maximize2, RefreshCw, X } from 'lucide-react';
import './mochi-photo.css';

export function MochiPhoto({ src, item }: { src: string; item: Record<string, any> }) {
  const [image, setImage] = useState(src);
  const [selected, setSelected] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const description = String(item.c ?? item.content ?? 'Generated photo');
  useEffect(() => { setImage(src); }, [src]);
  useEffect(() => () => request.current?.abort(), []);

  async function refresh() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const { activeChatId, replaceGeneratedPhoto } = await import('../../../st/adapter');
      const { renderMochiPhotos } = await import('../../../st/image-generation');
      const { readMochiSettings } = await import('../../../st/mochi-settings');
      const { mochiQueryClient } = await import('../../../st/query-client');
      const chatId = activeChatId();
      if (!chatId) throw new Error('Open a chat before refreshing an image.');
      const message = { me: 0, rawItem: { ...item, image } };
      // Reuse the saved prompt even if new-message image generation is now off.
      await renderMochiPhotos([message], { ...readMochiSettings(), formatGuideMode: 'drawing_natural' }, chatId, controller.signal);
      if (message.rawItem.image === image) throw new Error('This image has no generation prompt.');
      await replaceGeneratedPhoto(chatId, image, message.rawItem.image);
      setImage(message.rawItem.image);
      void mochiQueryClient().invalidateQueries();
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not refresh the image. Try again.');
    } finally {
      request.current = null;
      setBusy(false);
    }
  }

  return <div className="mochi-photo" onClick={(event) => event.stopPropagation()}>
    <div className="mochi-photo-frame" aria-busy={busy}>
      <button type="button" className="mochi-photo-image" aria-label="Show image controls" aria-expanded={selected} onClick={() => setSelected(!selected)}>
        <img src={image} alt={description} />
      </button>
      {selected && <>
        <button type="button" className="mochi-photo-control mochi-photo-expand" aria-label="Enlarge image" title="Enlarge image" onClick={() => dialog.current?.showModal()}><Maximize2 size={18} /></button>
        <button type="button" className="mochi-photo-control mochi-photo-info" aria-label="Image description" title="Image description" aria-expanded={descriptionOpen} onClick={() => setDescriptionOpen(!descriptionOpen)}><Info size={18} /></button>
        <button type="button" className="mochi-photo-control mochi-photo-refresh" aria-label="Regenerate image" title="Regenerate image" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} /></button>
      </>}
      {busy && <div className="mochi-photo-loading" role="status"><RefreshCw size={24} /><span>Generating image…</span></div>}
    </div>
    {descriptionOpen && <p className="mochi-photo-description">{description}</p>}
    {error && <p className="mochi-photo-description" role="alert">{error}</p>}
    <dialog ref={dialog} className="mochi-photo-viewer" aria-label="Enlarged image" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <img src={image} alt={description} />
      <button type="button" className="mochi-photo-control mochi-photo-info" aria-label="Close enlarged image" onClick={() => dialog.current?.close()}><X size={20} /></button>
    </dialog>
  </div>;
}
