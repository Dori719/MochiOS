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
      export { phoneSize, placeFrame } from './src/st/frame-layout.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  plugins: [{
    name: 'mock-sillytavern-context',
    setup(builder) {
      builder.onResolve({ filter: /^\/scripts\/st-context\.js$/ }, () => ({ path: 'context', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: 'export function getContext() { return globalThis.__mochiTestHost; }',
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
globalThis.window = { localStorage: { getItem: () => null } };
globalThis.__mochiTestHost = {
  characters: [{ avatar: 'char.png', name: 'Character', chat: 'first' }],
  characterId: 0,
  groupId: null,
  chatId: 'first',
  chat: [],
  chatMetadata: {},
  groups: [{ id: 'group-42', name: 'Test Group', members: ['char.png'], chat_id: 'group-chat' }],
  name1: 'User',
  name2: 'Character',
  extensionSettings: { disabledExtensions: [] },
  eventTypes: { CHAT_CHANGED: 'chat_changed' },
  eventSource: {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeListener(name, fn) { listeners.get(name)?.delete(fn); },
  },
  updateChatMetadata(patch) { Object.assign(globalThis.__mochiTestHost.chatMetadata, patch); },
  saveMetadataDebounced() { saves++; },
  saveSettingsDebounced() { saves++; },
  saveChat() { saves++; return Promise.resolve(); },
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

host.extensionSettings.disabledExtensions = ['connection-manager'];
assert.deepEqual(await api.listConnectionProfiles(), []);

const limits = { viewportWidth: 1200, viewportHeight: 900, topbarWidth: 1200, topbarHeight: 40, barHeight: 48 };
const size = api.phoneSize(limits);
const placed = api.placeFrame(9999, 9999, size, limits);
assert.ok(placed.top + size.height + 48 <= 900, 'Phone and floating controls must fit');
console.log('PASS: connection selection, all generation categories, live host APIs, chat isolation, group context, and popup bounds');
