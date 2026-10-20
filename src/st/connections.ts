/** Named requests use SillyTavern's profile service without switching its active API. */
import { ctx, readChatSettings } from './adapter';
import { MOCHI_OS_SETTINGS_KEY, normalizeMochiOsSettings } from '../shared/mochi-os.schema';

export interface ConnectionProfile {
  id: string;
  name: string;
  model?: string;
}

interface ProfileRequestService {
  getSupportedProfiles(): ConnectionProfile[];
  sendRequest(
    profileId: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    options: { stream: false; extractData: true; includePreset: true; signal?: AbortSignal },
  ): Promise<{ content: string }>;
}

export function profileRequestService(): Promise<ProfileRequestService> {
  const service = ctx().ConnectionManagerRequestService as ProfileRequestService | undefined;
  if (!service) return Promise.reject(new Error('Mochi OS: SillyTavern Connection Manager is unavailable'));
  return Promise.resolve(service);
}

export async function listConnectionProfiles(): Promise<ConnectionProfile[]> {
  if (ctx().extensionSettings.disabledExtensions?.includes('connection-manager')) return [];
  const service = await profileRequestService();
  return service.getSupportedProfiles().map(({ id, name, model }) => ({ id, name, model }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read at request time, not at mount time; default follows the current ST connection. */
export function selectedConnectionProfileId(): string | null {
  const stored = readChatSettings()[MOCHI_OS_SETTINGS_KEY];
  if (stored) return normalizeMochiOsSettings(stored).connectionProfileId;
  try {
    return normalizeMochiOsSettings(window.localStorage.getItem(MOCHI_OS_SETTINGS_KEY)).connectionProfileId;
  } catch {
    return null;
  }
}
