import { DEFAULT_MOCHI_OS_SETTINGS, MOCHI_OS_SETTINGS_KEY, normalizeMochiOsSettings, type MochiOsSettings } from '../shared/mochi-os.schema';
import { activeChatId, readChatMeta, readChatSettings, writeChatMeta, writeChatSettings } from './adapter';

const environmentKeys = [
  'timeFormat', 'tempUnit', 'clockMode', 'clockTz', 'clockOffset', 'clockAiDecide',
  'aiFields', 'aiDecidedDate', 'aiDecidedTime', 'wxTemp', 'wxCondition', 'wxPlace', 'wxAiDecide',
] as const;

export function readMochiSettings(): MochiOsSettings {
  const settings = { ...normalizeMochiOsSettings(readChatSettings()[MOCHI_OS_SETTINGS_KEY]) };
  const environment = normalizeMochiOsSettings(activeChatId() ? readChatMeta().environmentSettings : null);
  for (const key of environmentKeys) Object.assign(settings, { [key]: environment[key] });
  return settings;
}

export function writeMochiSettings(value: unknown, chatId: string | null): MochiOsSettings {
  if (activeChatId() !== chatId) throw new Error('Mochi OS: the chat changed');
  const settings = normalizeMochiOsSettings(value);
  const globalSettings = { ...settings };
  const environmentSettings: Partial<MochiOsSettings> = {};
  for (const key of environmentKeys) {
    Object.assign(environmentSettings, { [key]: settings[key] });
    Object.assign(globalSettings, { [key]: DEFAULT_MOCHI_OS_SETTINGS[key] });
  }
  if (chatId) writeChatMeta({ ...readChatMeta(), environmentSettings });
  writeChatSettings({ [MOCHI_OS_SETTINGS_KEY]: globalSettings });
  return settings;
}
