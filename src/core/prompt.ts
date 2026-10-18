/**
 * Prompt assembly for Mochi OS generations.
 *
 * The engine built these messages in its React view and posted them to
 * `/api/mochios-data/:id/generate`, which sent them to the configured provider.
 * The preset, its marker vocabulary and the format guides are ported unchanged;
 * only the sources of the marker content changed, because a SillyTavern chat has
 * its own character card, persona and world info.
 */
import { DEFAULT_FORMAT_GUIDES, DEFAULT_MOCHI_PRESET, type MochiFormatGuideData } from '../mochi/constants';
import type { MochiOsSettings } from '../mochi/schema';
import { buildGroupChatPromptFromArchive, buildPrivateChatPromptFromArchive } from '../mochi/utils';

export interface PresetBlock {
  id: string;
  identifier: string;
  name: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  isMarker: boolean;
  enabled: boolean;
  markerConfig?: { type: string } | null;
}

export interface MochiPreset {
  name: string;
  blocks: PresetBlock[];
}

/** A parse failure falls back to the shipped default rather than sending nothing. */
function parseJson<T>(raw: string, fallback: T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function resolvePreset(settings: MochiOsSettings): MochiPreset {
  if (settings.promptPresetMode === 'custom') {
    return parseJson<MochiPreset>(settings.customPresetJson, DEFAULT_MOCHI_PRESET);
  }
  return DEFAULT_MOCHI_PRESET;
}

export function resolveFormatGuides(settings: MochiOsSettings): MochiFormatGuideData {
  if (!settings.formatGuidesJson || !settings.formatGuidesJson.trim()) return DEFAULT_FORMAT_GUIDES;
  return parseJson<MochiFormatGuideData>(settings.formatGuidesJson, DEFAULT_FORMAT_GUIDES);
}

/** Which guide describes the output being asked for. */
export type GuideKind = 'privateChat' | 'groupChat' | 'data';

export function guideText(guides: MochiFormatGuideData, kind: GuideKind): string {
  return guides?.formatGuide?.[kind] ?? '';
}

/** Everything a marker block can pull in from the host chat. */
export interface PromptContext {
  characterBlock: string;
  personaBlock: string;
  worldInfoBlock: string;
  idCardsBlock: string;
  dialogueExamplesBlock: string;
  historyBlock: string;
  guide: string;
  userInput: string;
  /** True when the user asked for another reply without typing anything. */
  continuationOnly: boolean;
}

export interface BuildOptions extends PromptContext {
  preset: MochiPreset;
  recordType: 'private' | 'group';
}

function wrap(tag: string, body: string): string | null {
  const trimmed = (body || '').trim();
  if (!trimmed) return null;
  return `<${tag}>\n${trimmed}\n</${tag}>`;
}

/**
 * Turn a preset plus a prompt context into the message array sent to the model.
 *
 * Marker blocks are resolved against the SillyTavern chat. The engine's
 * `chat_summary` and `agent_data` markers have no host equivalent here: they
 * carried output from the engine's agent pipeline, which a browser extension
 * cannot run, so those blocks are skipped instead of being sent empty.
 */
export function buildMessages(options: BuildOptions): Array<{ role: string; content: string }> {
  const { preset, recordType } = options;
  const messages: Array<{ role: string; content: string }> = [];
  let injectedHistory = false;
  let injectedUserInput = false;

  for (const block of preset.blocks ?? []) {
    if (block.enabled === false) continue;
    const marker = block.markerConfig?.type || (block.isMarker ? block.identifier : '');

    if (marker) {
      let content: string | null = null;

      switch (marker) {
        case 'character':
          content = wrap('character', options.characterBlock);
          break;
        case 'persona':
          content = wrap('persona', options.personaBlock);
          break;
        case 'world_info_before':
        case 'world_info_after':
        case 'lorebook':
          content = wrap('lorebook', options.worldInfoBlock);
          break;
        case 'id_macro_cards':
          content = options.idCardsBlock || null;
          break;
        case 'dialogue_examples':
          content = wrap('dialogue_examples', options.dialogueExamplesBlock);
          break;
        case 'chat_history':
          if (options.historyBlock.trim()) {
            injectedHistory = true;
            content = `<chat_history>\n${options.historyBlock.trim()}\n</chat_history>`;
          }
          break;
        case 'format_guides':
          content = options.guide || null;
          break;
        case 'user_input':
          content = options.userInput;
          injectedUserInput = true;
          break;
        case 'chat_summary':
        case 'agent_data':
          // Engine-only markers: nothing to inject from a SillyTavern chat.
          continue;
        default:
          content = block.content || null;
      }

      if (!content || !content.trim()) continue;
      messages.push({ role: block.role || 'system', content });
      continue;
    }

    if (block.content?.trim()) {
      messages.push({ role: block.role || 'system', content: block.content });
    }
  }

  // The history block is required context for a chat turn. A custom preset may
  // omit the marker, so make sure history is present rather than silently sending
  // only the new message.
  if (!injectedHistory && options.historyBlock.trim()) {
    messages.unshift({ role: 'system', content: `<chat_history>\n${options.historyBlock.trim()}\n</chat_history>` });
  }

  // A preset with no user_input marker still has to deliver what the user typed.
  if (!injectedUserInput) {
    const prefillIndex = messages.findIndex((message) => message.role === 'assistant');
    const userMessage = { role: 'user', content: options.userInput };
    if (prefillIndex !== -1) messages.splice(prefillIndex, 0, userMessage);
    else messages.push(userMessage);
  }

  void recordType;
  return messages;
}

/**
 * The history section for a thread, read from its archive.
 *
 * Group records are kept apart from private ones by the ported builder: the
 * group guide scopes a turn to the named group, so feeding it the user's private
 * conversations with the same characters would contradict the required format.
 */
export function buildThreadHistory(yaml: string, recordType: 'private' | 'group', groupName?: string): string {
  if (!yaml?.trim()) return '';
  return recordType === 'group'
    ? buildGroupChatPromptFromArchive({ rawYaml: yaml, groupName })
    : buildPrivateChatPromptFromArchive({ rawYaml: yaml });
}

/** The `id_macro_cards` block: who is on the phone, in the model's own format. */
export function buildIdMacroCards(params: { userName: string; characterName: string; bio?: string }): string {
  const lines = [
    '<id_macro_cards>',
    `  - name: ${params.characterName}`,
    `    role: character`,
    ...(params.bio?.trim() ? [`    bio: ${params.bio.trim()}`] : []),
    `  - name: ${params.userName}`,
    `    role: user`,
    '</id_macro_cards>',
  ];
  return lines.join('\n');
}