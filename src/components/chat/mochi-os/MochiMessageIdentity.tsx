import type { CSSProperties } from 'react';
import { getAvatarCropStyle } from '../../../lib/utils';

/** A compact avatar aligned to the top of the shared message frame by CSS. */
export function MochiMessageIdentity({ name, color, avatar, crop, embedded = false }: {
  name: string; color: string; avatar?: string | null; crop?: any; embedded?: boolean;
}) {
  return (
    <span className={embedded ? 'mochi-private-mini-avatar' : 'mini'} style={{ '--c': color, background: color, overflow: 'hidden', position: 'relative' } as CSSProperties} aria-label={name} title={name}>
      {avatar ? <img src={avatar} alt="" style={getAvatarCropStyle(crop)} /> : Array.from(name)[0]?.toUpperCase() || '?'}
    </span>
  );
}
