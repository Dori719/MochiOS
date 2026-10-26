/** Offline contract tests: no SillyTavern files, network calls, or API credits. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { runStickerStorageTests } from './test-sticker-storage.mjs';
import { runHistoryContextTests } from './test-history-context.mjs';

const root = path.resolve(import.meta.dirname, '..');
const result = await build({
  stdin: {
    contents: `
      export * from './src/st/adapter.ts';
      export { request } from './src/st/api.ts';
      export { listConnectionProfiles } from './src/st/connections.ts';
      export { DEFAULT_MOCHI_OS_SETTINGS, MOCHI_OS_SETTINGS_KEY, normalizeMochiOsSettings } from './src/shared/mochi-os.schema.ts';
      export { defaultPlace, phoneSize, placeFrame } from './src/st/frame-layout.ts';
      export { placeFloating, readViewport, setFloatingPosition, watchViewport } from './src/st/viewport.ts';
      export { launcherPalette } from './src/st/launcher.ts';
      export { deriveActiveLorebookViews } from './src/lib/chat-lorebooks.ts';
      export { mergeMochiChatHistoryBlocks, locateMochiMessageInRoleplay, mochiRoleplayBubbleId, parseChatHistoryBlocks, parseMochiChatResponse, serializeChatHistoryYaml, cleanAndExtractRawYaml, stripMochiReasoning, reconcileMochiContactHistory } from './src/components/chat/mochi-os/mochi-os.utils.ts';
      export { splitPhoneTranscript } from './src/st/phone-transcript.ts';
      export { createStickerLibrary, MAX_STICKER_BYTES, MAX_STICKER_NAME_LENGTH, normalizeStickerName, readStickerBackup, stickerName, stickerNameError, stickerNameKey, suggestStickerName } from './src/st/stickers.ts';
      export * from './src/st/sticker-storage.ts';
      export { buildMochiPresetMessages, formatMochiPromptHistory, formatMochiDialogueExamples, substituteMochiPromptMacros } from './src/st/preset.ts';
      export { formatFriendInfo, mochiSocialHandle, parseMochiPrivateChatContent, normalizeMochiPrivateChatGuide, normalizeMochiFormatGuides } from './src/components/chat/mochi-os/mochi-os.utils.ts';
      export { DEFAULT_FORMAT_GUIDES } from './src/components/chat/mochi-os/mochi-os.constants.ts';
      export { getMochiWorldInfoPrompt } from './src/st/lorebooks.ts';
      export { getMochiTokenLimits, fitMochiPromptToContext, markMochiBudgetCandidates, countMochiMessageTokens } from './src/st/context-budget.ts';
      export { generateMochiOutput } from './src/st/generate.ts';
      export { createMochiRoleplayHistoryIndexer } from './src/components/chat/mochi-os/mochi-history-index.ts';
      export { selectTestPersona } from '/scripts/personas.js';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  alias: { '@marinara-engine/shared': path.join(root, 'src/shared/index.ts') },
  plugins: [{
    name: 'mock-sillytavern-context',
    setup(builder) {
      builder.onResolve({ filter: /^\/scripts\/st-context\.js$/ }, () => ({ path: 'context', namespace: 'mock' }));
      builder.onResolve({ filter: /^\/script\.js$/ }, () => ({ path: 'script', namespace: 'mock' }));
      builder.onResolve({ filter: /^\/scripts\/world-info\.js$/ }, () => ({ path: 'world-info', namespace: 'mock' }));
      builder.onResolve({ filter: /^\/scripts\/personas\.js$/ }, () => ({ path: 'personas', namespace: 'mock' }));
      builder.onResolve({ filter: /^\/scripts\/extensions\/regex\/engine\.js$/ }, () => ({ path: 'regex', namespace: 'mock' }));
      builder.onResolve({ filter: /^\/scripts\/chats\.js$/ }, () => ({ path: 'attachments', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
        contents: {
          context: 'export function getContext() { return globalThis.__mochiTestHost; }',
          script: 'export const amount_gen = 256; export function getMaxContextTokens() { const h=globalThis.__mochiTestHost; return h.mainApi && h.mainApi!=="openai" ? h.maxContext || 8192 : h.chatCompletionSettings?.openai_max_context || h.maxContext || 8192; } export function getMaxResponseTokens() { const h=globalThis.__mochiTestHost; return h.mainApi && h.mainApi!=="openai" ? h.maxResponseTokens || amount_gen : h.chatCompletionSettings?.openai_max_tokens || 4096; } export function createRawPrompt(messages,api) { const h=globalThis.__mochiTestHost; if(h.formatRawPrompt) return h.formatRawPrompt(messages,api); return api==="openai" ? messages : messages.map(m=>(m.name || (m.role==="user" ? h.name1 : m.role==="assistant" ? h.name2 : ""))+": "+m.content).join("\\n"); }',
          'world-info': 'export const world_info_include_names = true; export function getWorldInfoSettings() { return { world_info: globalThis.__mochiTestWorldInfo }; }',
          personas: 'export let user_avatar = ""; export function selectTestPersona(id) { user_avatar = id; }',
          regex: 'export const regex_placement={USER_INPUT:1,AI_OUTPUT:2}; export function getRegexedString(text, placement, options) { return globalThis.__mochiTestHost.promptRegex?.(text, placement, options) ?? text; }',
          attachments: 'export async function appendFileContent(message,text) { const files = (message.extra?.files || []).map(file=>file.text); if (!files.length) return text; const prefix=files.join("\\n\\n")+"\\n\\n"; message.extra.fileLength=prefix.length; return prefix+text; }',
        }[args.path],
        loader: 'js',
      }));
    },
  }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=mochi-test-bundle.js').toString('base64')}`);

const listeners = new Map();
const calls = [];
let rawReply = '<phone_data>phone_data:\n  user:\n    nickname: Tester</phone_data>';
let namedReply = () => ({ content: rawReply });
let saves = 0;
const lifecycle = [];
const loadedBooks = [];
const worldBooks = {
  Random: { entries: { 1: { content: 'UNATTACHED_LORE', key: ['random'] } } },
  Chat: { entries: { 1: { content: 'CHAT_LORE', key: ['chat'], constant: true }, 2: { content: 'DISABLED_LORE', disable: true } } },
  Character: { entries: { 1: { content: 'CHARACTER_LORE', constant: true } } },
  Extra: { entries: { 1: { content: 'EXTRA_LORE', constant: true } } },
  Global: { entries: { 1: { content: 'GLOBAL_LORE', constant: true } } },
  Persona: { entries: { 1: { content: 'PERSONA_LORE', constant: true } } },
};
globalThis.__mochiTestWorldInfo = { globalSelect: [], charLore: [] };
globalThis.window = { localStorage: { getItem: () => null } };
globalThis.__mochiTestHost = {
  characters: [{ avatar: 'char.png', name: 'Character', chat: 'first', data: { name: 'Character', extensions: {} } }],
  characterId: 0,
  groupId: null,
  chatId: 'first',
  chat: [],
  chatMetadata: {},
  groups: [{ id: 'group-42', name: 'Test Group', members: ['char.png'], chat_id: 'group-chat' }],
  name1: 'User',
  name2: 'Character',
  substituteParams(text, { name1Override, name2Override, dynamicMacros = {} } = {}) {
    return text.replace(/\{\{(\w+)\}\}/gi, (match, key) => key.toLowerCase() === 'user' ? name1Override || this.name1
      : key.toLowerCase() === 'char' ? name2Override || this.name2 : dynamicMacros[key] ?? (key.toLowerCase() === 'time' ? 'HOST CLOCK' : match));
  },
  extensionSettings: { disabledExtensions: [] },
  powerUserSettings: {},
  eventTypes: { CHAT_CHANGED: 'chat_changed' },
  eventSource: {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeListener(name, fn) { listeners.get(name)?.delete(fn); },
    async emit(name, ...args) {
      lifecycle.push([name, ...args]);
      for (const fn of [...(listeners.get(name) ?? [])]) await fn(...args);
    },
  },
  updateChatMetadata(patch) { Object.assign(globalThis.__mochiTestHost.chatMetadata, patch); },
  saveMetadataDebounced() { saves++; },
  saveSettingsDebounced() { saves++; },
  saveChat() { saves++; lifecycle.push(['save']); return Promise.resolve(); },
  addOneMessage(message, options) { lifecycle.push(['render', message.name, options]); },
  updateMessageBlock(index) { lifecycle.push(['update', index]); },
  async printMessages() { lifecycle.push(['repaint']); },
  async executeSlashCommandsWithOptions(command) { lifecycle.push(['command', command]); return ''; },
  getThumbnailUrl(type, file) { return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`; },
  getWorldInfoNames() { return Object.keys(worldBooks); },
  async loadWorldInfo(name) { loadedBooks.push(name); return worldBooks[name] ?? null; },
  async generateRaw(options) { calls.push({ type: 'default', options }); return rawReply; },
  ConnectionManagerRequestService: {
    getSupportedProfiles() { return [{ id: 'profile-1', name: 'Saved Profile', model: 'test-model' }]; },
    async sendRequest(id, messages, maxTokens, options) {
      if (id !== 'profile-1') throw new Error('Profile not found');
      calls.push({ type: 'named', id, messages, maxTokens, options });
      return await namedReply(options);
    },
  },
};
const host = globalThis.__mochiTestHost;
const emit = (name) => { for (const fn of [...(listeners.get(name) ?? [])]) fn(); };
await api.stReady();
const id = api.activeChatId();
const phonePath = `/mochios-data/${encodeURIComponent(id)}`;
const sampleReply = (category) => category === 'data_generation'
  ? '<phone_data>phone_data:\n  user:\n    nickname: Tester</phone_data>'
  : `<${category === 'group_chats' ? 'groupchat_history' : 'privatechat_history'} target="${category === 'group_chats' ? 'Test Group' : 'Character'}">\nmessages:\n  - t: text\n    c: Hello back\n    time: "12:00"\n    sender:\n      name: Character\n</${category === 'group_chats' ? 'groupchat_history' : 'privatechat_history'}>`;
const generate = (category = 'data_generation', options) => api.request('POST', `${phonePath}/generate`, {
  category,
  contactName: category === 'group_chats' ? 'Test Group' : 'Character',
  userName: 'User',
  userPrompt: 'Hello',
  messages: [{ role: 'user', content: 'Keep {{user}} literal.' }],
}, options);
const choose = (profileId) => api.request('PUT', `/app-settings/${api.MOCHI_OS_SETTINGS_KEY}`, {
  value: JSON.stringify({ ...api.DEFAULT_MOCHI_OS_SETTINGS, connectionProfileId: profileId }),
});

assert.equal(api.normalizeMochiOsSettings({ theme: 'dark' }).connectionProfileId, null);
assert.equal(typeof api.st().generateRaw, 'function', 'API must come from live getContext, not module exports');
assert.equal((await api.listConnectionProfiles())[0].id, 'profile-1');
await choose(null);
for (const category of ['data_generation', 'private_chats', 'group_chats']) {
  rawReply = sampleReply(category);
  await generate(category);
  assert.equal(calls.at(-1).type, 'default', `${category} must follow default connection`);
  assert.equal(calls.at(-1).options.prompt[0].content, 'Keep «user}} literal.');
}

await choose('profile-1');
for (const category of ['data_generation', 'private_chats', 'group_chats']) {
  rawReply = sampleReply(category);
  const output = await generate(category);
  assert.equal(calls.at(-1).type, 'named', `${category} must use selected profile`);
  assert.equal(calls.at(-1).id, 'profile-1');
  assert.equal(calls.at(-1).messages[0].content, 'Keep «user}} literal.');
  assert.ok(output.rawOutput.length > 0);
  assert.ok(!host.extensionSettings.connectionManager, 'Named requests must not switch the host profile');
}

await api.request('PUT', phonePath, { rawYaml: 'phone_data:\n  user:\n    nickname: Saved' });
assert.ok(host.chatMetadata.mochios.phoneDataYaml.includes('Saved'));
assert.equal((await api.request('GET', phonePath)).phoneData.user.nickname, 'Saved');
await api.request('POST', `/chats/${encodeURIComponent(id)}/messages`, { role: 'assistant', content: 'Phone transcript' });
assert.equal(host.chat.at(-1).mes, 'Phone transcript');
assert.ok(saves > 0, 'Metadata, settings and transcript saves must reach ST');
assert.deepEqual(lifecycle.slice(-4).map((event) => event[0]), ['MESSAGE_RECEIVED', 'render', 'CHARACTER_MESSAGE_RENDERED', 'save']);

// An installed book is not an assignment. Both prompt-source paths must be empty.
const scanPath = `/lorebooks/scan/${encodeURIComponent(id)}`;
const chatPath = `/chats/${encodeURIComponent(id)}`;
assert.equal((await api.request('GET', `${chatPath}/messages`)).at(-1).content, 'Phone transcript', 'Message history must not be captured by the chat-detail route');
assert.equal((await api.request('GET', `/chats/${id}/messages`)).at(-1).content, 'Phone transcript', 'Raw owner/chat ids must remain supported');
let books = await api.request('GET', '/lorebooks');
assert.ok(books.every((book) => !book.isGlobal));
assert.deepEqual(await api.request('GET', scanPath), { entries: [], lorebookIds: [] });
assert.equal(loadedBooks.length, 0, 'Unattached books must not even be loaded');
let chat = await api.request('GET', chatPath);
const derive = (lorebooks, currentChat) => api.deriveActiveLorebookViews({
  activeLorebookIds: currentChat.metadata.activeLorebookIds ?? [], chat: currentChat,
  excludedLorebookIds: currentChat.metadata.excludedLorebookIds ?? [], dropExcluded: true, lorebooks,
});
assert.deepEqual(derive(books, chat), [], 'Fallback prompt source must not activate installed books');
const generateWithCachedLore = (category) => api.request('POST', `${phonePath}/generate`, {
  category, contactName: category === 'group_chats' ? 'Test Group' : 'Character', userPrompt: 'Hi',
  messages: [{ role: 'system', content: '<lorebook>UNATTACHED_LORE</lorebook>' }, { role: 'user', content: 'Hi' }],
});
for (const category of ['data_generation', 'private_chats', 'group_chats']) {
  rawReply = sampleReply(category);
  await generateWithCachedLore(category);
  assert.deepEqual(calls.at(-1).messages, [{ role: 'user', content: 'Hi' }], 'Unattached cached lore must not reach a provider');
}
host.chatMetadata.world_info = 'Chat';
host.characters[0].data.extensions.world = 'Character';
globalThis.__mochiTestWorldInfo = { globalSelect: ['Global'], charLore: [{ name: 'char', extraBooks: ['Extra'] }] };
host.powerUserSettings = { default_persona: 'persona.png', persona_description_lorebook: 'Persona' };
const assignedScan = await api.request('GET', scanPath);
assert.deepEqual(new Set(assignedScan.lorebookIds), new Set(['Chat', 'Character', 'Extra', 'Global', 'Persona']));
assert.ok(!assignedScan.entries.some((entry) => /UNATTACHED|DISABLED/.test(entry.content)));
books = await api.request('GET', '/lorebooks');
chat = await api.request('GET', chatPath);
assert.deepEqual(new Set(derive(books, chat).map((book) => book.id)), new Set(assignedScan.lorebookIds));
assert.equal(host.chatMetadata.activeLorebookIds, undefined, 'Reading assignments must not change chat metadata');
rawReply = sampleReply('data_generation');
await generateWithCachedLore('data_generation');
assert.ok(calls.at(-1).messages[0].content.includes('CHAT_LORE') && !calls.at(-1).messages[0].content.includes('UNATTACHED_LORE'), 'Sending refreshes the current configured lore instead of a stale cached block');
host.chatMetadata.excludedLorebookIds = ['Chat', 'Character', 'Extra', 'Global', 'Persona'];
assert.deepEqual((await api.request('GET', scanPath)).entries, []);
assert.deepEqual(derive(await api.request('GET', '/lorebooks'), await api.request('GET', chatPath)), []);
delete host.chatMetadata.world_info;
delete host.chatMetadata.excludedLorebookIds;
host.powerUserSettings = {};
host.characters[0].data.extensions = {};
globalThis.__mochiTestWorldInfo = { globalSelect: [], charLore: [] };
host.characters[0].data.character_book = { name: 'Random', entries: [{ content: 'EMBEDDED_LORE', enabled: true }] };
loadedBooks.length = 0;
const embedded = await api.request('GET', scanPath);
assert.deepEqual(embedded.lorebookIds, ['embedded:char.png']);
assert.equal(embedded.entries[0].content, 'EMBEDDED_LORE');
assert.equal(loadedBooks.length, 0, 'Embedded book names must not select a same-named library book');
host.characters[0].data.extensions.world = '';
assert.deepEqual((await api.request('GET', scanPath)).lorebookIds, [], 'An explicitly cleared card assignment must not reactivate its stale embedded copy');
delete host.characters[0].data.extensions.world;
host.characters[0].data.character_book = { name: 'Random' };
assert.deepEqual((await api.request('GET', scanPath)).lorebookIds, [], 'A book name without entries is not an attachment');
delete host.characters[0].data.character_book;

// A complete phone response must render/save ONCE, not generate ST turns per bubble.
host.characters.push({ avatar: 'other.png', name: 'Other', data: { name: 'Other', extensions: { world: 'Extra' } } });
await api.request('PUT', phonePath, { rawYaml: 'characters:\n  - id: other.png\n    name: Other\n    contactname: Nickname' });
const environment = '<environment>\ndate: Today\ntime: "12:00"\nweather: Rainy\n</environment>';
const privateContent = api.serializeChatHistoryYaml({ targetName: 'Nickname', recordType: 'private', environmentYaml: environment, messages: [
  { me: 1, type: 'text', text: 'Hi' },
  { me: 0, type: 'text', text: 'First reply' },
  { me: 0, type: 'text', text: 'Second reply' },
] });
const privateStart = host.chat.length;
const privateLifecycle = lifecycle.length;
const privateTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', characterId: 'char.png', content: privateContent });
assert.deepEqual(host.chat.slice(privateStart).map((message) => [message.name, message.is_user]), [['Other', false]]);
assert.equal(host.chat[privateStart].original_avatar, 'other.png');
assert.ok(host.chat[privateStart].force_avatar.includes('other.png'));
assert.equal(api.listMessages().at(-1).characterId, 'other.png');
assert.equal(api.parseChatHistoryBlocks(privateTurn.content)[0].messages.length, 3);
assert.equal(host.chat[privateStart].mes, privateContent, 'The entire transcript and environment survive unchanged');
assert.deepEqual(lifecycle.slice(privateLifecycle).map((event) => event[0]), ['MESSAGE_RECEIVED', 'render', 'CHARACTER_MESSAGE_RENDERED', 'save']);
assert.equal(host.chat[privateStart].extra.mochiosTurnId, undefined, 'New writes never use legacy split-turn metadata');

const groupContent = api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'group', environmentYaml: environment, members: 3, messages: [
  { me: 1, type: 'text', text: 'Hello group', sender: 'User' },
  { me: 0, type: 'text', text: 'Main reply', sender: 'Character' },
  { me: 0, type: 'text', text: 'Other reply', sender: 'Nickname' },
  { me: 0, type: 'text', text: 'NPC reply', sender: 'NPC' },
] });
const groupStart = host.chat.length;
assert.equal(api.mergeMochiChatHistoryBlocks([
  { type: 'private', target: 'Shared name', messages: [{ me: 0, type: 'text', text: 'Private only' }] },
  { type: 'group', target: 'Shared name', messages: [{ me: 0, type: 'text', text: 'Group only' }] },
]).length, 2, 'Private and group conversations with the same name must never be merged');
const groupTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', characterId: 'char.png', content: groupContent });
assert.deepEqual(host.chat.slice(groupStart).map((message) => [message.name, message.is_user]), [['Test Group', false]]);
assert.equal(api.mapMessage(groupStart).characterId, null, 'A multi-speaker transcript must not impersonate the selected card');
assert.deepEqual(api.parseChatHistoryBlocks(host.chat[groupStart].mes)[0].messages.map((message) => message.sender), ['User', 'Character', 'Nickname', 'NPC']);
assert.equal(api.listMessages(1)[0].id, groupTurn.id);
assert.equal(api.parseChatHistoryBlocks(api.listMessages(1)[0].content)[0].messages.length, 4, 'All senders remain in one group turn');
assert.equal(api.listMessages(1, groupTurn.id)[0].id, privateTurn.id, 'Pagination must use logical turn ids');
const routeMessages = await api.request('GET', `${chatPath}/messages?limit=1`);
assert.equal(routeMessages[0].id, groupTurn.id);
assert.equal(api.messageEndIndexOf(groupTurn.id), groupStart);
await api.request('POST', `${chatPath}/branch`, { upToMessageId: groupTurn.id });
assert.equal(lifecycle.at(-1)[1], `/branch-create ${groupStart}`, 'Branch includes the complete transcript');
const serializedChat = JSON.stringify(host.chat);
host.chat = JSON.parse(serializedChat);
assert.equal(api.parseChatHistoryBlocks(api.listMessages(1)[0].content)[0].messages.length, 4, 'Export/reload preserves the whole group turn');
const regenerated = api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'group', environmentYaml: environment, messages: [
  { me: 1, type: 'text', text: 'Hello group', sender: 'User' },
  { me: 0, type: 'text', text: 'Regenerated reply', sender: 'Other' },
] });
await api.request('POST', `${chatPath}/messages/${groupTurn.id}/swipes`, { content: regenerated });
assert.equal(api.listMessages(1)[0].swipeCount, 2);
assert.equal(host.chat.length, groupStart + 1, 'Regeneration replaces a swipe, not the ST message count');
assert.equal(host.chat[groupStart].swipe_info.length, 2, 'Native swipe metadata stays in sync');
assert.ok(host.chat[groupStart].swipe_info.every((swipe) => swipe.extra.mochiosId === groupTurn.id), 'Native swipe metadata retains the stable transcript identity');
host.chat[groupStart].extra = { ...host.chat[groupStart].swipe_info[0].extra };
assert.equal(api.mapMessage(groupStart).id, groupTurn.id, 'A host-native swipe restores the same logical message id');
await api.request('PUT', `${chatPath}/messages/${groupTurn.id}/active-swipe`, { index: 0 });
assert.equal(api.listMessages(1)[0].activeSwipeIndex, 0);
assert.equal(host.chat.length, groupStart + 1);
const edited = groupContent.replace('Main reply', 'Edited main reply');
await api.request('PUT', `${chatPath}/messages/${groupTurn.id}`, { content: edited });
assert.ok(host.chat[groupStart].mes.includes('Edited main reply'));
assert.equal(host.chat[groupStart].swipes[0], edited, 'Native ST swipe and edit use the same canonical content');
await api.request('DELETE', `${chatPath}/messages/${groupTurn.id}`);
assert.equal(host.chat.length, groupStart, 'Deleting a phone turn removes exactly one ST message');
assert.equal(api.listMessages(1)[0].id, privateTurn.id, 'Other threads stay intact');

await api.request('DELETE', `${chatPath}/messages/${privateTurn.id}`);
assert.equal(host.chat.length, privateStart);
const prose = `Unrelated roleplay context.\n\n${groupContent}\n\nKeep this ending.`;
const proseTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: prose, characterId: 'char.png' });
assert.equal(host.chat.at(-1).mes, prose, 'Ordinary roleplay prose around a widget must stay intact');

const reactionContent = api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'group', environmentYaml: environment, messages: [
  { me: 0, type: 'sticker', text: 'saved_sticker', sender: 'Character' },
  { me: 0, type: 'text', text: 'Same text', sender: 'Other' },
] });
await api.request('PUT', `${chatPath}/messages/${proseTurn.id}`, { content: `Before.\n${reactionContent}\nAfter.` });
const reactions = [{ emoji: '❤️', by: ['user'] }];
await api.request('PATCH', `${chatPath}/messages/${proseTurn.id}/phone-reactions`, { targetName: 'Test Group', recordType: 'group', recordIndex: 0, itemIndex: 0, reactions });
assert.ok(host.chat.at(-1).mes.startsWith('Before.') && host.chat.at(-1).mes.endsWith('After.'), 'A bubble action preserves surrounding roleplay prose');
assert.ok(host.chat.at(-1).mes.includes('weather: Rainy'));
const reacted = api.parseChatHistoryBlocks(host.chat.at(-1).mes)[0].messages;
assert.deepEqual(reacted[0].reactions, reactions, 'Sticker reactions round-trip in the targeted transcript item');
assert.equal(reacted[1].reactions, undefined, 'Other senders are untouched by a bubble action');
const editPath = `${chatPath}/messages/${proseTurn.id}/phone-message`;
await api.request('PATCH', editPath, { targetName: 'Test Group', recordType: 'group', recordIndex: 0, itemIndex: 1, content: 'Edited other sender' });
const targetedEdit = api.parseChatHistoryBlocks(host.chat.at(-1).mes)[0].messages;
assert.equal(targetedEdit[1].text, 'Edited other sender');
assert.deepEqual(targetedEdit[0].reactions, reactions, 'Editing preserves other bubbles and their reactions');
assert.ok(host.chat.at(-1).mes.startsWith('Before.') && host.chat.at(-1).mes.endsWith('After.') && host.chat.at(-1).mes.includes('weather: Rainy'), 'Editing preserves prose and environment');
await api.request('PATCH', editPath, { targetName: 'Test Group', recordType: 'group', recordIndex: 0, itemIndex: 0, delete: true });
assert.deepEqual(api.parseChatHistoryBlocks(host.chat.at(-1).mes)[0].messages.map((item) => item.text), ['Edited other sender'], 'Deleting a sticker changes only the selected ID-free transcript item');
await api.request('PATCH', editPath, { targetName: 'Test Group', recordType: 'group', recordIndex: 0, itemIndex: 0, delete: true });
assert.ok(!host.chat.at(-1).mes.includes('chat_history') && host.chat.at(-1).mes.startsWith('Before.') && host.chat.at(-1).mes.endsWith('After.'), 'Deleting the final bubble retains unrelated roleplay prose');
await api.request('DELETE', `${chatPath}/messages/${proseTurn.id}`);

const aliasContent = api.serializeChatHistoryYaml({ targetName: 'Character', recordType: 'private', date: 'Day 2', time: '12:04', environmentYaml: environment, messages: [
  { me: 0, type: 'image', rawItem: { c: 'A saved photo', url: 'https://example.test/photo.png', extra: 'Keep this field' }, t: '12:04' },
  { me: 0, type: 'quote', text: 'Quote reply', rawItem: { quote: { name: 'User', t: 'text', c: 'Quoted text' } }, t: '12:05' },
] }).replace('\ndate:', '\ncontactname: Nickname\ndate:');
const aliasTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: aliasContent });
await api.request('PATCH', `${chatPath}/messages/${aliasTurn.id}/phone-reactions`, { targetName: 'Nickname', recordType: 'private', recordIndex: 0, itemIndex: 0, reactions });
const aliasRecord = api.parseChatHistoryBlocks(host.chat.at(-1).mes)[0];
assert.equal(aliasRecord.target, 'Character');
assert.equal(aliasRecord.contactname, 'Nickname', 'Bubble actions preserve a private target and distinct display alias');
assert.deepEqual(api.locateMochiMessageInRoleplay({ roleplayMessages: [{ id: aliasTurn.id, role: 'assistant', content: host.chat.at(-1).mes }], targetName: 'Nickname', recordType: 'private', threadIndex: 1, threadMessageId: api.mochiRoleplayBubbleId(aliasTurn.id, 0, 1) }), { roleplayMessageId: aliasTurn.id, recordIndex: 0, targetName: 'Character', indexInRecord: 1, recordStartIndex: 0, recordHasUserMessages: false }, 'Renamed contacts resolve to the same complete record without serialized bubble ids');
const renamedLocation = api.locateMochiMessageInRoleplay({ roleplayMessages: [{ id: aliasTurn.id, role: 'assistant', content: host.chat.at(-1).mes }], targetName: 'New display alias', recordType: 'private', threadIndex: 1, threadMessageId: api.mochiRoleplayBubbleId(aliasTurn.id, 0, 1) });
assert.equal(renamedLocation.targetName, 'Character', 'Runtime source addresses survive a contact display-name change');
assert.equal(api.locateMochiMessageInRoleplay({ roleplayMessages: [{ id: aliasTurn.id, role: 'assistant', content: host.chat.at(-1).mes }], targetName: 'Nickname', recordType: 'private', threadIndex: 1, threadMessageId: api.mochiRoleplayBubbleId('deleted-turn', 0, 1) }), null, 'A stale runtime source never edits another bubble by position');
await api.request('PATCH', `${chatPath}/messages/${aliasTurn.id}/phone-message`, { targetName: renamedLocation.targetName, recordType: 'private', recordIndex: renamedLocation.recordIndex, itemIndex: renamedLocation.indexInRecord, content: 'Edited quoted reply' });
assert.equal(api.parseChatHistoryBlocks(host.chat.at(-1).mes)[0].messages[1].text, 'Edited quoted reply');
assert.equal(aliasRecord.date, 'Day 2');
assert.equal(aliasRecord.messages[0].rawItem.c, 'A saved photo', 'Reacting never serializes a rendered Photo marker as content');
assert.equal(aliasRecord.messages[0].rawItem.url, 'https://example.test/photo.png');
assert.equal(aliasRecord.messages[0].rawItem.extra, 'Keep this field');
assert.equal(aliasRecord.messages[1].rawItem.quote.c, 'Quoted text');
await api.request('DELETE', `${chatPath}/messages/${aliasTurn.id}`);

// Existing split turns remain readable; the next explicit edit collapses only that turn.
const legacyStart = host.chat.length;
const legacyId = 'legacy-turn';
host.chat.push(...api.splitPhoneTranscript(groupContent).map((part, index) => ({ name: part.name, is_user: part.isUser, mes: part.content, extra: { mochiosTurnId: legacyId, mochiosTurnPart: index, ...(index === 0 ? { mochiosId: legacyId } : {}) } })));
const untouchedLegacy = JSON.stringify(host.chat.slice(legacyStart));
assert.equal(api.parseChatHistoryBlocks(api.listMessages(1)[0].content)[0].messages.length, 4);
assert.equal(JSON.stringify(host.chat.slice(legacyStart)), untouchedLegacy, 'Compatibility reads do not rewrite existing history');
await api.request('PATCH', `${chatPath}/messages/${legacyId}/phone-reactions`, { targetName: 'Test Group', recordType: 'group', itemIndex: 3, reactions });
assert.equal(host.chat.length, legacyStart + 1, 'A reaction consolidates only its explicitly edited legacy turn');
assert.deepEqual(api.parseChatHistoryBlocks(api.listMessages(1)[0].content)[0].messages[3].reactions, reactions, 'Legacy bubble actions read the full logical record, not just its first split message');
await api.request('POST', `${chatPath}/messages/${legacyId}/swipes`, { content: regenerated });
assert.equal(host.chat.length, legacyStart + 1, 'Explicit legacy regeneration consolidates the old split turn');
assert.equal(api.listMessages(1)[0].id, legacyId);
assert.equal(api.listMessages(1)[0].swipeCount, 2);
await api.request('PUT', `${chatPath}/messages/${legacyId}/active-swipe`, { index: 0 });
assert.equal(api.parseChatHistoryBlocks(api.listMessages(1)[0].content)[0].messages.length, 4);
await api.request('DELETE', `${chatPath}/messages/${legacyId}`);
assert.equal(host.chat.length, legacyStart);

// Imported ids remain readable, but new serialization must not add them.
const repeatedId = (text) => api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'group', messages: [{ me: 0, type: 'text', text, sender: 'Character' }] }).replace('  - t: text', '  - id: msg_001\n    t: text');
assert.deepEqual(api.parseChatHistoryBlocks(groupContent.replace('<chat_history target="Test Group" type="group">', '<groupchat_history target="Test Group">')), api.parseChatHistoryBlocks(groupContent), 'Older group records without a type attribute keep all attributed bubbles');
assert.equal(api.locateMochiMessageInRoleplay({ roleplayMessages: [{ id: 'older', role: 'assistant', content: repeatedId('Older') }, { id: 'newer', role: 'assistant', content: repeatedId('Newer') }], targetName: 'Test Group', recordType: 'group', threadIndex: 1, threadMessageId: 'msg_001' }).roleplayMessageId, 'newer', 'Repeated imported bubble ids must not route edits to an older turn');
const sameRecordIds = repeatedId('First repeated id').replace('\n</groupchat_history>', '\n  - id: msg_001\n    t: text\n    c: Second repeated id\n    sender: {name: Other}\n</groupchat_history>');
assert.equal(api.locateMochiMessageInRoleplay({ roleplayMessages: [{ id: 'duplicates', role: 'assistant', content: sameRecordIds }], targetName: 'Test Group', recordType: 'group', threadIndex: 1, threadMessageId: 'msg_001' }).indexInRecord, 1, 'Repeated ids inside one record never select its first bubble instead of the clicked bubble');
const duplicateTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: sameRecordIds + '\n' + environment });
await api.request('PATCH', `${chatPath}/messages/${duplicateTurn.id}/phone-message`, { targetName: 'Test Group', recordType: 'group', recordIndex: 0, itemIndex: 1, itemId: 'msg_001', content: 'Edited second duplicate' });
assert.deepEqual(api.parseChatHistoryBlocks(host.chat.at(-1).mes)[0].messages.map((item) => item.text), ['First repeated id', 'Edited second duplicate']);
await api.request('DELETE', `${chatPath}/messages/${duplicateTurn.id}`);

// One roleplay message may contain several records, even for the same thread.
const sharedPrivate = api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'private', environmentYaml: environment, messages: [{ me: 0, type: 'text', text: 'Private stays untouched' }] });
const sameGroup = (text) => api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'group', environmentYaml: environment, messages: [{ me: 0, type: 'text', text, sender: 'Character' }] });
const multipleContent = `Before all records.\n${sharedPrivate}\n${sameGroup('Earlier same thread')}\n${sameGroup('Later same thread')}\nAfter all records.`;
const multiTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: multipleContent });
const multiLocation = api.locateMochiMessageInRoleplay({ roleplayMessages: [{ id: multiTurn.id, role: 'assistant', content: multipleContent }], targetName: 'Test Group', recordType: 'group', threadIndex: 1, threadMessageId: api.mochiRoleplayBubbleId(multiTurn.id, 2, 0) });
assert.equal(multiLocation.recordIndex, 2, 'Location counts all records while the thread offset counts only its own kind');
assert.equal(multiLocation.recordStartIndex, 1);
await api.request('PATCH', `${chatPath}/messages/${multiTurn.id}/phone-message`, { targetName: multiLocation.targetName, recordType: 'group', recordIndex: multiLocation.recordIndex, itemIndex: multiLocation.indexInRecord, content: 'Edited later same thread' });
assert.deepEqual(api.parseChatHistoryBlocks(host.chat.at(-1).mes).map((block) => block.messages[0].text), ['Private stays untouched', 'Earlier same thread', 'Edited later same thread']);
assert.equal(host.chat.at(-1).swipes[0], host.chat.at(-1).mes, 'The selected native swipe receives the targeted edit');
assert.ok(host.chat.at(-1).mes.startsWith('Before all records.') && host.chat.at(-1).mes.endsWith('After all records.') && host.chat.at(-1).mes.includes('weather: Rainy'));
const beforeFailedEdit = host.chat.at(-1).mes;
await assert.rejects(api.request('PATCH', `${chatPath}/messages/${multiTurn.id}/phone-message`, { targetName: 'Test Group', recordType: 'group', recordIndex: 7, itemIndex: 0, content: 'Do not silently lose this' }), /could not be found/);
assert.equal(host.chat.at(-1).mes, beforeFailedEdit, 'An invalid saved target fails visibly without editing another record');
await assert.rejects(api.request('PATCH', `${chatPath}/messages/${multiTurn.id}/phone-message`, { targetName: 'Test Group', recordType: 'group', recordIndex: 2, itemIndex: 0, content: 'Stale edit', expectedContent: multipleContent }), /saved record changed/);
assert.equal(host.chat.at(-1).mes, beforeFailedEdit, 'A stale edit snapshot cannot change an ID-free record after another edit');
await api.request('DELETE', `${chatPath}/messages/${multiTurn.id}`);

// Echoed user flags and environments survive canonical generation without inventing user speech.
rawReply = '<groupchat_history target="Test Group">\nmessages:\n  - t: text\n    c: Echoed input\n    {{user}}: true\n    sender: {name: User}\n  - t: text\n    c: Valid reply\n    sender: {name: Character}\n  - t: text\n    c: Invented user speech\n    sender: {name: User}\n</groupchat_history>\n' + environment;
const canonical = await generate('group_chats');
assert.ok(canonical.rawOutput.includes('weather: Rainy'));
const canonicalItems = api.parseChatHistoryBlocks(canonical.rawOutput)[0].messages;
assert.deepEqual(canonicalItems.map((item) => [item.me, item.text]), [[1, 'Echoed input'], [0, 'Valid reply']]);
assert.deepEqual(api.parseMochiChatResponse(canonical.rawOutput).map((item) => [item.rawItem['{{user}}'] === true, item.text, item.sender]), [[true, 'Echoed input', 'User'], [false, 'Valid reply', 'Character']], 'Incoming UI parser must preserve user flags and group senders in canonical YAML');
const continued = await api.request('POST', `${phonePath}/generate`, {
  category: 'group_chats', contactName: 'Test Group', userName: 'User', continuationOnly: true,
  messages: [{ role: 'user', content: 'Continue the group conversation.' }],
});
assert.deepEqual(api.parseChatHistoryBlocks(continued.rawOutput)[0].messages.map((item) => [item.me, item.text]), [[0, 'Valid reply']]);
const authored = [{ id: 'sent-sticker', me: 1, type: 'sticker', text: 'saved_sticker', t: '12:03' }, { id: 'sent-emoji', me: 1, type: 'text', text: '😀\nSecond line', t: '12:04' }];
const withMedia = await api.request('POST', `${phonePath}/generate`, { category: 'group_chats', contactName: 'Test Group', userName: 'User', userMessages: authored, messages: [{ role: 'user', content: '[Sticker] saved_sticker\n[Text] 😀\nSecond line' }] });
assert.deepEqual(api.parseChatHistoryBlocks(withMedia.rawOutput)[0].messages.slice(0, 2).map((item) => [item.me, item.type, item.text]), authored.map((item) => [item.me, item.type, item.text]), 'Authored media/emoji inputs survive without being echoed as duplicate user turns');
const withMediaAgain = await api.request('POST', `${phonePath}/generate`, { category: 'group_chats', contactName: 'Test Group', userName: 'User', continuationOnly: true, userMessages: [], messages: [{ role: 'user', content: 'Continue.' }] });
assert.ok(api.parseChatHistoryBlocks(withMedia.rawOutput)[0].messages.every((item) => item.id === undefined) && api.parseChatHistoryBlocks(withMediaAgain.rawOutput)[0].messages.every((item) => item.id === undefined), 'Generated turns never add ids from authored runtime keys or provider replies');
const idFree = api.serializeChatHistoryYaml({ targetName: 'Character', recordType: 'private', messages: [{ id: 'runtime-only', me: 1, type: 'text', text: 'No YAML id' }, { id: 'another-runtime-key', me: 0, type: 'text', rawItem: { id: 'provider-id', c: 'No provider id' } }] });
assert.ok(!/^\s*(?:-\s*)?id:/m.test(idFree), 'Serialization strips message ids without changing message content');
const senderIdFree = api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'group', messages: [{ me: 0, type: 'text', text: 'Attributed by name', sender: 'Other', rawItem: { c: 'Attributed by name', sender: { name: 'Other', id: 'other.png' } } }] });
assert.ok(!/^\s*(?:-\s*)?id:/m.test(senderIdFree) && senderIdFree.includes('name: Other'), 'New group transcripts attribute senders by name without adding ids');
rawReply = '<privatechat_history target="Character" type="private">\nmessages:\n  - t: text\n    c: Private reply\n</privatechat_history>';
const aliasGenerated = await api.request('POST', `${phonePath}/generate`, { category: 'private_chats', characterName: 'Character', contactName: 'Nickname', userName: 'User', userMessages: authored, messages: [{ role: 'user', content: 'Hi' }] });
assert.equal(api.parseChatHistoryBlocks(aliasGenerated.rawOutput)[0].target, 'Character');
assert.equal(api.parseChatHistoryBlocks(aliasGenerated.rawOutput)[0].contactname, undefined, 'New private output uses target only; aliases stay in phone_data');
assert.ok(!/^contactname:|^name:/m.test(aliasGenerated.rawOutput), 'Private serialization does not invent a name field');

const datedPrivate = '<privatechat_history target="Character" type="private">\ndate: Day 7\ntime: "18:42"\nmessages:\n  - t: text\n    c: Target-only reply\n    time: "18:43"\n</privatechat_history>\n<environment>\ndate: Day 7\ntime: "18:44"\nweather: Snowy\n</environment>';
rawReply = datedPrivate;
const targetOnly = await api.request('POST', `${phonePath}/generate`, { category: 'private_chats', characterName: 'Character', contactName: 'Nickname', continuationOnly: true, messages: [{ role: 'user', content: 'Continue.' }] });
assert.equal(api.parseChatHistoryBlocks(targetOnly.rawOutput)[0].date, 'Day 7');
assert.equal(api.parseChatHistoryBlocks(targetOnly.rawOutput)[0].time, '18:42', 'The record clock, not a wall-clock fallback, is retained');
const widgetRecord = api.parseMochiPrivateChatContent(targetOnly.rawOutput).find((part) => part.type === 'widget').value;
assert.equal(widgetRecord.chat.target, 'Character', 'Inline widgets accept the new target-only envelope');
assert.equal(widgetRecord.chat.messages[0].text, 'Target-only reply');
const targetOnlyTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: targetOnly.rawOutput });
await api.request('PATCH', `${chatPath}/messages/${targetOnlyTurn.id}/phone-message`, { targetName: 'Character', recordType: 'private', recordIndex: 0, itemIndex: 0, content: 'Edited target-only reply' });
assert.ok(!/^contactname:|^name:/m.test(host.chat.at(-1).mes), 'Editing target-only output never restores removed alias fields');
await api.request('DELETE', `${chatPath}/messages/${targetOnlyTurn.id}`);

assert.ok(!api.DEFAULT_FORMAT_GUIDES.formatGuide.privateChat.includes('contactname:'), 'The default private guide uses the new output format');
const guides = { ...api.DEFAULT_FORMAT_GUIDES, formatGuide: { ...api.DEFAULT_FORMAT_GUIDES.formatGuide,
  privateChat: api.DEFAULT_FORMAT_GUIDES.formatGuide.privateChat.replace('\ndate:', '\ncontactname: {{contactname}}\ndate:'),
  data: 'characters:\n  - contactname: Keep data aliases\n    socialhandle: {{Character username}}',
  groupChat: 'contactname: Do not edit another guide',
} };
const normalizedGuides = api.normalizeMochiFormatGuides(guides);
assert.ok(!normalizedGuides.formatGuide.privateChat.includes('contactname:'));
assert.equal(normalizedGuides.formatGuide.data, guides.formatGuide.data, 'Guide migration is restricted to private output');
assert.equal(normalizedGuides.formatGuide.groupChat, guides.formatGuide.groupChat);
assert.ok(guides.formatGuide.privateChat.includes('contactname:'), 'Migration does not mutate saved input');
assert.equal(api.mochiSocialHandle({ socialhandle: '@new_handle', screenName: 'old_screen', nickname: 'old_nickname' }), '@new_handle');
assert.equal(api.mochiSocialHandle({ socialhandle: '', screenName: 'old_screen' }), '', 'A cleared social handle stays cleared');
assert.equal(api.mochiSocialHandle({ screenName: 'legacy_screen' }), 'legacy_screen');
assert.equal(api.mochiSocialHandle({ nickname: 'legacy_nickname' }), 'legacy_nickname');
assert.match(api.formatFriendInfo({ name: 'Character', contactname: 'Nickname', socialhandle: '@social', email: 'example@example.test', onlineStyle: 'Short replies' }), /Name: Character\nContact Name: Nickname\nSocial Handle: @social/);

// A new phone follows the live roleplay persona, not an old global phone choice.
host.powerUserSettings = {
  personas: { 'first.png': 'First Persona', 'selected avatar.png': 'Chosen Persona' },
  persona_descriptions: { 'first.png': { title: 'Default title' }, 'selected avatar.png': { title: 'Roleplay title', description: 'Chosen description' } },
  default_persona: 'first.png',
};
host.chatMetadata.persona = 'first.png';
api.selectTestPersona('selected avatar.png');
assert.equal(api.activePersonaId(), 'selected avatar.png', 'The live selected persona takes precedence over a chat/default lock');
const chosenPersona = api.listPersonas().find((persona) => persona.isActive);
assert.equal(chosenPersona.name, 'Chosen Persona');
assert.equal(chosenPersona.title, 'Roleplay title');
assert.equal(chosenPersona.avatarPath, '/User Avatars/selected%20avatar.png');
assert.equal((await api.request('GET', chatPath)).personaId, chosenPersona.id);
const personaSettingsBefore = JSON.stringify(host.extensionSettings);
await api.request('PUT', `${chatPath}/mochi-persona`, { personaId: 'first.png' });
assert.equal(host.chatMetadata.mochios.linkedPersonaId, 'first.png');
assert.equal(api.activePersonaId(), chosenPersona.id, 'A phone-specific choice does not change the roleplay persona');
assert.equal(JSON.stringify(host.extensionSettings), personaSettingsBefore, 'Phone persona choices are not saved globally');
await assert.rejects(api.request('PUT', `${chatPath}/mochi-persona`, { personaId: 'missing.png' }), /no longer exists/);
const previousMetadata = host.chatMetadata;
host.chatMetadata = {};
assert.equal((await api.request('GET', chatPath)).metadata.mochios?.linkedPersonaId, undefined, 'Another roleplay does not inherit the previous phone choice');
host.chatMetadata = previousMetadata;
delete host.chatMetadata.persona;
delete host.chatMetadata.mochios.linkedPersonaId;
api.selectTestPersona('');
host.powerUserSettings = {};

// Every preset category shares chronological role messages and the same markers.
const savedPromptChat = host.chat;
const savedPromptMetadata = host.chatMetadata;
host.chatMetadata = { scenario: 'Chat scenario override' };
const ignore = Symbol('ignore');
host.symbols = { ignore };
host.chat = [
  { name: 'Character', is_user: false, mes: 'Greeting for {{user}}', extra: {} },
  { name: 'User', is_user: true, mes: 'User turn', extra: { files: [{ text: 'Attached file content' }], media: [{ append_title: true, title: 'Media title' }] } },
  { name: 'Character', is_user: false, mes: 'OLD TEXT', extra: {} },
  { name: 'Narrator', is_user: false, mes: 'Narration', extra: { type: 'narrator' } },
  { name: 'System', is_system: true, mes: 'Hidden system message', extra: {} },
  { name: 'Character', is_user: false, mes: 'Ignored message', extra: { [ignore]: true } },
  { name: 'Character', is_user: false, mes: datedPrivate, extra: {} },
];
const regexCalls = [];
host.promptRegex = (text, placement, options) => { regexCalls.push({ text, placement, options }); return text.replace('OLD TEXT', 'Regexed assistant turn'); };
host.chatCompletionSettings = { names_behavior: 0, new_chat_prompt: '[Start a new chat]', new_example_chat_prompt: '[Start example]', personality_format: 'Personality: {{personality}}', scenario_format: 'Scenario: {{scenario}}', wi_format: 'Lore: {0}' };
host.extensionPrompts = {
  '1_memory': { value: 'Rolling summary', role: 0, position: 1, depth: 2 },
  '2_floating_prompt': { value: 'Author note', role: 0, position: 1, depth: 1 },
  agent: { value: 'Agent output', role: 1, position: 0 },
  blocked: { value: 'Filtered extension', role: 0, position: 0, filter: async () => false },
  excluded: { value: 'Disabled extension', role: 0, position: -1 },
  customDepthWI_0_0: { value: 'Stale depth lore', role: 0, position: 1, depth: 0 },
};
const wiCalls = [];
const originalAuthorNote = { ...host.extensionPrompts['2_floating_prompt'] };
const injectedAuthorNote = 'AN_BEFORE\nAuthor note\nAN_AFTER';
host.getWorldInfoPrompt = async (...args) => {
  wiCalls.push(args);
  host.extensionPrompts['2_floating_prompt'] = { ...host.extensionPrompts['2_floating_prompt'], value: injectedAuthorNote };
  return { worldInfoBefore: 'BEFORE_LORE', worldInfoAfter: 'AFTER_LORE', worldInfoExamples: [{ position: 0, content: '<START>\nUser: Lore example\nCharacter: Lore example answer' }],
    worldInfoDepth: [{ depth: 0, role: 0, entries: ['DEPTH_ZERO'] }, { depth: 2, role: 0, entries: ['DEPTH_TWO'] }], anBefore: ['AN_BEFORE'], anAfter: ['AN_AFTER'] };
};
const marker = (type, options = {}) => ({ identifier: type, isMarker: true, enabled: true, ...options });
const promptInput = {
  blocks: [{ role: 'system', content: 'Preset start' }, marker('world_info_before'), marker('character'), marker('persona'), marker('dialogue_examples'), marker('chat_history'),
    marker('chat_summary'), marker('world_info_after'), marker('lorebook'), marker('id_macro_cards'), marker('agent_data'), marker('format_guides'), marker('user_input'), { role: 'assistant', content: 'Prefill' }],
  characters: [{ id: 'char.png', name: 'Character', data: { name: 'Character', description: 'Card description for {{user}}', personality: 'Card personality', scenario: 'Card scenario', first_mes: 'Must not duplicate greeting', mes_example: '<START>\n{{user}}: Example question\n{{char}}: Example answer' } }],
  persona: { id: 'persona.png', name: 'User', description: 'Persona description' }, userName: 'User', characterName: 'Character', userInput: 'New task',
  formatGuides: 'date: {{Time}}\n{{user}}: true', idMacroCards: 'Social Handle: @social', historyConfig: { maxMessages: 0, includeSystem: false, includeUser: true, tagFilters: [] },
};
const prompt = await api.buildMochiPresetMessages(promptInput);
const promptContent = prompt.map((message) => message.content);
assert.equal(promptContent[0], 'Preset start');
assert.ok(promptContent.includes('Card description for User') && promptContent.includes('Personality: Card personality') && promptContent.includes('Scenario: Chat scenario override'));
assert.ok(promptContent.includes('Persona description'));
assert.equal(promptContent.filter((content) => content === 'Lore: BEFORE_LORE').length, 1, 'Before lore appears once, not in both markers');
assert.equal(promptContent.filter((content) => content === 'Lore: AFTER_LORE').length, 1, 'After lore appears once even with a legacy combined marker');
assert.equal(promptContent.filter((content) => content === 'Greeting for User').length, 1);
assert.ok(!promptContent.some((content) => /Must not duplicate greeting|Hidden system message|Ignored message|Stale depth lore|Filtered extension|Disabled extension/.test(content)));
assert.deepEqual(prompt.find((message) => message.content.includes('User turn')), { role: 'user', content: 'Attached file content\n\nUser turn\n\nMedia title' });
assert.equal(host.chat[1].extra.fileLength, undefined, 'Preparing attachments does not modify saved messages');
assert.equal(prompt.find((message) => message.content === 'Narration').role, 'system');
assert.equal(prompt.find((message) => message.content === datedPrivate).role, 'assistant', 'Structured phone records remain an assistant turn, not a system history blob');
assert.ok(promptContent.indexOf('DEPTH_TWO') < promptContent.indexOf('Narration') && promptContent.indexOf('Narration') < promptContent.indexOf(injectedAuthorNote) && promptContent.indexOf(injectedAuthorNote) < promptContent.indexOf(datedPrivate) && promptContent.indexOf(datedPrivate) < promptContent.indexOf('DEPTH_ZERO'), 'Depth lore uses original chronology even after other injections');
assert.equal(promptContent.filter((content) => content.includes('AN_BEFORE')).length, 1, 'Author-note lore stays in the request exactly once');
assert.deepEqual(host.extensionPrompts['2_floating_prompt'], originalAuthorNote, 'A phone scan restores the roleplay Author\'s Note');
assert.equal(promptContent.filter((content) => content === 'Rolling summary').length, 1, 'The summary marker does not duplicate the depth memory');
assert.equal(prompt.find((message) => message.content === 'Agent output').role, 'user');
assert.deepEqual(prompt.filter((message) => message.name).map((message) => [message.role, message.name]), [['system', 'example_user'], ['system', 'example_assistant'], ['system', 'example_user'], ['system', 'example_assistant']]);
assert.ok(promptContent.includes('date: {{Time}}\n{{user}}: true'), 'Format placeholders and YAML user flags stay literal');
assert.deepEqual(prompt.slice(-2), [{ role: 'user', content: 'New task' }, { role: 'assistant', content: 'Prefill' }]);
assert.ok(regexCalls.every((call) => call.options.isPrompt) && regexCalls.find((call) => call.text === datedPrivate).options.depth === 0);
assert.equal(wiCalls[0][0][0], 'New task');
assert.ok(wiCalls[0][0].includes('User: Attached file content\n\nUser turn\n\nMedia title'), 'World-info scanning includes speaker names like ST');
assert.equal(wiCalls[0][3].personaDescription, 'Persona description');
assert.equal(wiCalls[0][3].scenario, 'Chat scenario override');
const noHistory = await api.buildMochiPresetMessages({ ...promptInput, blocks: [marker('chat_history', { enabled: false }), { role: 'assistant', content: 'Prefill' }] });
assert.deepEqual(noHistory, [{ role: 'user', content: 'New task' }, { role: 'assistant', content: 'Prefill' }], 'A disabled history marker stays disabled; fallback input precedes only the trailing prefill');
const repeatedHistory = await api.buildMochiPresetMessages({ ...promptInput, blocks: [marker('chat_history'), marker('chat_history'), marker('user_input')] });
assert.equal(repeatedHistory.filter((message) => message.content === 'Greeting for User').length, 1, 'Duplicate marker blocks never replay a roleplay turn twice');
const excludedTurn = api.listMessages().at(-1).id;
const regenerationPrompt = await api.buildMochiPresetMessages({ ...promptInput, blocks: [marker('chat_history')], excludedMessageIds: [excludedTurn] });
assert.ok(!regenerationPrompt.some((message) => message.content === datedPrivate), 'Regeneration excludes the turn being replaced');

// Restore only the scanner's exact note mutation, never a user edit or a new chat.
const savedWiScanner = host.getWorldInfoPrompt;
const noteScanInput = { history: [], userInput: '', personaDescription: '', characters: [] };
const noteScanResult = { worldInfoBefore: '', worldInfoAfter: '', anBefore: ['Before note'], anAfter: ['After note'] };
for (const noteValue of ['', '\nAuthor note\n', 'Author note']) {
  const original = { ...originalAuthorNote, value: noteValue, filter: async () => true };
  host.extensionPrompts['2_floating_prompt'] = original;
  const injected = `Before note\n${noteValue}\nAfter note`.replace(/(^\n)|(\n$)/g, '');
  host.getWorldInfoPrompt = async () => {
    host.extensionPrompts['2_floating_prompt'] = { ...original, value: injected, filter: null };
    return noteScanResult;
  };
  const scanned = await api.getMochiWorldInfoPrompt(noteScanInput);
  assert.deepEqual(host.extensionPrompts['2_floating_prompt'], original, 'Empty notes, newlines and original note metadata survive a dry scan');
  assert.equal(scanned.authorNote.value, injected, 'The request retains the exact native Author\'s Note/lore combination');
}
host.extensionPrompts['2_floating_prompt'] = { ...originalAuthorNote };
host.getWorldInfoPrompt = async () => {
  host.extensionPrompts['2_floating_prompt'] = { ...originalAuthorNote, value: 'User edited the note during scanning' };
  return noteScanResult;
};
assert.equal((await api.getMochiWorldInfoPrompt(noteScanInput)).authorNote, undefined);
assert.equal(host.extensionPrompts['2_floating_prompt'].value, 'User edited the note during scanning', 'A concurrent note edit is not overwritten');
host.extensionPrompts['2_floating_prompt'] = { ...originalAuthorNote };
const savedScanChatId = host.chatId;
host.getWorldInfoPrompt = async () => {
  host.chatId = 'switched-during-wi-scan';
  host.extensionPrompts['2_floating_prompt'] = { ...originalAuthorNote, value: 'Before note\nAuthor note\nAfter note' };
  return noteScanResult;
};
assert.equal((await api.getMochiWorldInfoPrompt(noteScanInput)).authorNote, undefined);
assert.equal(host.extensionPrompts['2_floating_prompt'].value, 'Before note\nAuthor note\nAfter note', 'Switching chats prevents restoration even when the host reuses its chat array');
host.chatId = savedScanChatId;
host.extensionPrompts['2_floating_prompt'] = { ...originalAuthorNote };
host.getWorldInfoPrompt = async () => {
  host.extensionPrompts['2_floating_prompt'] = { ...originalAuthorNote, value: 'A newer note after a scanner failure' };
  throw new Error('Scanner failure');
};
await assert.rejects(api.getMochiWorldInfoPrompt(noteScanInput), /Scanner failure/);
assert.equal(host.extensionPrompts['2_floating_prompt'].value, 'A newer note after a scanner failure', 'A failed scanner does not guess which note changes to undo');
host.getWorldInfoPrompt = savedWiScanner;
host.extensionPrompts['2_floating_prompt'] = { ...originalAuthorNote };

const nameHistory = [{ id: '1', role: 'user', name: 'User', content: 'Hello' }, { id: '2', role: 'assistant', name: 'Other-Character', forceAvatar: 'avatar.png', content: 'Reply' }, { id: '3', role: 'system', name: 'Narrator', content: 'Scene', extra: { type: 'narrator' } }];
assert.deepEqual(api.formatMochiPromptHistory(nameHistory, { userName: 'User', characterName: 'Character', namesBehavior: 1 }).map((message) => message.name), ['User', 'Other_Character', 'Narrator'], 'Completion names are sanitized using ST name rules');
assert.deepEqual(api.formatMochiPromptHistory(nameHistory, { userName: 'User', characterName: 'Character', namesBehavior: 2 }).map((message) => message.content), ['User: Hello', 'Other-Character: Reply', 'Scene']);
assert.deepEqual(api.formatMochiPromptHistory(nameHistory, { userName: 'User', characterName: 'Character', namesBehavior: -1 }).map((message) => message.content), ['Hello', 'Reply', 'Scene']);
const groupExamples = api.formatMochiDialogueExamples('<START>\nUser: Group question\nOther: Other answer\nCharacter: Main answer', 'User', 'Character', true, ['Character', 'Other']);
assert.deepEqual(groupExamples[0].map((message) => message.content), ['User: Group question', 'Other: Other answer', 'Character: Main answer'], 'Group examples retain all speakers');
assert.equal(api.substituteMochiPromptMacros('{{user}}: true\n{{char}} replies to {{user}} at {{Time}}', 'Chosen', 'Other'), '{{user}}: true\nOther replies to Chosen at HOST CLOCK');

// Fill context with newest whole turns, respecting ST's pinned-example setting.
host.chatMetadata = {};
host.extensionPrompts = {};
delete host.getWorldInfoPrompt;
host.chatCompletionSettings = { openai_max_context: 4120, names_behavior: -1 };
host.chat = [{ name: 'User', is_user: true, mes: 'Older turn', extra: {} }, { name: 'Character', is_user: false, mes: 'Newest turn', extra: {} }];
host.getTokenCountAsync = async () => 1;
const budgetInput = { ...promptInput, blocks: [marker('dialogue_examples'), marker('chat_history')], characters: [{ id: 'char.png', name: 'Character', data: { mes_example: '<START>\nUser: Example question\nCharacter: Example answer' } }] };
const budgetPrompt = await api.buildMochiPresetMessages(budgetInput);
assert.ok(budgetPrompt.some((message) => message.content === 'Newest turn') && !budgetPrompt.some((message) => message.name), 'Unpinned examples yield context to real chat history');
host.powerUserSettings.pin_examples = true;
const pinnedPrompt = await api.buildMochiPresetMessages(budgetInput);
assert.equal(pinnedPrompt.filter((message) => message.name).length, 2, 'Pinned examples are kept together');
assert.ok(pinnedPrompt.some((message) => message.content === 'Newest turn'));
host.chat = Array.from({ length: 120 }, (_, index) => ({ name: 'Character', mes: `History ${index}`, extra: {} }));
host.chatCompletionSettings = {};
delete host.getTokenCountAsync;
delete host.powerUserSettings.pin_examples;
const longPrompt = await api.buildMochiPresetMessages({ ...promptInput, blocks: [marker('chat_history')] });
assert.equal(longPrompt.filter((message) => message.content.startsWith('History ')).length, 120, 'Default history is limited by available context, not a hardcoded 20/100 turns');
const filteredHistory = api.formatMochiPromptHistory([{ id: 'filtered', role: 'assistant', content: '<think>Hidden</think>Visible history' }], {
  userName: 'User', characterName: 'Character', config: api.DEFAULT_FORMAT_GUIDES.historyConfig,
});
assert.equal(filteredHistory[0].content, 'Visible history', 'Saved history tag filters still apply before sending');
const providerPrompt = [{ role: 'system', name: 'example_user', content: 'Named example' }, { role: 'user', name: 'User', content: 'New task' }];
rawReply = sampleReply('data_generation');
for (const profileId of [null, 'profile-1']) {
  await choose(profileId);
  await api.request('POST', `${phonePath}/generate`, { category: 'data_generation', messages: providerPrompt });
  const outgoing = calls.at(-1).type === 'default' ? calls.at(-1).options.prompt : calls.at(-1).messages;
  assert.deepEqual(outgoing.map((message) => message.name), ['example_user', 'User'], 'Named examples and history survive both provider routes');
}
host.chatCompletionSettings.openai_max_context = 4097;
await assert.rejects(api.buildMochiPresetMessages({ ...promptInput, blocks: [marker('format_guides')] }), /exceed the selected context/);
delete host.chatCompletionSettings;
delete host.getWorldInfoPrompt;
delete host.extensionPrompts;
delete host.promptRegex;
delete host.symbols;
host.chat = savedPromptChat;
host.chatMetadata = savedPromptMetadata;

await runHistoryContextTests({ api, host, choose, calls });

// Only the requested transcript and its environment may enter roleplay history.
for (const category of ['private_chats', 'group_chats']) {
  const cleanReply = sampleReply(category);
  rawReply = `<THINK mode="hidden">Private analysis <thinking>nested thoughts</thinking><environment>weather: Wrong</environment></THINK>\nUnrelated introduction.\n<debug>${cleanReply.replace('Hello back', 'Debug reply must not be used')}</debug>\n\`\`\`yaml\n${cleanReply.replace('Hello back', 'Hello <unrelated>discard this</unrelated>back')}\n${environment}\n\`\`\`\n<analysis>Trailing reasoning<environment>weather: Wrong again</environment></analysis>\n<debug><environment>weather: Wrong debug environment</environment></debug>\nUnrelated ending.`;
  const filtered = await generate(category);
  const items = api.parseChatHistoryBlocks(filtered.rawOutput)[0].messages;
  assert.equal(items.at(-1).text, 'Hello back');
  assert.ok(filtered.rawOutput.includes('weather: Rainy'));
  assert.ok(!/think|analysis|reasoning|unrelated|debug|Wrong|```/i.test(filtered.rawOutput), 'Reasoning, foreign tags, prose and fences never enter a generated phone turn');
  const persisted = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: filtered.rawOutput });
  assert.equal(host.chat.at(-1).mes, filtered.rawOutput, 'The host receives only the filtered canonical transcript');
  await api.request('DELETE', `${chatPath}/messages/${persisted.id}`);
  rawReply = `Prefilled hidden thoughts</THINKING>\n${cleanReply}\n<think>unfinished trailing reasoning`;
  assert.equal(api.parseChatHistoryBlocks((await generate(category)).rawOutput)[0].messages.at(-1).text, 'Hello back', 'Prefill closers and unfinished trailing reasoning are removed without losing the real reply');
  rawReply = `Hidden reasoning with a format example:\n${cleanReply.replace('Hello back', 'Not the actual reply')}\n</think>\n${cleanReply}`;
  assert.equal(api.parseChatHistoryBlocks((await generate(category)).rawOutput)[0].messages.at(-1).text, 'Hello back', 'Transcript examples inside prefilled reasoning are not mistaken for the actual response');
  for (const invalid of ['<think>Reasoning only</think>', '<THINK>Unfinished reasoning', '<debug>Explanations only</debug>', 'Just explanatory prose.', sampleReply(category === 'private_chats' ? 'group_chats' : 'private_chats')]) {
    rawReply = invalid;
    const before = host.chat.length;
    await assert.rejects(generate(category), /no incoming chat messages/);
    assert.equal(host.chat.length, before, 'Invalid/reasoning-only replies cannot create roleplay messages');
  }
}
rawReply = `<thinking>Do not save</thinking>Introduction.\n${sampleReply('data_generation')}\n<debug>Do not save</debug>`;
assert.equal((await generate()).rawOutput, '<phone_data>\nphone_data:\n  user:\n    nickname: Tester\n</phone_data>', 'Data generation keeps only its phone_data envelope');
rawReply = '<think>Only reasoning</think>';
await assert.rejects(generate(), /no phone data/);
assert.equal(api.stripMochiReasoning('Before<think>hidden</think>After'), 'BeforeAfter', 'A complete think block does not truncate earlier real content');
assert.equal(api.stripMochiReasoning(`${sampleReply('private_chats')}</think>`), sampleReply('private_chats'), 'A stray trailing reasoning closer does not truncate an already complete response');
assert.equal(api.cleanAndExtractRawYaml('<think_format><think>nested</think>more</think_format>\n```yaml\nmessages: []\n```'), 'messages: []');

// Reconciliation must replace every thread, even when its last record disappears.
const contact = (name, msgs) => ({ name, color: 'var(--acc)', online: true, story: false, unread: 0, started: 'Today', preview: msgs.at(-1)?.text || '', msgs });
const olderBubble = { id: 'older', me: 0, type: 'text', text: 'Latest surviving reply' };
const deletedBubble = { id: 'deleted', me: 0, type: 'text', text: 'Deleted latest reply' };
const unsaved = { id: 'pending', me: 1, type: 'text', text: 'Unanswered input' };
const localThreads = { Character: contact('Nickname', [olderBubble, deletedBubble]), group_test: contact('Test Group', [deletedBubble]) };
const reconciled = api.reconcileMochiContactHistory({ local: localThreads, archived: { Character: contact('Nickname', [olderBubble]) }, pendingUserMessages: {}, regeneratingThreadIds: new Set() });
assert.deepEqual(reconciled.Character.msgs, [olderBubble]);
assert.equal(reconciled.Character.preview, olderBubble.text, 'Latest-message preview moves back to the surviving turn');
assert.deepEqual(reconciled.group_test.msgs, [], 'A removed thread is cleared even while another thread survives');
assert.equal(reconciled.group_test.preview, '');
const emptyThreads = api.reconcileMochiContactHistory({ local: reconciled, archived: {}, pendingUserMessages: { Character: [unsaved] }, regeneratingThreadIds: new Set() });
assert.deepEqual(emptyThreads.Character.msgs, [unsaved], 'An empty roleplay chat retains only genuine unsaved inputs');
assert.deepEqual(emptyThreads.group_test.msgs, []);
assert.equal(api.reconcileMochiContactHistory({ local: emptyThreads, archived: {}, pendingUserMessages: { Character: [unsaved] }, regeneratingThreadIds: new Set() }), emptyThreads, 'Unchanged history keeps a stable state reference');
assert.deepEqual(localThreads.Character.msgs, [olderBubble, deletedBubble], 'Reconciliation never mutates previous state');
const regenerating = api.reconcileMochiContactHistory({ local: localThreads, archived: {}, pendingUserMessages: {}, regeneratingThreadIds: new Set(['Character']) });
assert.equal(regenerating.Character, localThreads.Character, 'Explicit in-flight regeneration state stays visible until it settles');
rawReply = '<phone_data>phone_data:\n  user:\n    nickname: Tester</phone_data>';

await choose('deleted-profile');
const beforeMissing = calls.length;
await assert.rejects(generate(), /Profile not found/);
assert.equal(calls.length, beforeMissing, 'Missing named profile must not silently use default');

await choose('profile-1');
const cancelled = new AbortController();
cancelled.abort();
const beforeCancelled = calls.length;
await assert.rejects(generate('data_generation', { signal: cancelled.signal }), /aborted/);
assert.equal(calls.length, beforeCancelled, 'Cancelled requests must not call the provider');

await choose(null);
await generate();
assert.equal(calls.at(-1).type, 'default', 'Switching back must restore default routing');
await choose('profile-1');
namedReply = async ({ signal }) => {
  host.chatId = 'second';
  host.chatMetadata = {};
  emit('chat_changed');
  assert.equal(signal.aborted, true, 'Chat switch must cancel pending phone request');
  return { content: 'stale reply' };
};
await assert.rejects(generate(), /aborted|chat changed/);
for (const method of ['GET', 'PUT', 'DELETE']) {
  await assert.rejects(api.request(method, phonePath, { rawYaml: 'stale' }), /chat changed/);
}
await assert.rejects(generate(), /chat changed/);
assert.deepEqual(host.chatMetadata, {}, 'Stale writes must not touch the new chat');
assert.equal(listeners.get('chat_changed')?.size ?? 0, 0, 'Request listeners must be removed');

host.groupId = 'group-42';
host.chatId = 'group-chat';
const groupId = api.activeChatId();
const group = await api.request('GET', `/chats/${encodeURIComponent(groupId)}`);
assert.equal(group.name, 'Test Group');
assert.deepEqual(group.characterIds, ['char.png']);
assert.equal(api.mapMessage(0)?.characterId, 'char.png');
assert.deepEqual((await api.request('GET', `/lorebooks/scan/${encodeURIComponent(groupId)}`)).lorebookIds, [], 'Non-member character lore must not leak into a group');
host.groups[0].members.push('other.png');
assert.deepEqual((await api.request('GET', `/lorebooks/scan/${encodeURIComponent(groupId)}`)).lorebookIds, ['Extra']);
const realGroupStart = host.chat.length;
await api.request('POST', `/chats/${encodeURIComponent(groupId)}/messages`, { role: 'assistant', content: groupContent });
assert.deepEqual(host.chat.slice(realGroupStart).map((message) => message.name), ['Test Group']);
assert.equal(host.chat[realGroupStart].original_avatar, undefined);
assert.equal(api.mapMessage(realGroupStart).chatId, groupId, 'The transcript remains in the active ST group context');
await assert.rejects(api.request('GET', scanPath), /chat changed/);

host.extensionSettings.disabledExtensions = ['connection-manager'];
assert.deepEqual(await api.listConnectionProfiles(), []);

const limits = { viewportWidth: 1200, viewportHeight: 900, topbarWidth: 1200, topbarHeight: 40, barHeight: 48 };
const size = api.phoneSize(limits);
const placed = api.placeFrame(9999, 9999, size, limits);
assert.ok(placed.top + size.height + 48 <= 900, 'Phone and floating controls must fit');
const centeredLimits = { ...limits, topbarWidth: 720, topbarLeft: 240 };
const centeredSize = api.phoneSize(centeredLimits);
const centered = api.defaultPlace(centeredSize, centeredLimits);
assert.ok(Math.abs(centered.left + centeredSize.width / 2 - 600) < 1, 'First launch must align with the top-bar centre');
assert.equal(centered.top, 52);
const freelyMoved = api.placeFrame(9999, 9999, centeredSize, centeredLimits);
assert.ok(freelyMoved.left > 720, 'Popup may move across the device, not only inside a left-origin top-bar box');
for (const [width, height] of [[390, 844], [320, 568], [280, 460], [844, 390], [390, 340], [320, 250]]) {
  const phoneLimits = { viewportWidth: width, viewportHeight: height, layoutWidth: width, layoutHeight: 844, topbarWidth: width, topbarHeight: 40, barHeight: 48 };
  const phone = api.phoneSize(phoneLimits);
  for (const [left, top] of [[-9999, -9999], [9999, 9999], [NaN, Infinity]]) {
    const position = api.placeFrame(left, top, phone, phoneLimits);
    assert.ok(position.left >= 0 && position.top >= 0);
    assert.ok(position.left + phone.width <= width && position.top + phone.height + 48 <= height, `${width}×${height} must fit completely`);
  }
}
const mobileLimits = { viewportWidth: 390, viewportHeight: 844, topbarWidth: 390, topbarHeight: 40, barHeight: 48, layoutWidth: 390, layoutHeight: 844 };
const fullMobile = api.phoneSize(mobileLimits);
const keyboardMobile = api.phoneSize({ ...mobileLimits, viewportHeight: 340 });
assert.equal(keyboardMobile.width, fullMobile.width, 'Keyboard must not shrink the reading width');
assert.ok(keyboardMobile.height < fullMobile.height);
const pannedLimits = { ...mobileLimits, viewportWidth: 300, viewportHeight: 300, viewportLeft: 35, viewportTop: 120, safeLeft: 10, safeRight: 20 };
const pannedSize = api.phoneSize(pannedLimits);
const panned = api.placeFrame(9999, -9999, pannedSize, pannedLimits);
assert.ok(panned.left >= 45 && panned.left + pannedSize.width <= 315 && panned.top >= 132 && panned.top + pannedSize.height + 48 <= 420);
const bubble = api.placeFloating(9999, -9999, { width: 46, height: 46 }, { width: 390, height: 340, left: 0, top: 120 });
assert.deepEqual(bubble, { left: 332, top: 132 });
assert.equal(api.launcherPalette({ theme: 'light', colorPreset: 'ocean' }, false).accent, '#6fa2cc');
assert.equal(api.launcherPalette({ theme: 'auto' }, true).accent, '#94b172');
assert.match(api.launcherPalette({ theme: 'dark', colorPreset: 'custom', customRgb: { r: 180, g: 60, b: 220 } }, false).accent, /^hsl\(/);
const floating = { style: {}, getBoundingClientRect() { return { left: parseFloat(this.style.left) - 25, top: parseFloat(this.style.top) - 120 }; } };
api.setFloatingPosition(floating, { left: 50, top: 60 });
assert.deepEqual(floating.getBoundingClientRect(), { left: 50, top: 60 }, 'Scrolled/transformed ST root must not shift a floating element offscreen');
// The library contract owns a dedicated extension folder, never ST settings/metadata.
let storedStickers = [];
let failStickerWrite = false;
const stickerBackend = { location: 'MochiOS/stickers', async read() { return [...storedStickers]; }, async write(next) { if (failStickerWrite) throw new Error('Disk full'); storedStickers = [...next]; } };
const revoked = [];
let urlSeq = 0;
const objectUrls = { createObjectURL() { return `blob:offline-${++urlSeq}`; }, revokeObjectURL(url) { revoked.push(url); } };
const stickerLibrary = api.createStickerLibrary(async () => stickerBackend, objectUrls);
const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'Happy Cat.png', { type: 'image/png' });
const metadataBeforeStickers = JSON.stringify(host.chatMetadata);
const settingsBeforeStickers = JSON.stringify(host.extensionSettings);
await stickerLibrary.add([png, png]);
assert.deepEqual(stickerLibrary.getSnapshot().list.map((item) => item.name), ['happy_cat', 'happy_cat_2']);
assert.equal(stickerLibrary.getSnapshot().location, 'MochiOS/stickers');
await Promise.all([stickerLibrary.add([png]), stickerLibrary.add([png])]);
assert.equal(stickerLibrary.getSnapshot().list.length, 4, 'Concurrent imports do not overwrite each other');
await assert.rejects(stickerLibrary.add([new File(['<svg onload="bad()"/>'], 'renamed.png', { type: 'image/png' })]), /PNG, JPEG, GIF, or WebP/);
assert.equal(stickerLibrary.getSnapshot().list.length, 4);
failStickerWrite = true;
await assert.rejects(stickerLibrary.add([png]), /Disk full/);
assert.equal(stickerLibrary.getSnapshot().list.length, 4, 'A failed save keeps the working library intact');
failStickerWrite = false;
const reloadedLibrary = api.createStickerLibrary(async () => stickerBackend, objectUrls);
await reloadedLibrary.load();
assert.equal(reloadedLibrary.getSnapshot().list.length, 4, 'Saved stickers load in a fresh chat/session');
await stickerLibrary.remove(stickerLibrary.getSnapshot().list[0].id);
assert.equal(storedStickers.length, 3);
assert.ok(revoked.length > 0, 'Replaced sticker object URLs are released');
assert.equal(api.stickerName('[Sticker] happy_cat'), 'happy_cat');
assert.equal(api.stickerName(':happy_cat:'), 'happy_cat');
assert.equal(api.stickerName('sticker:happy_cat:'), 'happy_cat');

// Editable names are validated at the persistence boundary, not just in the UI.
assert.equal(api.stickerNameKey('  Ｈａｐｐｙ Cat  '), 'happy cat');
assert.match(api.stickerNameError('   '), /Enter a sticker name/);
assert.match(api.stickerNameError('bad:name'), /colons/);
assert.match(api.stickerNameError('[Sticker] reserved'), /start with \[Sticker\]/);
assert.match(api.stickerNameError('line\nbreak'), /control characters/);
assert.match(api.stickerNameError('line\u2028break'), /control characters/);
assert.match(api.stickerNameError('x'.repeat(api.MAX_STICKER_NAME_LENGTH + 1)), /characters or fewer/);
assert.equal(api.suggestStickerName('Happy Cat.png', ['HAPPY_CAT', 'happy_cat_2']), 'happy_cat_3');
let namedRecords = [];
let namedWriteFailure = false;
let namedWrites = 0;
const namedBackend = {
  location: 'offline named stickers',
  async read() { return [...namedRecords]; },
  async write(next) { if (namedWriteFailure) throw new Error('Disk full'); namedWrites++; namedRecords = [...next]; },
};
const namedLibrary = api.createStickerLibrary(async () => namedBackend, objectUrls);
await namedLibrary.add([{ file: png, name: ' Happy Cat ' }, { file: png, name: 'Sleepy Cat 😴' }]);
assert.deepEqual(namedLibrary.getSnapshot().list.map((item) => item.name), ['Happy Cat', 'Sleepy Cat 😴'], 'Upload names are editable, trimmed, and preserve friendly text');
const originalSticker = namedRecords[0];
const beforeRejectedNames = namedWrites;
for (const name of ['happy cat', '  HAPPY CAT  ', 'Ｈａｐｐｙ Cat', '', 'bad:name', '[Sticker] bad']) {
  await assert.rejects(namedLibrary.add([{ file: png, name }]), /already exists|Enter a sticker name|colons/);
}
await assert.rejects(namedLibrary.add([{ file: png, name: 'Batch name' }, { file: png, name: ' BATCH NAME ' }]), /already exists/);
assert.equal(namedWrites, beforeRejectedNames, 'Invalid or duplicate batches must not write any stickers');
assert.equal(namedRecords.length, 2);
await assert.rejects(namedLibrary.add([new File([new Uint8Array(api.MAX_STICKER_BYTES + 1)], 'too-large.png', { type: 'image/png' })]), /under 10 MB/);
await namedLibrary.rename(originalSticker.id, 'HAPPY CAT');
await namedLibrary.rename(originalSticker.id, 'Renamed Cat');
assert.equal(namedRecords[0].id, originalSticker.id);
assert.equal(namedRecords[0].fileName, originalSticker.fileName);
assert.equal(namedRecords[0].blob, originalSticker.blob, 'Renaming changes metadata, not the saved image');
assert.deepEqual(namedRecords[0].aliases, ['Happy Cat', 'HAPPY CAT'], 'Previous names remain usable in old transcripts');
await assert.rejects(namedLibrary.rename(originalSticker.id, ' sleepy cat 😴 '), /already exists/);
await assert.rejects(namedLibrary.rename(namedRecords[1].id, 'happy cat'), /already exists/, 'Historical names remain owned by their original sticker');
await assert.rejects(namedLibrary.add([{ file: png, name: 'Happy Cat' }]), /already exists/);
await assert.rejects(namedLibrary.rename('missing-sticker', 'Missing'), /no longer saved/);
await assert.rejects(namedLibrary.rename(originalSticker.id, '   '), /Enter a sticker name/);
const beforeFailedRename = namedLibrary.getSnapshot().list;
namedWriteFailure = true;
await assert.rejects(namedLibrary.rename(originalSticker.id, 'Unsaved rename'), /Disk full/);
assert.equal(namedLibrary.getSnapshot().list, beforeFailedRename);
assert.equal(namedRecords[0].name, 'Renamed Cat', 'A failed rename cannot mutate persisted records');
namedWriteFailure = false;
const renamedReload = api.createStickerLibrary(async () => namedBackend, objectUrls);
await renamedReload.load();
assert.deepEqual(renamedReload.getSnapshot().list.map((item) => [item.name, item.aliases]), namedLibrary.getSnapshot().list.map((item) => [item.name, item.aliases]));

// JSON backups contain all bytes and names, and import atomically without overwrites.
const backupJson = await namedLibrary.exportJson();
const backup = JSON.parse(backupJson);
assert.equal(backup.format, 'mochi-os-stickers');
assert.equal(backup.version, 1);
assert.deepEqual(backup.stickers.map((item) => item.name), ['Renamed Cat', 'Sleepy Cat 😴']);
assert.deepEqual(backup.stickers[0].aliases, ['Happy Cat', 'HAPPY CAT']);
assert.ok(backup.stickers.every((item) => item.data.startsWith('data:image/png;base64,')));
assert.ok(!backupJson.includes('blob:') && !backupJson.includes('fileName'), 'Backups cannot depend on temporary URLs or this device\'s paths');
const reviewedBackup = await api.readStickerBackup(new File([backupJson], 'stickers.json', { type: 'application/json' }));
assert.equal(reviewedBackup[0].file.size, png.size);
assert.equal(namedRecords.length, 2, 'Reading a JSON backup prepares editable uploads without saving');
let restoredRecords = [];
let restoredWrites = 0;
const restoreBackend = { location: 'other browser', async read() { return [...restoredRecords]; }, async write(next) { restoredWrites++; restoredRecords = [...next]; } };
const restoredLibrary = api.createStickerLibrary(async () => restoreBackend, objectUrls);
await restoredLibrary.importJson(backupJson);
assert.deepEqual(restoredRecords.map((item) => [item.name, item.aliases]), namedRecords.map((item) => [item.name, item.aliases]));
assert.notEqual(restoredRecords[0].id, originalSticker.id, 'Import creates fresh storage identities');
assert.deepEqual(new Uint8Array(await restoredRecords[0].blob.arrayBuffer()), new Uint8Array(await originalSticker.blob.arrayBuffer()));
await assert.rejects(restoredLibrary.importJson(backupJson), /already exists/);
assert.equal(restoredRecords.length, 2);
assert.equal(restoredWrites, 1, 'An import conflict must not overwrite the existing library');
const pack = (stickers) => JSON.stringify({ format: 'mochi-os-stickers', version: 1, stickers });
const backupImage = { name: 'New backup sticker', mimeType: 'image/png', data: backup.stickers[0].data };
const invalidBackups = [
  ['{bad json', /valid Mochi OS sticker JSON/],
  ['null', /invalid/],
  [JSON.stringify({ ...backup, version: 2 }), /not supported/],
  [JSON.stringify({ ...backup, format: 'other-format' }), /not supported/],
  [JSON.stringify({ ...backup, stickers: {} }), /stickers array/],
  [pack([{ name: 'No data' }]), /must include/],
  [pack([{ ...backupImage, name: '' }]), /Enter a sticker name/],
  [pack([{ ...backupImage, data: 'https://example.test/image.png' }]), /image data.*invalid/],
  [pack([{ ...backupImage, data: 'data:image/png;base64,not-base64!' }]), /base64.*invalid/],
  [pack([{ ...backupImage, data: 'data:image/png;base64,' + btoa('<svg onload="bad()"/>') }]), /PNG, JPEG, GIF, or WebP/],
  [pack([{ ...backupImage, mimeType: 'image/jpeg', data: backupImage.data.replace('image/png', 'image/jpeg') }]), /does not match/],
  [pack([{ ...backupImage, data: 'data:image/png;base64,' + 'A'.repeat(4 * Math.ceil(api.MAX_STICKER_BYTES / 3) + 4) }]), /under 10 MB/],
  [pack([backupImage, { ...backupImage, name: ' new BACKUP sticker ' }]), /already exists/],
  [pack([backupImage, { ...backupImage, name: 'Other', aliases: ['New backup sticker'] }]), /already exists/],
  [pack([backupImage, { ...backupImage, name: 'Bad second sticker', data: 'data:image/png;base64,!!!!' }]), /base64.*invalid/],
];
for (const [json, error] of invalidBackups) {
  await assert.rejects(restoredLibrary.importJson(json), error);
  assert.equal(restoredRecords.length, 2);
  assert.equal(restoredWrites, 1, 'Malformed, oversized, or duplicate backups must leave the whole library unchanged');
}
const concurrentNames = await Promise.allSettled([
  restoredLibrary.add([{ file: png, name: 'Concurrent sticker' }]),
  restoredLibrary.add([{ file: png, name: ' CONCURRENT STICKER ' }]),
]);
assert.deepEqual(concurrentNames.map((result) => result.status), ['fulfilled', 'rejected']);
assert.equal(restoredRecords.length, 3, 'Concurrent explicit names are checked against the latest saved library');
const concurrentRenames = await Promise.allSettled([
  restoredLibrary.rename(restoredRecords[0].id, 'Shared rename'),
  restoredLibrary.rename(restoredRecords[1].id, 'shared rename'),
]);
assert.deepEqual(concurrentRenames.map((result) => result.status), ['fulfilled', 'rejected']);
assert.equal(new Set(restoredRecords.map((item) => api.stickerNameKey(item.name))).size, 3);
let rasterRecords = [];
const rasterBackend = { location: 'raster backups', async read() { return [...rasterRecords]; }, async write(next) { rasterRecords = [...next]; } };
const rasterLibrary = api.createStickerLibrary(async () => rasterBackend, objectUrls);
await rasterLibrary.add([
  png,
  new File([Uint8Array.from([255, 216, 255, 224])], 'Photo.jpg', { type: 'image/jpeg' }),
  new File(['GIF89a\0\0\0\0\0\0'], 'Animated.gif', { type: 'image/gif' }),
  new File(['RIFF\0\0\0\0WEBP'], 'Web sticker.webp', { type: 'image/webp' }),
]);
const rasterJson = await rasterLibrary.exportJson();
assert.deepEqual((await api.readStickerBackup(rasterJson)).map((item) => item.file.type), ['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const chunkedBytes = Uint8Array.from({ length: 32768 * 3 + 5 }, (_, index) => index % 256);
chunkedBytes.set(new Uint8Array(await png.slice(0, 8).arrayBuffer()));
await rasterLibrary.add([{ file: new File([chunkedBytes], 'chunked.png', { type: 'image/png' }), name: 'Chunked image' }]);
const chunkedBackup = await api.readStickerBackup(await rasterLibrary.exportJson());
assert.deepEqual(new Uint8Array(await chunkedBackup.at(-1).file.arrayBuffer()), chunkedBytes, 'Base64 backups preserve all bytes across encoder chunk boundaries');
assert.equal(JSON.stringify(host.chatMetadata), metadataBeforeStickers);
assert.equal(JSON.stringify(host.extensionSettings), settingsBeforeStickers);
await runStickerStorageTests(api);
console.log('PASS: ST-style preset markers and chronological history, selected personas, social handles, target-only private output, filtered response tags, deleted-thread reconciliation, one ST turn per response, reactions/edits/swipes/reload, legacy compatibility, global stickers with editable unique names, persistent renames and portable validated JSON backups, lorebook assignments, connections, chat isolation, viewport bounds, and launcher themes');
