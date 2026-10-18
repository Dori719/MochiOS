/**
 * The phone.
 *
 * Owns the shell the ported widgets render inside: the status bar, the
 * homescreen, the dock and whichever app window is open. The engine's own
 * `MochiOsView` was the same shell, but wired to the engine's stores, query
 * cache and floating-window system; those three layers are what this replaces.
 */
import { useCallback, useMemo, useState } from 'react';
import { MOCHI_HOME_APPS, normalizeHomescreenAppOrder } from '../mochi/apps';
import { useMochiThemeMode } from '../mochi/use-theme-mode';
import { useMochiOsSettings } from '../core/settings';
import { setState, useStore, type MochiTarget } from '../core/store';
import { getUserName, getActiveCharacter, hasChat } from '../st/adapter';
import { translate } from '../compat/i18n';
import { fmtTime } from '../mochi/utils';
import { HomeScreen } from './Home';
import { MessagesApp } from './MessagesApp';
import { PhoneDataApp } from './PhoneDataApp';
import { SettingsSheet } from './SettingsSheet';
import { ThreadApp } from './ThreadApp';
import { UnavailableApp } from './UnavailableApp';

/** Apps the extension cannot run without the engine's backend. */
const BACKEND_APPS = new Set(['maps', 'live', 'music', 'feed', 'forum', 'camera', 'tools', 'files', 'journal']);

/** Open an app (or return home with `null`). Also used by the slash command. */
export function openApp(target: MochiTarget | null): void {
  setState({ activeApp: target });
}

export function Phone() {
  const { data: settings } = useMochiOsSettings();
  const themeMode = useMochiThemeMode(settings.theme);
  const openThreadId = useStore((state) => state.openThreadId);
  const activeApp = useStore((state) => state.activeApp);
  const busy = useStore((state) => state.busy);
  const notice = useStore((state) => state.notice);

  const homeOrder = useHomeOrder();
  const userName = useMemo(() => getUserName(), []);
  const character = useMemo(() => getActiveCharacter(), []);

  const apps = useMemo(() => {
    const byId = new Map(MOCHI_HOME_APPS.map((app) => [app.id, app]));
    return homeOrder
      .map((id) => byId.get(id))
      .filter((app): app is (typeof MOCHI_HOME_APPS)[number] => Boolean(app));
  }, [homeOrder]);

  const closeApp = useCallback(() => openApp(null), []);

  if (!hasChat()) {
    return (
      <div className={`mochi-scope theme-${themeMode}`}>
        <div className="screen">
          <div className="mochi-os-extension-empty">
            <strong>{translate('mochi.st.noChat')}</strong>
            {translate('mochi.st.noChatHint')}
          </div>
        </div>
      </div>
    );
  }

  const active: MochiTarget | null = openThreadId ? { id: 'thread', threadId: openThreadId } : activeApp;

  return (
    <div
      className={`mochi-scope theme-${themeMode}${settings.colorPreset ? ` color-${settings.colorPreset}` : ""}`}
    >
      <div className="screen">
        <div className="status">
          <span>{fmtTime(new Date(), settings.timeFormat === '12h')}</span>
          <span className="right">
            <span aria-hidden="true">{settings.wxCondition || '☀'}</span>
            <span>
              {Math.round(settings.wxTemp)}°{settings.tempUnit}
            </span>
          </span>
        </div>

        {active?.id === 'thread' ? (
          <ThreadApp threadId={active.threadId!} onBack={closeApp} userName={userName} />
        ) : active?.id === 'messages' ? (
          <MessagesApp onBack={closeApp} onOpenThread={() => openApp(null)} userName={userName} />
        ) : active?.id === 'persona' ? (
          <PhoneDataApp onBack={closeApp} />
        ) : active?.id === 'settings' ? (
          <SettingsSheet onBack={closeApp} />
        ) : active && BACKEND_APPS.has(active.id) ? (
          <UnavailableApp appId={active.id} onBack={closeApp} />
        ) : (
          <HomeScreen apps={apps} onOpen={openApp} characterName={character?.name ?? ''} />
        )}

        {(busy || notice) && (
          <div className={`mochi-os-extension-status${notice?.kind === 'error' ? ' is-error' : ''}`}>
            {busy ?? notice?.text ?? ''}
          </div>
        )}

        <div className="dock">
          <DockButton label={translate('ui.chat.mochiosview.backToHome')} onClick={closeApp}>
            <path d="M3 12l9-9 9 9" />
            <path d="M5 10v10h14V10" />
          </DockButton>
          <DockButton
            label={translate('ui.chat.mochiosview.openMessenger')}
            onClick={() => openApp({ id: 'messages' })}
          >
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
          </DockButton>
          <DockButton label={translate('ui.chat.mochiosview.profile')} onClick={() => openApp({ id: 'persona' })}>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
          </DockButton>
          <DockButton label={translate('mochi.st.settings')} onClick={() => openApp({ id: 'settings' })}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
          </DockButton>
        </div>
      </div>
    </div>
  );
}

/**
 * The stored order is only a permutation hint; `normalizeHomescreenAppOrder`
 * filters it to known ids and tops up anything missing, so a stale value can
 * never hide an app or render a tile with no handler.
 */
function useHomeOrder(): string[] {
  const [order] = useState<string[]>(() => normalizeHomescreenAppOrder(readHomeOrder()));
  return order;
}

function readHomeOrder(): unknown {
  try {
    const raw = window.localStorage.getItem('mochi_os_home_order');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function DockButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="icon-btn" title={label} aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}