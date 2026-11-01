/** Mochi markers expand at their preset position, using the host's real prompt data. */
import type { Character, Message, Persona } from '../shared';
import { countMochiMessageTokens, fitMochiPromptToContext, getMochiTokenLimits, markMochiBudgetCandidates } from './context-budget';
import { DEFAULT_FORMAT_GUIDES, type MochiFormatGuideData } from '../components/chat/mochi-os/mochi-os.constants';
import { activeChatId, ctx, mapMessage, st } from './adapter';
import { mochiChatCompletionSettings } from './connections';
import { getMochiWorldInfoPrompt } from './lorebooks';

export interface MochiPromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

export interface MochiPresetBlock {
  role?: string;
  content?: string;
  identifier?: string;
  isMarker?: boolean;
  markerConfig?: { type?: string };
  enabled?: boolean;
}

export interface MochiPresetInput {
  blocks: MochiPresetBlock[];
  characters: Character[];
  persona: Persona | null;
  userName: string;
  characterName: string;
  userInput: string;
  formatGuides: string;
  idMacroCards: string;
  historyConfig?: MochiFormatGuideData['historyConfig'];
  excludedMessageIds?: string[];
  responseLength?: number;
}

/** YAML user flags are data, not an occurrence of the user's display name. */
export function substituteMochiPromptMacros(
  text: string,
  userName: string,
  characterName: string,
  template = false,
  dynamicMacros?: Record<string, string>,
): string {
  const key = '__MOCHI_LITERAL_USER_FLAG__';
  let content = text.replace(/(['"]?)\{\{user\}\}\1(?=\s*:\s*(?:true|false|1|0)\b)/gi, key)
    .replace(/\{\{user\}\}/gi, () => userName)
    .replace(/\{\{char\}\}/gi, () => characterName);
  // A guide's {{Time}}/etc. are output placeholders, not host macros to fill.
  if (!template) content = st().substituteParams(content, { name1Override: userName, name2Override: characterName, dynamicMacros });
  return content.replaceAll(key, '{{user}}');
}

function filterHistoryTags(content: string, filters: MochiFormatGuideData['historyConfig']['tagFilters']): string {
  let result = content;
  for (const filter of filters) {
    if (!filter.enabled || !filter.startTag) continue;
    if (filter.mode === 'remove_before') {
      const index = result.lastIndexOf(filter.startTag);
      if (index >= 0) result = result.slice(index + filter.startTag.length);
    } else if (filter.mode === 'remove_after') {
      const index = result.indexOf(filter.startTag);
      if (index >= 0) result = result.slice(0, index);
    } else if (filter.endTag) {
      const start = filter.startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const end = filter.endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (filter.mode === 'keep_between') {
        result = [...result.matchAll(new RegExp(`${start}([\\s\\S]*?)${end}`, 'g'))].map((match) => match[1]).join('\n');
      } else if (filter.mode === 'remove_between') {
        result = result.replace(new RegExp(`${start}[\\s\\S]*?${end}`, 'g'), '');
      }
    }
  }
  return result;
}

/** Same role/name rules as ST's setOpenAIMessages, without turning YAML into system prose. */
export function formatMochiPromptHistory(
  messages: Message[],
  options: {
    config?: MochiFormatGuideData['historyConfig'];
    namesBehavior?: number;
    isGroup?: boolean;
    userName: string;
    characterName: string;
    excludedMessageIds?: string[];
    ignoreSymbol?: symbol;
    api?: string;
  },
): MochiPromptMessage[] {
  const config = { ...DEFAULT_FORMAT_GUIDES.historyConfig, ...options.config };
  const excluded = new Set(options.excludedMessageIds);
  const eligible = messages.filter((message) => {
    if (excluded.has(message.id) || (options.ignoreSymbol && message.extra?.[options.ignoreSymbol as any])) return false;
    if ((message.isSystem || (message.role === 'system' && message.extra?.type !== 'narrator')) && !config.includeSystem) return false;
    if (message.role === 'user' && !config.includeUser) return false;
    return ['user', 'assistant', 'system'].includes(message.role);
  });
  const limit = Number(config.maxMessages);
  const selected = limit > 0 ? eligible.slice(-limit) : eligible;
  return selected.flatMap((message) => {
    // ST removes carriage returns, but does not trim message content. Leading
    // indentation, trailing newlines and whitespace-only turns can be meaningful.
    let content = filterHistoryTags(message.content, config.tagFilters || []).replace(/\r/g, '');
    const name = String(message.name ?? '');
    const isNarrator = message.extra?.type === 'narrator';
    // Text/instruct completion adds speaker names during host formatting. CC's
    // names_behavior must not pre-prefix text or sanitize its real speaker names.
    if (options.api && options.api !== 'openai') return [{ role: (isNarrator ? 'system' : message.role) as MochiPromptMessage['role'], content,
      ...(!isNarrator && name ? { name } : {}),
    }];
    const namesBehavior = Number(options.namesBehavior ?? 0);
    switch (namesBehavior) {
      case 0:
        if ((options.isGroup && name !== options.userName) || (message.forceAvatar && name !== options.userName && !isNarrator)) content = `${name}: ${content}`;
        break;
      case 2:
        if (!isNarrator) content = `${name}: ${content}`;
        break;
    }
    if (!content) return [];
    return [{ role: (isNarrator ? 'system' : message.role) as MochiPromptMessage['role'], content,
      ...(namesBehavior === 1 && name ? { name: name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64) } : {}),
    }];
  });
}

/** ST adds configured reasoning newest-first, for the active group speaker only.
 * Keep the counter local: constructing the host's PromptReasoning would replace
 * the static instance belonging to an in-progress roleplay generation. */
function addHistoryReasoning(history: Message[], regex: Record<string, any>): void {
  const context = ctx();
  const settings = context.powerUserSettings?.reasoning;
  if (!settings?.add_to_prompts) return;
  let additions = 0;
  const max = Number(settings.max_additions ?? 1);
  for (let index = history.length - 1; index >= 0 && additions < max; index--) {
    const message = history[index];
    if (context.groupId && message.name !== context.name2) continue;
    const reasoning = regex.getRegexedString(String(message.extra?.reasoning ?? ''), regex.regex_placement.REASONING,
      { isPrompt: true, depth: history.length - index - 1 });
    if (!reasoning || reasoning === '\u200B') continue;
    const expand = (text: string) => st().substituteParams(text || '');
    message.content = `${expand(settings.prefix)}${reasoning}${expand(settings.suffix)}${expand(settings.separator)}${message.content}`;
    additions++;
  }
}

/** ST examples are named system messages; the greeting is already the first history turn. */
export function formatMochiDialogueExamples(text: string, userName: string, characterName: string, isGroup = false, groupNames: string[] = []): MochiPromptMessage[][] {
  const source = text.trim();
  if (!source || source === '<START>') return [];
  return (source.startsWith('<START>') ? source : `<START>\n${source}`).split(/<START>/gi).slice(1).flatMap((block) => {
    const messages: MochiPromptMessage[] = [];
    let speaker = '';
    let lines: string[] = [];
    const flush = () => {
      if (!speaker) return;
      const content = lines.join('\n').replace(`${speaker}:`, '').trim();
      if (content) messages.push({ role: 'system', name: speaker === userName ? 'example_user' : 'example_assistant',
        content: isGroup ? `${speaker}: ${content}` : content });
    };
    for (const line of block.trim().replace(/\r/g, '').split('\n')) {
      const next = [userName, characterName, ...groupNames].find((name) => name && line.startsWith(`${name}:`)) || '';
      if (next && next !== speaker) { flush(); speaker = next; lines = []; }
      if (speaker) lines.push(line);
    }
    flush();
    return messages.length ? [messages] : [];
  });
}

function promptRole(role: unknown): MochiPromptMessage['role'] {
  return (typeof role === 'string' && ['system', 'user', 'assistant'].includes(role) ? role : ['system', 'user', 'assistant'][Number(role)] || 'system') as MochiPromptMessage['role'];
}

interface HistoryInjection extends MochiPromptMessage {
  depth: number;
  order?: number;
}

/** Calculate all depths against the original newest-first history, as ST does. */
function injectHistoryPrompts(history: MochiPromptMessage[], injections: HistoryInjection[]): MochiPromptMessage[] {
  const reversed = [...history].reverse();
  let inserted = 0;
  const depths = [...new Set(injections.map((entry) => entry.depth))].sort((a, b) => a - b);
  for (const depth of depths) {
    const entries = injections.filter((entry) => entry.depth === depth);
    const orders = [...new Set(entries.map((entry) => entry.order ?? 100))].sort((a, b) => b - a);
    const prompts: MochiPromptMessage[] = [];
    for (const order of orders) {
      for (const role of ['system', 'user', 'assistant'] as const) {
        const content = entries.filter((entry) => (entry.order ?? 100) === order && entry.role === role)
          .map((entry) => entry.content.trim()).filter(Boolean).join('\n');
        if (content) prompts.push({ role, content });
      }
    }
    reversed.splice(depth + inserted, 0, ...prompts);
    inserted += prompts.length;
  }
  return reversed.reverse();
}

/** Shared by data generation and private/group replies: no marker silently disappears in one path. */
export async function buildMochiPresetMessages(input: MochiPresetInput): Promise<MochiPromptMessage[]> {
  const context = ctx();
  const chatId = activeChatId();
  const sourceChat = context.chat;
  const assertChat = () => {
    if (activeChatId() !== chatId || ctx().chat !== sourceChat) throw new Error('Mochi OS: the selected SillyTavern chat changed');
  };
  const enabled = input.blocks.filter((block) => block.enabled !== false);
  const markerType = (block: MochiPresetBlock) => block.markerConfig?.type || block.identifier;
  const markerTypes = new Set(enabled.filter((block) => block.isMarker || block.markerConfig).map(markerType));
  const limits = getMochiTokenLimits(input.responseLength);
  const settings = mochiChatCompletionSettings(limits.profileId);
  const promptBudget = limits.promptBudget;
  const groupNames = input.characters.map((character) => character.data?.name || character.name).filter(Boolean);
  const primary = input.characters.find((character) => (character.data?.name || character.name) === input.characterName) || input.characters[0];
  const data = primary?.data || {};
  const macroFields: Record<string, string> = {
    description: data.description || primary?.description || '', personality: data.personality || primary?.personality || '',
    scenario: context.chatMetadata?.scenario || data.scenario || primary?.scenario || '',
    persona: input.persona?.description || '', mesExamples: context.chatMetadata?.mes_example || data.mes_example || '',
    mesExamplesRaw: context.chatMetadata?.mes_example || data.mes_example || '',
    charPrompt: context.chatMetadata?.system_prompt || data.system_prompt || '',
    charInstruction: data.post_history_instructions || '', charJailbreak: data.post_history_instructions || '',
    charDepthPrompt: data.extensions?.depth_prompt?.prompt || '', creatorNotes: data.creator_notes || '',
    charVersion: data.character_version || '', char_version: data.character_version || '',
  };
  const expand = (text: string, characterName = input.characterName, fields = macroFields) => substituteMochiPromptMacros(text, input.userName, characterName, false, fields);
  const config = { ...DEFAULT_FORMAT_GUIDES.historyConfig, ...input.historyConfig };
  // The phone UI combines old split transcripts into logical turns. A prompt
  // must not use that view: ST sends the physical messages, with each message's
  // own role, name, attachment and regex depth, in their original order.
  const excluded = new Set(input.excludedMessageIds);
  const historySource = sourceChat.flatMap((message, index) => {
    if (message.is_system && !config.includeSystem) return [];
    const mapped = mapMessage(index) as Message | null;
    if (!mapped || excluded.has(mapped.id) || excluded.has(message.extra?.mochiosTurnId)) return [];
    return [mapped];
  });
  // Historical {{char}}/{{user}} refer to the roleplay's speakers, not the
  // contact or phone persona selected for this new request.
  // Native substitution also expands YAML's historical {{user}} keys. Only
  // output format-guide placeholders are protected as literal template data.
  const expandHistory = (text: string) => st().substituteParams(text, { name1Override: context.name1, name2Override: context.name2 });
  const [regex, attachments, worldInfoModule] = await Promise.all([
    import('/scripts/extensions/regex/engine.js'), import('/scripts/chats.js'), import('/scripts/world-info.js'),
  ]);
  assertChat();
  const preparedHistory = await Promise.all(historySource.map(async (message, index) => {
    // ST refreshes greeting macros before prompt regexes, not afterwards.
    const text = sourceChat[0]?.extra?.mochiosId === message.id ? expandHistory(message.content) : message.content;
    const content = regex.getRegexedString(text, message.role === 'user' ? regex.regex_placement.USER_INPUT : regex.regex_placement.AI_OUTPUT,
      { isPrompt: true, depth: historySource.length - index - 1 });
    // ST's attachment helper updates extra.fileLength; operate on a copy, never
    // the saved message. Files and media titles still reach the same prompt.
    const withFiles = await attachments.appendFileContent({ ...message, extra: { ...message.extra } }, content);
    const titles = [message.extra?.append_title ? message.extra.title : '',
      ...(Array.isArray(message.extra?.media) ? message.extra.media : []).filter((media: any) => media?.append_title).map((media: any) => media?.title)].filter(Boolean);
    return { ...message, content: filterHistoryTags([withFiles, ...titles].join('\n\n'), config.tagFilters || []) };
  }));
  addHistoryReasoning(preparedHistory, regex);
  let history = formatMochiPromptHistory(preparedHistory, {
    config: { ...config, tagFilters: [] }, namesBehavior: settings.names_behavior, isGroup: Boolean(context.groupId), api: limits.api,
    userName: context.name1, characterName: context.name2, ignoreSymbol: context.symbols?.ignore,
  }).map((message) => ({ ...message, content: expandHistory(message.content) }));
  assertChat();

  const characterMessages: MochiPromptMessage[] = [];
  const examples: MochiPromptMessage[][] = [];
  const injections: HistoryInjection[] = [];
  const cardText = (text: string, name: string, fields = macroFields) => {
    const replaced = expand(text, name, fields).replace(/\r/g, '').trim();
    return context.powerUserSettings?.collapse_newlines ? replaced.replace(/\n{3,}/g, '\n\n') : replaced;
  };
  const group = context.groups?.find((group: Record<string, any>) => String(group.id) === String(context.groupId));
  const joinFields = Boolean(context.groupId && group?.generation_mode);
  const descriptions: string[] = [];
  const personalities: string[] = [];
  const scenarios: string[] = [];
  for (const character of input.characters) {
    const data = character.data || {};
    const name = data.name || character.name || input.characterName;
    const meta = context.chatMetadata || {};
    const description = data.description || character.description || '';
    const personality = data.personality || character.personality || '';
    const scenario = data.scenario || character.scenario || '';
    const fields = { ...macroFields, description, personality, scenario: meta.scenario || scenario };
    const prepareField = (value: string, fieldName: string) => {
      if (!value.trim()) return '';
      const prefix = joinFields ? expand(String(group.generation_mode_join_prefix || '').replace(/<FIELDNAME>/gi, fieldName), name, fields) : '';
      const suffix = joinFields ? expand(String(group.generation_mode_join_suffix || '').replace(/<FIELDNAME>/gi, fieldName), name, fields) : '';
      return `${prefix}${cardText(value, name, fields)}${suffix}`;
    };
    if (joinFields) {
      descriptions.push(prepareField(description, 'Description'));
      personalities.push(prepareField(personality, 'Personality'));
      scenarios.push(prepareField(scenario, 'Scenario'));
    } else {
      const personalityText = personality ? cardText(settings.personality_format || personality, name, fields) : '';
      const scenarioText = fields.scenario ? cardText(settings.scenario_format || fields.scenario, name, fields) : '';
      for (const content of [cardText(description, name, fields), personalityText, scenarioText]) {
        if (content) characterMessages.push({ role: 'system', content });
      }
    }
    if (!meta.mes_example) examples.push(...formatMochiDialogueExamples(cardText(data.mes_example || character.mes_example || '', name, fields), input.userName, name, Boolean(context.groupId), groupNames));
    const depthPrompt = data.extensions?.depth_prompt;
    if (depthPrompt?.prompt) injections.push({ role: promptRole(depthPrompt.role), content: cardText(depthPrompt.prompt, name, fields), depth: Math.max(0, Math.min(10000, Number(depthPrompt.depth ?? 4) || 0)) });
  }
  if (joinFields) {
    const description = descriptions.filter(Boolean).join('\n');
    const personality = personalities.filter(Boolean).join('\n');
    const scenario = context.chatMetadata?.scenario || scenarios.filter(Boolean).join('\n');
    const fields = { ...macroFields, description, personality, scenario };
    for (const content of [description, personality && cardText(settings.personality_format || personality, input.characterName, fields), scenario && cardText(settings.scenario_format || scenario, input.characterName, fields)]) {
      if (content) characterMessages.push({ role: 'system', content });
    }
  }
  if (context.chatMetadata?.mes_example) examples.push(...formatMochiDialogueExamples(cardText(context.chatMetadata.mes_example, input.characterName), input.userName, input.characterName, Boolean(context.groupId), groupNames));

  const worldInfo = ['world_info_before', 'world_info_after', 'lorebook', 'chat_history', 'dialogue_examples'].some((type) => markerTypes.has(type))
    ? await getMochiWorldInfoPrompt({
        history: preparedHistory.map((message) => worldInfoModule.world_info_include_names === false ? message.content : `${message.name}: ${message.content}`),
        userInput: expand(input.userInput), maxContext: Number.isFinite(promptBudget) && promptBudget > 0 ? promptBudget : undefined,
        personaDescription: expand(input.persona?.description || ''), characters: input.characters, substitute: expand,
      }) : null;
  for (const example of worldInfo?.worldInfoExamples || []) {
    const formatted = formatMochiDialogueExamples(expand(example.content || ''), input.userName, input.characterName, Boolean(context.groupId), groupNames);
    if (Number(example.position) === 0) examples.unshift(...formatted); else examples.push(...formatted);
  }
  if (context.powerUserSettings?.strip_examples) examples.length = 0;
  if (markerTypes.has('chat_history')) {
    for (const entry of worldInfo?.worldInfoDepth || []) {
      const depth = Math.max(0, Math.min(10000, Number(entry.depth ?? 4) || 0));
      injections.push({ role: promptRole(entry.role), content: expand((entry.entries || []).join('\n')), depth });
    }
  }

  const summary = context.extensionPrompts?.['1_memory'];
  const summaryText = summary?.value || context.chatMetadata?.summary || '';
  const agentMessages: MochiPromptMessage[] = [];
  const extensionPrompts = { ...context.extensionPrompts,
    ...(worldInfo?.authorNote ? { '2_floating_prompt': worldInfo.authorNote } : {}),
  };
  for (const [id, prompt] of Object.entries(extensionPrompts).sort(([a], [b]) => a.localeCompare(b)) as [string, Record<string, any>][]) {
    // Native depth/persona/WI injections are rebuilt from this request, not stale
    // module state left by the last roleplay generation.
    if (/^(?:PERSONA_DESCRIPTION|QUIET_PROMPT|DEPTH_PROMPT(?:_\d+)?|customDepthWI(?:_.*)?|customWIOutlet_.*|__STORY_STRING__)$/.test(id) || !prompt.value) continue;
    if (id === '1_memory' && input.blocks.some((block) => markerType(block) === 'chat_summary')) continue;
    if (typeof prompt.filter === 'function' && !await prompt.filter()) continue;
    if (Number(prompt.position) === 1 && markerTypes.has('chat_history')) {
      injections.push({ role: promptRole(prompt.role), content: expand(prompt.value), depth: Math.max(0, Math.min(10000, Number(prompt.depth ?? 0) || 0)) });
    } else if (markerTypes.has('agent_data') && [0, 2].includes(Number(prompt.position))) {
      agentMessages.push({ role: promptRole(prompt.role), content: expand(prompt.value) });
    }
  }
  history = injectHistoryPrompts(history, injections);

  const worldInfoFormat = (content: string) => {
    const format = String(settings.wi_format || '');
    return expand(format.trim() ? format.replace(/\{0\}/g, () => content) : content);
  };

  const messages: MochiPromptMessage[] = [];
  const historyMessages = new Set<MochiPromptMessage>();
  const exampleCollections: MochiPromptMessage[][] = [];
  const exampleMessages = new Set<MochiPromptMessage>();
  const expandedMarkers = new Set<string>();
  const worldSources = new Set<string>();
  const addWorldInfo = (source: 'before' | 'after', content: string | undefined, role: MochiPromptMessage['role']) => {
    if (content && !worldSources.has(source)) messages.push({ role, content: worldInfoFormat(content) });
    worldSources.add(source);
  };
  let hasUserInput = false;
  for (const block of enabled) {
    const role = promptRole(block.role);
    if (!block.isMarker && !block.markerConfig) {
      if (block.content) messages.push({ role, content: expand(block.content) });
      continue;
    }
    const type = markerType(block);
    if (!type || expandedMarkers.has(type)) continue;
    expandedMarkers.add(type);
    if (type === 'character') messages.push(...characterMessages.map((message) => ({ ...message, role })));
    else if (type === 'persona' && input.persona?.description) messages.push({ role, content: cardText(input.persona.description, input.characterName) });
    else if (type === 'chat_history') {
      // The preset already opens the exchange (e.g. its GREETING_ADD block), so
      // the host's "new chat" nudge is not part of this request and is not sent.
      messages.push(...history); history.forEach((message) => historyMessages.add(message));
    } else if (type === 'dialogue_examples') {
      for (const dialogue of examples) {
        const collection = [...(settings.new_example_chat_prompt ? [{ role: 'system' as const, content: expand(settings.new_example_chat_prompt) }] : []), ...dialogue];
        messages.push(...collection); exampleCollections.push(collection);
        collection.forEach((message) => exampleMessages.add(message));
      }
    } else if (type === 'chat_summary' && summaryText) messages.push({ role: block.role ? role : promptRole(summary?.role), content: expand(summaryText) });
    else if (type === 'world_info_before') addWorldInfo('before', worldInfo?.worldInfoBefore, role);
    else if (type === 'world_info_after') addWorldInfo('after', worldInfo?.worldInfoAfter, role);
    else if (type === 'lorebook' && worldInfo) {
      addWorldInfo('before', worldInfo.worldInfoBefore, role);
      addWorldInfo('after', worldInfo.worldInfoAfter, role);
    } else if (type === 'id_macro_cards' && input.idMacroCards) messages.push({ role, content: expand(input.idMacroCards) });
    else if (type === 'format_guides' && input.formatGuides) messages.push({ role, content: substituteMochiPromptMacros(input.formatGuides, input.userName, input.characterName, true) });
    else if (type === 'user_input') {
      messages.push({ role: block.role ? role : 'user', content: expand(input.userInput) }); hasUserInput = true;
    } else if (type === 'agent_data') messages.push(...agentMessages);
  }
  // A deliberately disabled history marker stays disabled. Only the new task is
  // mandatory, and it goes before trailing assistant prefill, not before history.
  if (!hasUserInput) {
    let index = messages.length;
    while (index > 0 && messages[index - 1].role === 'assistant' && !historyMessages.has(messages[index - 1])) index--;
    messages.splice(index, 0, { role: 'user', content: expand(input.userInput) });
  }

  // Reserve the preset/task first, then retain the newest whole history turns,
  // just as ST's chat-history collection fills the remaining context budget.
  assertChat();
  const count = (message: MochiPromptMessage) => countMochiMessageTokens(message, limits);
  let remaining = promptBudget - 3;
  const required = messages.filter((message) => !historyMessages.has(message) && !exampleMessages.has(message));
  for (const cost of await Promise.all(required.map(count))) remaining -= cost;
  assertChat();
  if (remaining < 0) throw new Error('Mochi OS: the preset and format guide exceed the selected context size. Increase the context limit or shorten the preset.');
  const kept = new Set<MochiPromptMessage>();
  const keepHistory = async () => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (!historyMessages.has(messages[index])) continue;
      const cost = await count(messages[index]);
      if (cost > remaining) break;
      remaining -= cost; kept.add(messages[index]);
    }
  };
  const keepExamples = async () => {
    for (const collection of exampleCollections) {
      const cost = (await Promise.all(collection.map(count))).reduce((sum, cost) => sum + cost, 0);
      if (cost > remaining) break;
      remaining -= cost; collection.forEach((message) => kept.add(message));
    }
  };
  const pinned = Boolean(context.powerUserSettings?.pin_examples);
  if (pinned) { await keepExamples(); await keepHistory(); }
  else { await keepHistory(); await keepExamples(); }
  markMochiBudgetCandidates(historyMessages, exampleCollections, pinned);
  const bounded = await fitMochiPromptToContext(messages.filter((message) => (!historyMessages.has(message) && !exampleMessages.has(message)) || kept.has(message)), limits);
  assertChat();
  return bounded;
}
