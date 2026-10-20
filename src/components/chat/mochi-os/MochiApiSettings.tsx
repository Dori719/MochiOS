import { useQuery } from '@tanstack/react-query';
import { DEFAULT_MOCHI_OS_SETTINGS } from '../../../shared/mochi-os.schema';
import { useMochiOsSettings, useUpdateMochiOsSettings } from '../../../hooks/use-mochi-os-settings';
import { listConnectionProfiles } from '../../../st/connections';

export function MochiApiSettings() {
  const { data: settings = DEFAULT_MOCHI_OS_SETTINGS } = useMochiOsSettings();
  const update = useUpdateMochiOsSettings();
  const { data: profiles = [], isPending, isError } = useQuery({
    queryKey: ['mochi-connection-profiles'],
    queryFn: listConnectionProfiles,
  });
  const missingProfile = settings.connectionProfileId && !profiles.some((p) => p.id === settings.connectionProfileId);

  return (
    <div className="panel">
      <div className="settings-section-title">API</div>
      <label className="lbl" htmlFor="mochi-api-profile">SillyTavern connection</label>
      <select
        id="mochi-api-profile"
        value={settings.connectionProfileId ?? ''}
        disabled={update.isPending}
        onChange={(event) => update.mutate({ ...settings, connectionProfileId: event.target.value || null })}
      >
        <option value="">Default — current SillyTavern connection</option>
        {missingProfile && <option value={settings.connectionProfileId!}>Unavailable saved profile</option>}
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.name}{profile.model ? ` — ${profile.model}` : ''}</option>
        ))}
      </select>
      <p className="lbl">Used for data generation, private chats, and group chats. All phone data and chat records belong to the currently selected SillyTavern chat.</p>
      <p className="lbl">Choosing a saved profile here does not change SillyTavern’s active connection.</p>
      {isPending && <p className="lbl">Loading saved profiles…</p>}
      {isError && <p role="alert">Could not load SillyTavern connection profiles.</p>}
      {!isPending && !isError && profiles.length === 0 && <p className="lbl">Save a supported profile in SillyTavern’s Connection Manager to use another connection.</p>}
      {missingProfile && !isPending && <p role="alert">Select an available profile or Default before generating.</p>}
    </div>
  );
}
