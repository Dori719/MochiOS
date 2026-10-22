/** Offline contract tests: no SillyTavern files, network calls, or API credits. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

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
      export { createStickerLibrary, MAX_STICKER_BYTES, normalizeStickerName, stickerName } from './src/st/stickers.ts';
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
      builder.onResolve({ filter: /^\/scripts\/world-info\.js$/ }, () => ({ path: 'world-info', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
        contents: args.path === 'context'
          ? 'export function getContext() { return globalThis.__mochiTestHost; }'
          : 'export function getWorldInfoSettings() { return { world_info: globalThis.__mochiTestWorldInfo }; }',
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
  Chat: { entries: { 1: { content: 'CHAT_LORE', key: ['chat'] }, 2: { content: 'DISABLED_LORE', disable: true } } },
  Character: { entries: { 1: { content: 'CHARACTER_LORE' } } },
  Extra: { entries: { 1: { content: 'EXTRA_LORE' } } },
  Global: { entries: { 1: { content: 'GLOBAL_LORE' } } },
  Persona: { entries: { 1: { content: 'PERSONA_LORE' } } },
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

const aliasContent = api.serializeChatHistoryYaml({ targetName: 'Character', contactName: 'Nickname', recordType: 'private', date: 'Day 2', time: '12:04', environmentYaml: environment, messages: [
  { me: 0, type: 'image', rawItem: { c: 'A saved photo', url: 'https://example.test/photo.png', extra: 'Keep this field' }, t: '12:04' },
  { me: 0, type: 'quote', text: 'Quote reply', rawItem: { quote: { name: 'User', t: 'text', c: 'Quoted text' } }, t: '12:05' },
] });
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
assert.equal(api.parseChatHistoryBlocks(aliasGenerated.rawOutput)[0].contactname, 'Nickname', 'Private canonical generation retains the stable character target and display alias');

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
// Sticker persistence is global and owns a dedicated folder, never ST settings/metadata.
let storedStickers = [];
let failStickerWrite = false;
const stickerBackend = { location: 'mochi-os/stickers', async read() { return [...storedStickers]; }, async write(next) { if (failStickerWrite) throw new Error('Disk full'); storedStickers = [...next]; } };
const revoked = [];
let urlSeq = 0;
const objectUrls = { createObjectURL() { return `blob:offline-${++urlSeq}`; }, revokeObjectURL(url) { revoked.push(url); } };
const stickerLibrary = api.createStickerLibrary(async () => stickerBackend, objectUrls);
const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'Happy Cat.png', { type: 'image/png' });
const metadataBeforeStickers = JSON.stringify(host.chatMetadata);
const settingsBeforeStickers = JSON.stringify(host.extensionSettings);
await stickerLibrary.add([png, png]);
assert.deepEqual(stickerLibrary.getSnapshot().list.map((item) => item.name), ['happy_cat', 'happy_cat_2']);
assert.equal(stickerLibrary.getSnapshot().location, 'mochi-os/stickers');
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
assert.equal(JSON.stringify(host.chatMetadata), metadataBeforeStickers);
assert.equal(JSON.stringify(host.extensionSettings), settingsBeforeStickers);
console.log('PASS: filtered response tags, deleted-thread reconciliation, one ST turn per phone response, sender preservation, reactions/edits/swipes/reload, legacy compatibility, global sticker storage, explicit lorebook assignments, connections, chat isolation, viewport bounds, and launcher themes');
