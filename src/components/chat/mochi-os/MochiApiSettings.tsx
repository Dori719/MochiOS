import { useQuery } from '@tanstack/react-query';
import { DEFAULT_MOCHI_OS_SETTINGS } from '../../../shared/mochi-os.schema';
import { useMochiOsSettings, useUpdateMochiOsSettings } from '../../../hooks/use-mochi-os-settings';
import { listConnectionProfiles } from '../../../st/connections';

export function MochiApiSettings({ image = false }: { image?: boolean }) {
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const update = useUpdateMochiOsSettings();
  const { data: profiles = [], isPending, isError } = useQuery({
    queryKey: ['mochi-connection-profiles'], queryFn: listConnectionProfiles,
  });
  const profileKey = image ? 'imageConnectionProfileId' : 'connectionProfileId';
  const profileId = settings[profileKey];
  const missingProfile = profileId && !profiles.some((p) => p.id === profileId);
  const selectId = image ? 'mochi-image-api-profile' : 'mochi-api-profile';
  const imageApi = settings.imageApi;
  const saveImage = (patch: Partial<typeof imageApi>) => update.mutate({ ...settings, imageApi: { ...imageApi, ...patch } });

  return <div className="panel">
    <div className="settings-section-title">{image ? 'Image API' : 'API'}</div>
    {image && <>
      <div className="lbl" id="mochi-format-guide-mode-label">Format guide mode</div>
      <div className="seg" role="group" aria-labelledby="mochi-format-guide-mode-label">
        {([
          ['general', 'General'], ['drawing_tags', 'Drawing tags'], ['drawing_natural', 'Drawing natural language'],
        ] as const).map(([value, label]) => <button type="button" key={value}
          className={settings.formatGuideMode === value ? 'active' : ''}
          aria-pressed={settings.formatGuideMode === value} disabled={update.isPending}
          onClick={() => update.mutate({ ...settings, formatGuideMode: value })}>{label}</button>)}
      </div>
      <p className="lbl">If an app has no guide for the selected drawing mode, its General guide and API connection are used.</p>
    </>}
    <label className="lbl" htmlFor={selectId}>SillyTavern connection</label>
    <select className="mochi-connection-profile" id={selectId} value={profileId ?? ''} disabled={update.isPending}
      onChange={(event) => update.mutate({ ...settings, [profileKey]: event.target.value || null })}>
      <option value="">{image ? 'Default — selected SillyTavern profile' : 'Default — current SillyTavern connection'}</option>
      {missingProfile && <option value={profileId!}>Unavailable saved profile</option>}
      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.model ? ` — ${profile.model}` : ''}</option>)}
    </select>
    <p className="lbl">Choosing a saved profile here does not change SillyTavern’s active connection.</p>
    {isPending && <p className="lbl">Loading saved profiles…</p>}
    {isError && <p role="alert">Could not load SillyTavern connection profiles.</p>}
    {!isPending && !isError && profiles.length === 0 && <p className="lbl">Save a supported profile in SillyTavern’s Connection Manager to use another connection.</p>}
    {missingProfile && !isPending && <p role="alert">Select an available profile or Default before generating.</p>}
    {image && <>
      <div className="lbl" id="mochi-image-format-label">API format</div>
      <div className="seg" role="group" aria-labelledby="mochi-image-format-label">
        {(['openai', 'gemini', 'custom'] as const).map((format) => <button key={format} type="button"
          className={imageApi.format === format ? 'active' : ''} aria-pressed={imageApi.format === format}
          disabled={update.isPending} onClick={() => saveImage({ format })}>{({ openai: 'OpenAI', gemini: 'Gemini', custom: 'Custom' })[format]}</button>)}
      </div>
      <p className="lbl">Controls the available image options. Your SillyTavern profile remains the connection.</p>
      <label className="lbl" htmlFor="mochi-image-ratio">Image aspect ratio</label>
      <select id="mochi-image-ratio" className="mochi-connection-profile" value={imageApi.aspectRatio} disabled={update.isPending} onChange={(e) => saveImage({ aspectRatio: e.target.value as typeof imageApi.aspectRatio })}>
        {['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].map(value => <option key={value} value={value}>{value === 'auto' ? 'Auto — model default' : value}</option>)}
      </select>
      {imageApi.format !== 'openai' && <>
        <label className="lbl" htmlFor="mochi-image-resolution">Image resolution</label>
        <select id="mochi-image-resolution" className="mochi-connection-profile" value={imageApi.resolution} disabled={update.isPending} onChange={(e) => saveImage({ resolution: e.target.value as typeof imageApi.resolution })}>
          {['auto', '1K', '2K', '4K'].map(value => <option key={value} value={value}>{value === 'auto' ? 'Auto — model default' : value}</option>)}
        </select>
      </>}
      <p className="lbl">Image preferences are sent as instructions through your profile. Support depends on the model.</p>
      <label className="lbl" htmlFor="mochi-image-prefix">Prompt prefix</label>
      <textarea id="mochi-image-prefix" className="preset-block-textarea" rows={3} defaultValue={imageApi.prefix} placeholder="Added before every image prompt" onBlur={(e) => saveImage({ prefix: e.target.value })} />
      <label className="lbl" htmlFor="mochi-image-suffix">Prompt suffix</label>
      <textarea id="mochi-image-suffix" className="preset-block-textarea" rows={3} defaultValue={imageApi.suffix} placeholder="Added after every image prompt" onBlur={(e) => saveImage({ suffix: e.target.value })} />
    </>}
    {update.isError && <p role="alert">Could not save settings. Try your selection again.</p>}
  </div>;
}
