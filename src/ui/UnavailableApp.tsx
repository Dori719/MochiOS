/**
 * Placeholder for the apps that were backed by the engine's server.
 *
 * Maps, live streams, music, the social feed, the forum, camera, journals and the
 * file browser all read from Mochi OS routes, agents or sidecars that a
 * SillyTavern extension cannot run. They stay on the homescreen as visible, named
 * tiles that say why they are empty rather than silently disappearing, so the
 * ported layout still matches and the gap is legible instead of mysterious.
 */
import { translate } from '../compat/i18n';

export function UnavailableApp({ appId, onBack }: { appId: string; onBack: () => void }) {
  return (
    <div className="mochi-os-extension-scroll">
      <div className="mochi-os-extension-empty">
        <strong>{translate(`ui.chat.mochiosview.${appId === 'maps' ? 'maps' : appId}`)}</strong>
        {translate('mochi.st.availableSoon')}
      </div>
      <div className="mochi-os-extension-note">{translate('mochi.st.availableSoonHint')}</div>
      <div className="mochi-os-extension-actions">
        <button type="button" className="mochi-os-extension-btn" onClick={onBack}>
          {translate('ui.chat.mochiosview.backToHome')}
        </button>
      </div>
    </div>
  );
}