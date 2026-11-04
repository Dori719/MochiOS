import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Link, Upload, X } from 'lucide-react';
import { imageLink, uploadAvatarImage, cropAvatarImage, type AvatarCrop } from '../../../st/avatar-images';

export function AvatarEditor({ title, onSave, onClose }: {
  title: string; onSave: (url: string) => Promise<void>; onClose: () => void;
}) {
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState<'upload' | 'link'>('upload');
  const [preview, setPreview] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [crop, setCrop] = useState<AvatarCrop>({ x: .5, y: .5, zoom: 1 });
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; crop: AvatarCrop } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    let keyboard = previous?.matches(':focus-visible') ?? false;
    const onPointer = () => { keyboard = false; };
    const onKey = () => { keyboard = true; };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    formRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      if (keyboard) previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    setPreviewFailed(false);
    setDimensions({ width: 0, height: 0 });
    setCrop({ x: .5, y: .5, zoom: 1 });
    if (file) {
      const url = URL.createObjectURL(file); setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    try { setPreview(link.trim() ? imageLink(link) : ''); }
    catch { setPreview(''); }
  }, [file, link]);
  const size = Math.min(dimensions.width, dimensions.height) / crop.zoom;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return <div className="overlay show" onClick={() => { if (!busy) onClose(); }}>
    <form ref={formRef} tabIndex={-1} className="modal mochi-avatar-editor" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={busy}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key === 'Tab') {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden])'));
          const first = controls[0], last = controls.at(-1);
          if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} onSubmit={async (event) => {
        if (busy) { event.preventDefault(); return; }
        event.preventDefault(); formRef.current?.focus(); setBusy(true); setError('');
        try {
          if (!imageRef.current || !dimensions.width || previewFailed) throw new Error('Choose an image that loads before saving.');
          await onSave(await uploadAvatarImage(await cropAvatarImage(imageRef.current, crop))); onClose();
        }
        catch (error) { setError(error instanceof Error ? error.message : 'Could not save picture.'); }
        finally { setBusy(false); }
      }}>
      <div className="avatar-editor-head"><h3 id={`${id}-title`}>Edit picture</h3>
        <button type="button" className="avatar-editor-close" aria-label="Close picture editor" disabled={busy} onClick={onClose}><X size={20} /></button></div>
      <div className="avatar-editor-body">
        <div className="avatar-editor-preview">
          <div className={`avatar-editor-image${dimensions.width ? ' has-image' : ''}`}
            onPointerDown={(event) => {
              if (busy || !dimensions.width) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, y: event.clientY, crop };
            }} onPointerMove={(event) => {
              if (!drag.current) return;
              const scale = event.currentTarget.clientWidth / size;
              const start = drag.current;
              setCrop({ ...start.crop,
                x: dimensions.width > size ? clamp(start.crop.x - (event.clientX - start.x) / scale / (dimensions.width - size)) : .5,
                y: dimensions.height > size ? clamp(start.crop.y - (event.clientY - start.y) / scale / (dimensions.height - size)) : .5 });
            }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
            {preview && !previewFailed ? <img key={preview} ref={imageRef} crossOrigin={file ? undefined : 'anonymous'} src={preview} draggable={false}
              alt={`Crop preview for ${title}`} style={dimensions.width ? { width: `${dimensions.width / size * 100}%`, height: `${dimensions.height / size * 100}%`, maxWidth: 'none', left: `${-(dimensions.width / size - 1) * crop.x * 100}%`, top: `${-(dimensions.height / size - 1) * crop.y * 100}%` } : undefined}
              onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => { setPreviewFailed(true); setDimensions({ width: 0, height: 0 }); }} /> : <ImagePlus size={32} aria-hidden="true" />}
          </div>
          <strong>{title}</strong>
          <p>{previewFailed ? 'This image could not be loaded for cropping. Download it and choose Upload, or try another link.' : dimensions.width ? 'Drag to position, or use the controls below.' : preview ? 'Loading picture…' : 'Choose a picture to preview it here.'}</p>
        </div>
        {!!dimensions.width && <div className="avatar-editor-crop-controls">
          <label>Zoom<input type="range" min={1} max={4} step="0.01" value={crop.zoom} disabled={busy} onChange={(event) => setCrop({ ...crop, zoom: Number(event.target.value) })} /></label>
          <button type="button" disabled={busy} onClick={() => setCrop({ x: .5, y: .5, zoom: 1 })}>Reset crop</button>
        </div>}
        <div className="avatar-editor-sources" aria-label="Picture source">
          {(['upload', 'link'] as const).map((value) => <button key={value} type="button" aria-pressed={source === value} disabled={busy} onClick={() => { if (source === value) return; if (fileRef.current) fileRef.current.value = ''; setSource(value); setFile(null); setLink(''); setError(''); }}>
            {value === 'upload' ? <Upload size={16} /> : <Link size={16} />}{value === 'upload' ? 'Upload' : 'Image link'}
          </button>)}
        </div>
        {source === 'upload' ? <div className="avatar-editor-upload">
          <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); }} />
          <button type="button" className="avatar-editor-choose" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={18} />{file ? 'Choose another picture' : 'Choose picture'}</button>
          <p>{file ? file.name : 'PNG, JPEG, GIF or WebP'}</p>
        </div> : <label className="avatar-editor-link">Image URL<input type="url" placeholder="https://example.com/picture.png" value={link} disabled={busy} onChange={(event) => { setLink(event.target.value); setError(''); }} /><span>Use a direct link to an image.</span></label>}
        {error && <p className="avatar-editor-error" role="alert">{error}</p>}
      </div>
      <div className="avatar-editor-footer">
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="avatar-editor-save" type="submit" disabled={busy || !dimensions.width || previewFailed}>{busy ? 'Saving…' : 'Save picture'}</button>
      </div>
    </form>
  </div>;
}
