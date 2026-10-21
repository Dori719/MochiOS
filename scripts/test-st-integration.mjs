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
      export { mergeMochiChatHistoryBlocks, parseChatHistoryBlocks, parseMochiChatResponse, serializeChatHistoryYaml } from './src/components/chat/mochi-os/mochi-os.utils.ts';
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
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

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
rawReply = '<privatechat_history target="Character" type="private">\nmessages:\n  - t: text\n    c: Hello back\n</privatechat_history>';
for (const category of ['data_generation', 'private_chats', 'group_chats']) {
  await generate(category);
  assert.equal(calls.at(-1).type, 'default', `${category} must follow default connection`);
  assert.equal(calls.at(-1).options.prompt[0].content, 'Keep «user}} literal.');
}

await choose('profile-1');
for (const category of ['data_generation', 'private_chats', 'group_chats']) {
  rawReply = category === 'data_generation'
    ? '<phone_data>phone_data:\n  user:\n    nickname: Tester</phone_data>'
    : `<${category === 'group_chats' ? 'groupchat_history' : 'privatechat_history'} target="${category === 'group_chats' ? 'Test Group' : 'Character'}">\nmessages:\n  - t: text\n    c: Hello back\n    time: "12:00"\n    sender:\n      name: Character\n</${category === 'group_chats' ? 'groupchat_history' : 'privatechat_history'}>`;
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
  category, contactName: 'Character', userPrompt: 'Hi',
  messages: [{ role: 'system', content: '<lorebook>UNATTACHED_LORE</lorebook>' }, { role: 'user', content: 'Hi' }],
});
for (const category of ['data_generation', 'private_chats', 'group_chats']) {
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

// Every incoming phone bubble must be a rendered ST character message, including aliases and NPCs.
host.characters.push({ avatar: 'other.png', name: 'Other', data: { name: 'Other', extensions: { world: 'Extra' } } });
await api.request('PUT', phonePath, { rawYaml: 'characters:\n  - id: other.png\n    name: Other\n    contactname: Nickname' });
const environment = '<environment>\ndate: Today\ntime: "12:00"\nweather: Rainy\n</environment>';
const privateContent = api.serializeChatHistoryYaml({ targetName: 'Nickname', recordType: 'private', environmentYaml: environment, messages: [
  { me: 1, type: 'text', text: 'Hi' },
  { me: 0, type: 'text', text: 'First reply' },
  { me: 0, type: 'text', text: 'Second reply' },
] });
const privateStart = host.chat.length;
const privateTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', characterId: 'char.png', content: privateContent });
assert.deepEqual(host.chat.slice(privateStart).map((message) => [message.name, message.is_user]), [['User', true], ['Other', false], ['Other', false]]);
assert.ok(host.chat.slice(privateStart + 1).every((message) => message.original_avatar === 'other.png' && message.force_avatar.includes('other.png')));
assert.equal(api.listMessages().at(-1).characterId, 'other.png');
assert.equal(api.parseChatHistoryBlocks(privateTurn.content)[0].messages.length, 3);
assert.ok(host.chat.slice(privateStart).every((message) => message.mes.includes('weather: Rainy')), 'Environment must survive injection');

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
assert.deepEqual(host.chat.slice(groupStart).map((message) => [message.name, message.is_user]), [['User', true], ['Character', false], ['Other', false], ['NPC', false]]);
assert.equal(api.mapMessage(groupStart + 3).characterId, null, 'Unknown speakers must not impersonate the selected card');
assert.equal(api.listMessages(1)[0].id, groupTurn.id);
assert.equal(api.parseChatHistoryBlocks(api.listMessages(1)[0].content)[0].messages.length, 4, 'Physical group messages must rehydrate as one logical turn');
assert.equal(api.listMessages(1, groupTurn.id)[0].id, privateTurn.id, 'Pagination must use logical turn ids');
const routeMessages = await api.request('GET', `${chatPath}/messages?limit=1`);
assert.equal(routeMessages[0].id, groupTurn.id);
assert.equal(api.messageEndIndexOf(groupTurn.id), groupStart + 3);
await api.request('POST', `${chatPath}/branch`, { upToMessageId: groupTurn.id });
assert.equal(lifecycle.at(-1)[1], `/branch-create ${groupStart + 3}`, 'Branch includes the complete physical phone turn');
const serializedChat = JSON.stringify(host.chat);
host.chat = JSON.parse(serializedChat);
assert.equal(api.parseChatHistoryBlocks(api.listMessages(1)[0].content)[0].messages.length, 4, 'Export/reload preserves the whole group turn');
const regenerated = api.serializeChatHistoryYaml({ targetName: 'Test Group', recordType: 'group', environmentYaml: environment, messages: [
  { me: 1, type: 'text', text: 'Hello group', sender: 'User' },
  { me: 0, type: 'text', text: 'Regenerated reply', sender: 'Other' },
] });
await api.request('POST', `${chatPath}/messages/${groupTurn.id}/swipes`, { content: regenerated });
assert.equal(api.listMessages(1)[0].swipeCount, 2);
assert.deepEqual(host.chat.slice(groupStart).map((message) => message.name), ['User', 'Other']);
await api.request('PUT', `${chatPath}/messages/${groupTurn.id}/active-swipe`, { index: 0 });
assert.equal(api.listMessages(1)[0].activeSwipeIndex, 0);
assert.equal(host.chat.length, groupStart + 4);
const edited = groupContent.replace('Main reply', 'Edited main reply');
await api.request('PUT', `${chatPath}/messages/${groupTurn.id}`, { content: edited });
assert.ok(host.chat[groupStart + 1].mes.includes('Edited main reply'));
assert.ok(lifecycle.some((event) => event[0] === 'repaint'), 'Edits/swipes/deletes must repaint ST');
await api.request('DELETE', `${chatPath}/messages/${groupTurn.id}`);
assert.equal(host.chat.length, groupStart, 'Deleting a phone turn removes all its physical messages');
assert.equal(api.listMessages(1)[0].id, privateTurn.id, 'Other threads stay intact');

// Native deletion of an anchor must not orphan the remaining physical messages.
host.chat.splice(privateStart, 1);
assert.equal(api.listMessages(1)[0].id, privateTurn.id);
assert.equal(api.messageIndexOf(privateTurn.id), privateStart);
await api.request('DELETE', `${chatPath}/messages/${privateTurn.id}`);
assert.equal(host.chat.length, privateStart);
const prose = `Unrelated roleplay context.\n\n${groupContent}\n\nKeep this ending.`;
const proseTurn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: prose, characterId: 'char.png' });
assert.equal(host.chat.at(-1).mes, prose, 'Splitting dedicated phone turns must not strip prose from ordinary roleplay messages');
await api.request('DELETE', `${chatPath}/messages/${proseTurn.id}`);

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
assert.deepEqual(host.chat.slice(realGroupStart).map((message) => message.name), ['User', 'Character', 'Nickname', 'NPC']);
assert.equal(host.chat[realGroupStart + 1].original_avatar, 'char.png');
assert.equal(api.mapMessage(realGroupStart + 1).chatId, groupId, 'Incoming message remains in the active ST group context');
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
console.log('PASS: explicit lorebook assignments, per-sender incoming messages, ST rendering/saves, thread editing/swipes/reload, connections, chat isolation, keyboard/panned viewport bounds, and launcher themes');
