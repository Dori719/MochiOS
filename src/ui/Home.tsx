/**
 * Homescreen: the app grid plus the widgets the engine pinned above it.
 */
import type { ReactNode } from 'react';
import { MOCHI_HOME_APPS } from '../mochi/apps';
import { getMochiHomeApp } from '../mochi/app-icons';
import { useMochiOsSettings } from '../core/settings';
import { useStore } from '../core/store';
import { translate } from '../compat/i18n';
import { fmtTime, wxLabel } from '../mochi/utils';

export function HomeScreen({
  apps,
  onOpen,
  characterName,
}: {
  apps: Array<(typeof MOCHI_HOME_APPS)[number]>;
  onOpen: (app: { id: string }) => void;
  characterName: string;
}) {
  const { data: settings } = useMochiOsSettings();
  const phoneData = useStore((state) => state.phoneData);

  return (
    <>
      <div className="widgets">
        <div className="widget">
          <div className="lbl">{translate('ui.chat.mochiosview.os20')}</div>
          <div className="big">{fmtTime(new Date(), settings.timeFormat === '12h')}</div>
          <div className="dim">
            {characterName ? `${translate('ui.chat.mochiosview.universe')}: ${characterName}` : ''}
          </div>
        </div>
        <div className="widget">
          <div className="lbl">{translate('ui.chat.mochiosview.weatherSettings')}</div>
          <div className="big">
            {Math.round(settings.wxTemp)}°{settings.tempUnit}
          </div>
          <div className="dim">
            {settings.wxPlace ? `${settings.wxPlace} · ` : ''}
            {wxLabel(Number(settings.wxTemp) || 0)}
          </div>
        </div>
      </div>

      <div className="apps">
        {apps.map((app) => {
          // The registry entry carries the tile glyph; rendering the entry itself
          // would put a plain object where a React node belongs.
          const registered = getMochiHomeApp(app.id);
          return (
            <button key={app.id} type="button" className="app" onClick={() => onOpen({ id: app.id })}>
              <span className="tile">{registered?.icon as ReactNode}</span>
              <span className="label">{translate(app.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {!phoneData && (
        <div className="mochi-os-extension-status">
          {translate('mochi.st.noData')} · {translate('mochi.st.noDataHint')}
        </div>
      )}
    </>
  );
}