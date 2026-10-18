/**
 * Settings.
 *
 * The engine had a full settings and preset editor. This keeps the settings that
 * change what the phone looks and behaves like, plus raw access to the prompt
 * preset and format guides as JSON, which is where real tuning happens.
 */
import { useCallback, useState } from 'react';
import { useMochiOsSettings, persistSettings } from '../core/settings';
import { MOCHI_CURRENCY_CHOICES } from '../mochi/utils';
import { DEFAULT_FORMAT_GUIDES, DEFAULT_MOCHI_PRESET_JSON, TIMEZONES } from '../mochi/constants';
import type { MochiColorPreset, MochiCurrency, MochiPresetMode, MochiTempUnit, MochiTheme } from '../mochi/schema';
import { translate } from '../compat/i18n';

type Tab = 'appearance' | 'phone' | 'prompt';

export function SettingsSheet({ onBack }: { onBack: () => void }) {
  const { data: settings } = useMochiOsSettings();
  const [tab, setTab] = useState<Tab>('appearance');
  const [presetJson, setPresetJson] = useState<string | null>(null);
  const [guidesJson, setGuidesJson] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const saveJson = useCallback(
    (which: 'preset' | 'guides', text: string) => {
      try {
        JSON.parse(text);
      } catch (error: any) {
        setEditorError(`${translate('ui.chat.mochiosview.invalidYaml')} ${error?.message ?? ''}`);
        return;
      }
      setEditorError(null);
      if (which === 'preset') {
        persistSettings({ promptPresetMode: 'custom', customPresetJson: text });
        setPresetJson(null);
      } else {
        persistSettings({ formatGuidesJson: text });
        setGuidesJson(null);
      }
    },
    [],
  );

  return (
    <>
      <div className="mtabs">
        <button type="button" className={`mtab${tab === 'appearance' ? ' active' : ''}`} onClick={() => setTab('appearance')}>
          {translate('ui.chat.mochiosview.theme')}
        </button>
        <button type="button" className={`mtab${tab === 'phone' ? ' active' : ''}`} onClick={() => setTab('phone')}>
          {translate('ui.chat.mochiosview.phone')}
        </button>
        <button type="button" className={`mtab${tab === 'prompt' ? ' active' : ''}`} onClick={() => setTab('prompt')}>
          {translate('ui.chat.mochiosview.aiPreset')}
        </button>
      </div>

      <div className="mochi-os-extension-scroll">
        {tab === 'appearance' && (
          <>
            <Select
              label={translate('ui.chat.mochiosview.theme')}
              value={settings.theme}
              onChange={(value) => persistSettings({ theme: value as MochiTheme })}
              options={[
                ['auto', translate('ui.chat.mochiosview.auto')],
                ['light', translate('ui.chat.mochiosview.light')],
                ['dark', translate('ui.chat.mochiosview.dark')],
              ]}
            />
            <Select
              label={translate('ui.chat.mochiosview.colorPreview')}
              value={settings.colorPreset}
              onChange={(value) => persistSettings({ colorPreset: value as MochiColorPreset })}
              options={[
                ['', translate('ui.chat.mochiosview.colorDefault')],
                ['ocean', translate('ui.chat.mochiosview.colorOcean')],
                ['plum', translate('ui.chat.mochiosview.colorPlum')],
                ['peach', translate('ui.chat.mochiosview.colorPeach')],
                ['custom', translate('ui.chat.mochiosview.custom')],
              ]}
            />
            {settings.colorPreset === 'custom' && (
              <div className="mochi-os-extension-field">
                <span>{translate('ui.chat.mochiosview.customColor')}</span>
                <input
                  type="color"
                  value={`rgb(${settings.customRgb.r}, ${settings.customRgb.g}, ${settings.customRgb.b})`}
                  onChange={(event) => {
                    const [r, g, b] = [1, 3, 5].map((offset) => Number(event.target.value.slice(offset, offset + 2)));
                    persistSettings({ customRgb: { r, g, b } });
                  }}
                />
              </div>
            )}
            <div className="mochi-os-extension-note">{translate('ui.chat.mochiosview.aPlayfulDesktopEnvironmentWithThemesLiveClockCustomizable')}</div>
          </>
        )}

        {tab === 'phone' && (
          <>
            <Select
              label={translate('ui.chat.mochiosview.timeFormat')}
              value={settings.timeFormat}
              onChange={(value) => persistSettings({ timeFormat: value as '12h' | '24h' })}
              options={[
                ['24h', translate('ui.chat.mochiosview.text24Hour')],
                ['12h', translate('ui.chat.mochiosview.text12Hour')],
              ]}
            />
            <Select
              label={translate('ui.chat.mochiosview.temperatureC')}
              value={settings.tempUnit}
              onChange={(value) => persistSettings({ tempUnit: value as MochiTempUnit })}
              options={[
                ['C', translate('ui.chat.mochiosview.celsiusC')],
                ['F', translate('ui.chat.mochiosview.fahrenheitF')],
              ]}
            />
            <Select
              label={translate('ui.chat.mochiosview.currency')}
              value={settings.currency}
              onChange={(value) => persistSettings({ currency: value as MochiCurrency })}
              options={MOCHI_CURRENCY_CHOICES.map((choice) => [choice, choice])}
            />
            <Select
              label={translate('ui.chat.mochiosview.timezone')}
              value={settings.clockTz}
              onChange={(value) => persistSettings({ clockTz: value })}
              options={TIMEZONES.map((zone: string) => [zone, zone] as [string, string])}
            />
            <div className="mochi-os-extension-field">
              <span>{translate('ui.chat.mochiosview.temperatureC')}</span>
              <input
                type="number"
                value={settings.wxTemp}
                onChange={(event) => persistSettings({ wxTemp: Number(event.target.value) })}
              />
            </div>
            <div className="mochi-os-extension-field">
              <span>{translate('ui.chat.mochiosview.condition')}</span>
              <input value={settings.wxCondition} onChange={(event) => persistSettings({ wxCondition: event.target.value })} />
            </div>
          </>
        )}

        {tab === 'prompt' && (
          <>
            <Select
              label={translate('ui.chat.mochiosview.presetMode')}
              value={settings.promptPresetMode}
              onChange={(value) => persistSettings({ promptPresetMode: value as MochiPresetMode })}
              options={[
                ['default', translate('ui.chat.mochiosview.presetModeDefault')],
                ['custom', translate('ui.chat.mochiosview.presetModeCustom')],
              ]}
            />
            <div className="mochi-os-extension-field">
              <span>{translate('ui.chat.mochiosview.customPresetJson')}</span>
              <textarea
                value={presetJson ?? settings.customPresetJson ?? DEFAULT_MOCHI_PRESET_JSON}
                spellCheck={false}
                onChange={(event) => setPresetJson(event.target.value)}
              />
            </div>
            <div className="mochi-os-extension-actions">
              <button
                type="button"
                className="mochi-os-extension-btn is-primary"
                onClick={() => saveJson('preset', presetJson ?? settings.customPresetJson ?? DEFAULT_MOCHI_PRESET_JSON)}
              >
                {translate('ui.chat.mochiosview.saveAndApply')}
              </button>
              <button
                type="button"
                className="mochi-os-extension-btn"
                onClick={() => {
                  setPresetJson(DEFAULT_MOCHI_PRESET_JSON);
                  saveJson('preset', DEFAULT_MOCHI_PRESET_JSON);
                }}
              >
                {translate('ui.chat.mochiosview.resetPresetDefault')}
              </button>
            </div>

            <div className="mochi-os-extension-field">
              <span>{translate('ui.chat.mochiosview.formatGuides')}</span>
              <textarea
                value={guidesJson ?? settings.formatGuidesJson ?? JSON.stringify(DEFAULT_FORMAT_GUIDES, null, 2)}
                spellCheck={false}
                onChange={(event) => setGuidesJson(event.target.value)}
              />
            </div>
            <div className="mochi-os-extension-actions">
              <button
                type="button"
                className="mochi-os-extension-btn is-primary"
                onClick={() =>
                  saveJson(
                    'guides',
                    guidesJson ?? settings.formatGuidesJson ?? JSON.stringify(DEFAULT_FORMAT_GUIDES, null, 2),
                  )
                }
              >
                {translate('ui.chat.mochiosview.formatGuideExport')}
              </button>
            </div>
            {editorError && <div className="mochi-os-extension-status is-error">{editorError}</div>}
            <div className="mochi-os-extension-note">{translate('ui.chat.mochiosview.formatGuidesSubtitle')}</div>
          </>
        )}

        <div className="mochi-os-extension-actions">
          <button type="button" className="mochi-os-extension-btn" onClick={onBack}>
            {translate('ui.chat.mochiosview.backToHome')}
          </button>
        </div>
      </div>
    </>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mochi-os-extension-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}