import { useQuery } from '@tanstack/react-query';
import { DEFAULT_MOCHI_OS_SETTINGS } from '../../../shared/mochi-os.schema';
import { useMochiOsSettings, useUpdateMochiOsSettings } from '../../../hooks/use-mochi-os-settings';
import { listConnectionProfiles } from '../../../st/connections';

export function MochiApiSettings({ image = false }: { image?: boolean }) {
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const update = useUpdateMochiOsSettings();
  const { data: profiles = [], isPending, isError } = useQuery({
    queryKey: ['mochi-connection-profiles'],
    queryFn: listConnectionProfiles,
  });
  const profileKey = image ? 'imageConnectionProfileId' : 'connectionProfileId';
  const profileId = settings[profileKey];
  const missingProfile = profileId && !profiles.some((p) => p.id === profileId);
  const selectId = image ? 'mochi-image-api-profile' : 'mochi-api-profile';

  return (
    <div className="panel">
      <div className="settings-section-title">{image ? 'Image API' : 'API'}</div>
      <label className="lbl" htmlFor={selectId}>SillyTavern connection</label>
      <select
        className="mochi-connection-profile"
        id={selectId}
        value={profileId ?? ''}
        disabled={update.isPending}
        onChange={(event) => update.mutate({ ...settings, [profileKey]: event.target.value || null })}
      >
        <option value="">{image ? 'Default — selected SillyTavern profile' : 'Default — current SillyTavern connection'}</option>
        {missingProfile && <option value={profileId!}>Unavailable saved profile</option>}
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.name}{profile.model ? ` — ${profile.model}` : ''}</option>
        ))}
      </select>
      <p className="lbl">{image ? 'Renders photo descriptions using an image-generating chat-completion model. Only photo descriptions and their drawing prompts are sent here. The complete reply appears after its images are ready.' : 'Used for all phone content, including replies and drawing prompts.'} Connection preferences are shared across all roleplay chats.</p>
      {image && <>
        <div className="lbl" id="mochi-format-guide-mode-label">Format guide mode</div>
        <div className="seg" role="group" aria-labelledby="mochi-format-guide-mode-label">
        {([
          ['general', 'General'],
          ['drawing_tags', 'Drawing tags'],
          ['drawing_natural', 'Drawing natural language'],
        ] as const).map(([value, label]) => <button type="button" key={value}
          className={settings.formatGuideMode === value ? 'active' : ''}
          aria-pressed={settings.formatGuideMode === value} disabled={update.isPending}
          onClick={() => update.mutate({ ...settings, formatGuideMode: value })}>
          {label}
        </button>)}
        </div>
        <p className="lbl">If an app has no guide for the selected drawing mode, its General guide and API connection are used.</p>
      </>}
      <p className="lbl">Choosing a saved profile here does not change SillyTavern’s active connection.</p>
      {isPending && <p className="lbl">Loading saved profiles…</p>}
      {isError && <p role="alert">Could not load SillyTavern connection profiles.</p>}
      {update.isError && <p role="alert">Could not save settings. Try your selection again.</p>}
      {!isPending && !isError && profiles.length === 0 && <p className="lbl">Save a supported profile in SillyTavern’s Connection Manager to use another connection.</p>}
      {missingProfile && !isPending && <p role="alert">Select an available profile or Default before generating.</p>}
    </div>
  );
}
