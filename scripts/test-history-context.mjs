import assert from 'node:assert/strict';

/** Offline regressions for archive indexing and ST's configured prompt budget. */
export async function runHistoryContextTests({ api, host, choose, calls }) {
  const record = (type, target, text, me = 0) => api.serializeChatHistoryYaml({
    recordType: type, targetName: target,
    messages: [{ me, type: 'text', text, rawItem: { id: 'repeated-id' } }],
  });
  const privateTurn = { id: 'private', role: 'assistant', content: record('private', 'Character', 'Private reply') };
  const groupTurn = { id: 'group', role: 'assistant', content: record('group', 'Character', 'Group reply') };
  const continuation = { id: 'continuation', role: 'assistant', content: [
    record('private', 'Character', 'Next private reply'), record('group', 'Character', 'Next group reply'),
  ].join('\n') };
  const buriedHistory = [privateTurn, groupTurn, continuation,
    ...Array.from({ length: 250 }, (_, index) => ({ id: `roleplay-${index}`, role: 'assistant', content: `Ordinary roleplay ${index}` })),
    { id: 'bare-yaml', role: 'assistant', content: 'messages:\n  - t: text\n    c: Not phone history' },
    { id: 'bare-tag', role: 'assistant', content: '<messages>\nmessages:\n  - t: text\n    c: Not an archive\n</messages>' },
    { id: 'user-example', role: 'user', content: record('private', 'Character', 'User pasted a guide') },
  ];
  let parses = 0;
  const indexHistory = api.createMochiRoleplayHistoryIndexer((...args) => { parses++; return api.parseChatHistoryBlocks(...args); });
  let index = indexHistory(buriedHistory, 'User');
  assert.equal(parses, 3, 'Only archived assistant phone turns are parsed, even when buried 250 roleplay messages back');
  assert.equal(index.blocks.length, 4, 'Bare roleplay YAML and user examples do not become phone threads');
  for (const type of ['private', 'group']) {
    for (const [threadIndex, message] of [type === 'private' ? privateTurn : groupTurn, continuation].entries()) {
      const recordIndex = message === continuation && type === 'group' ? 1 : 0;
      const target = { targetName: 'Character', recordType: type, threadIndex,
        threadMessageId: api.mochiRoleplayBubbleId(message.id, recordIndex, 0) };
      const original = api.locateMochiMessageInRoleplay({ roleplayMessages: buriedHistory.filter((message) => !message.id.startsWith('bare-')), ...target });
      assert.deepEqual(index.locate(target), original, 'Indexed runtime locations retain typed record indexes and continuation boundaries');
      assert.deepEqual(index.locate({ ...target, threadMessageId: 'repeated-id' }), original, 'Repeated imported ids use the clicked thread position');
      assert.deepEqual(api.locateMochiMessageInRoleplay({ roleplayMessages: [], historyIndex: index, ...target }), original, 'Render lookups use the supplied index, not reparsing');
      assert.deepEqual(index.locate({ ...target, targetName: 'Renamed display alias' }), original, 'Runtime keys still find renamed contacts');
    }
  }
  assert.equal(index.locate({ targetName: 'Character', recordType: 'group', threadIndex: 0,
    threadMessageId: api.mochiRoleplayBubbleId('private', 0, 0) }), null, 'A private runtime key cannot target a group thread with the same name');
  assert.ok(index.blocks.every((block) => block.messages.every((message) => message.id.includes(':mochi:'))));
  assert.ok(!privateTurn.content.includes(':mochi:'), 'Runtime keys never modify the saved YAML');
  for (let repeat = 0; repeat < 1000; repeat++) index.locate({ targetName: 'Character', recordType: 'private', threadIndex: 1 });
  assert.equal(parses, 3, 'One thousand bubble lookups dispatch no parser work');
  const freshMessages = buriedHistory.map((message) => ({ ...message, activeSwipeIndex: 2 }));
  index = indexHistory(freshMessages, 'user');
  assert.equal(parses, 3, 'Fresh query objects and case-only persona changes reuse cached records');
  assert.equal(index.messagesById.get('private').activeSwipeIndex, 2, 'The message map still reads fresh swipe metadata');
  freshMessages[0] = { ...freshMessages[0], content: record('private', 'Character', 'Edited private reply') };
  index = indexHistory(freshMessages, 'User');
  assert.equal(parses, 4, 'Editing or swiping reparses only the changed transcript');
  assert.equal(index.blocks[0].messages[0].text, 'Edited private reply');
  index = indexHistory(freshMessages.filter((message) => message.id !== 'private'), 'User');
  assert.equal(index.messagesById.has('private'), false);
  assert.equal(index.locate({ targetName: 'Character', recordType: 'private', threadIndex: 0,
    threadMessageId: api.mochiRoleplayBubbleId('private', 0, 0) }), null, 'Deleting a record invalidates its key instead of editing a surviving bubble');
  indexHistory(freshMessages.filter((message) => message.id !== 'private'), 'Other Persona');
  assert.equal(parses, 6, 'Changing the persona reparses live records, never deleted ones');
  const aliasHistory = [{ id: 'legacy-alias', role: 'assistant', content: groupTurn.content.replace('messages:', 'contactname: Nickname\nmessages:') }];
  const aliasIndex = indexHistory(aliasHistory, 'User');
  assert.deepEqual(aliasIndex.locate({ targetName: 'Nickname', recordType: 'group', threadIndex: 0 }),
    api.locateMochiMessageInRoleplay({ roleplayMessages: aliasHistory, targetName: 'Nickname', recordType: 'group', threadIndex: 0 }), 'Legacy saved aliases retain positional lookup compatibility');

  const keys = ['chat', 'chatMetadata', 'chatCompletionSettings', 'powerUserSettings', 'extensionPrompts', 'mainApi', 'maxContext',
    'maxResponseTokens', 'getMaxContextTokens', 'getMaxResponseTokens', 'getTokenizerModel', 'getTokenCountAsync', 'getPresetManager',
    'CONNECT_API_MAP', 'ConnectionManagerRequestService', 'getWorldInfoPrompt', 'formatRawPrompt', 'promptRegex', 'textCompletionSettings', 'getTextGenServer'];
  const saved = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  const extensionSettings = structuredClone(host.extensionSettings);
  const limits = (context, response, profileId = null) => {
    const actual = api.getMochiTokenLimits(undefined, profileId);
    assert.deepEqual([actual.maxContext, actual.responseLength, actual.promptBudget], [context, response, context - response]);
    return actual;
  };
  try {
    await choose(null);
    host.mainApi = 'openai';
    host.chatCompletionSettings = { openai_max_context: 600, openai_max_tokens: 32, names_behavior: -1 };
    limits(600, 32);
    assert.equal(api.getMochiTokenLimits(12).responseLength, 12, 'A smaller request cap is respected');
    assert.equal(api.getMochiTokenLimits(128).responseLength, 32, 'A request cannot exceed the configured response cap');
    host.getMaxContextTokens = () => 430;
    host.getMaxResponseTokens = () => 45;
    limits(430, 45);
    delete host.getMaxContextTokens;
    delete host.getMaxResponseTokens;
    host.mainApi = 'textgenerationwebui';
    host.maxContext = 1024;
    host.maxResponseTokens = 96;
    limits(1024, 96);

    const profile = { id: 'profile-1', api: 'saved-chat', model: 'saved-model', preset: 'Saved chat preset' };
    const service = { ...host.ConnectionManagerRequestService, getProfile: () => profile };
    host.ConnectionManagerRequestService = service;
    host.CONNECT_API_MAP = { 'saved-chat': { selected: 'openai' }, 'saved-text': { selected: 'textgenerationwebui' } };
    const presets = {
      openai: { 'Saved chat preset': { openai_max_context: 380, openai_max_tokens: 40 } },
      textgenerationwebui: { 'Saved text preset': { truncation_length: 300, max_new_tokens: 24 } },
      instruct: { 'Saved instruct': {} },
    };
    host.getPresetManager = (api) => ({ getCompletionPresetByName: (name) => presets[api]?.[name] });
    const activeSettings = JSON.stringify(host.chatCompletionSettings);
    limits(380, 40, 'profile-1');
    await choose('profile-1');
    await api.generateMochiOutput([{ role: 'user', content: 'Named chat request' }]);
    assert.equal(calls.at(-1).maxTokens, 40, 'Saved chat requests use their preset response length, not 4096');
    profile.api = 'saved-text'; profile.preset = 'Saved text preset';
    limits(300, 24, 'profile-1');
    service.constructPrompt = () => { throw new Error('No instruct preset should use basic formatting'); };
    await api.generateMochiOutput([{ role: 'user', content: 'Named text request' }]);
    assert.equal(calls.at(-1).maxTokens, 24, 'Saved text requests use their own preset budget');
    profile.instruct = 'Saved instruct';
    let constructed = 0;
    service.constructPrompt = (messages) => { constructed++; return messages.map((message) => `<saved>${message.content}</saved>`).join(''); };
    await api.generateMochiOutput([{ role: 'user', content: 'Named instruct request' }]);
    assert.equal(constructed, 1, 'Saved instruct formatting is included in the final budget');
    assert.equal(host.mainApi, 'textgenerationwebui');
    assert.equal(JSON.stringify(host.chatCompletionSettings), activeSettings, 'Reading a profile never changes the active API or preset');

    await choose(null);
    host.mainApi = 'openai';
    host.chatMetadata = {};
    host.extensionPrompts = {};
    host.powerUserSettings = {};
    host.getWorldInfoPrompt = async () => ({ worldInfoBefore: '', worldInfoAfter: '' });
    host.promptRegex = (text) => text;
    host.chatCompletionSettings = { openai_max_context: 140, openai_max_tokens: 20, names_behavior: -1 };
    host.chat = Array.from({ length: 2000 }, (_, index) => ({ name: 'Character', is_user: false, mes: `History ${index}`, extra: {} }));
    let model = 'budget-model-one';
    host.getTokenizerModel = () => model;
    const counted = [];
    host.getTokenCountAsync = async (text) => { counted.push(text); return text.length; };
    const input = { blocks: [{ identifier: 'chat_history', isMarker: true }], characters: [], persona: null,
      userName: 'User', characterName: 'Character', userInput: 'Current task', formatGuides: '', idMacroCards: '' };
    const prompt = await api.buildMochiPresetMessages(input);
    assert.ok(prompt.some((message) => message.content === 'History 1999') && !prompt.some((message) => message.content === 'History 0'));
    assert.ok(counted.length < 12 && !counted.includes('History 0'), 'Context counting walks newest-first and stops instead of tokenizing 2000 turns');
    counted.length = 0;
    await api.buildMochiPresetMessages(input);
    assert.equal(counted.length, 0, 'Repeated preset/history tokens are cached');
    model = 'budget-model-two';
    await api.buildMochiPresetMessages(input);
    assert.ok(counted.length > 0, 'Changing the tokenizer/model invalidates cached costs');
    const savedChatText = host.chat.map((message) => message.mes);
    host.chatCompletionSettings.openai_max_context = 90;
    await api.generateMochiOutput(prompt);
    const sent = calls.at(-1).options;
    assert.equal(sent.responseLength, 20, 'Default requests reserve exactly ST’s configured response length');
    assert.ok(sent.prompt.length < prompt.length && sent.prompt.at(-1).content === 'Current task', 'The send boundary rechecks changed limits without removing the current task');
    assert.ok(3 + sent.prompt.reduce((total, message) => total + message.content.length + (message.name || '').length + 4, 0) + sent.responseLength <= 90);
    assert.deepEqual(host.chat.map((message) => message.mes), savedChatText, 'Budgeting never truncates saved roleplay history');
    assert.ok(sent.prompt.every((message) => Reflect.ownKeys(message).every((key) => ['role', 'name', 'content'].includes(key))), 'Removal tags never reach provider payloads');
    const beforeError = calls.length;
    await assert.rejects(api.generateMochiOutput([{ role: 'system', content: 'x'.repeat(500) }, { role: 'user', content: 'Task' }]), /exceed the selected context/);
    assert.equal(calls.length, beforeError, 'An oversized non-removable preset fails before a provider request');
    host.chatCompletionSettings = { openai_max_context: 20, openai_max_tokens: 24 };
    assert.throws(() => api.getMochiTokenLimits(), /exceed the selected context/);

    // Long formatted text prompts must not be recounted once per old turn.
    host.mainApi = 'textgenerationwebui';
    host.maxContext = 240;
    host.maxResponseTokens = 32;
    host.formatRawPrompt = (messages) => messages.map((message) => `TC_HEADER:${message.content}:TC_END\n`).join('');
    counted.length = 0;
    const history = Array.from({ length: 1500 }, (_, index) => ({ role: 'assistant', content: `Text history ${index}` }));
    const task = { role: 'user', content: 'Final TC task' };
    api.markMochiBudgetCandidates(history, [], false);
    const bounded = await api.fitMochiPromptToContext([...history, task], limits(240, 32));
    const formatted = host.formatRawPrompt(bounded);
    assert.ok(formatted.length + 3 + 32 <= 240 && bounded.at(-1) === task);
    assert.equal(bounded.at(-2), history.at(-1), 'Formatted TC trimming keeps newest whole history messages');
    assert.ok(counted.length <= Math.ceil(Math.log2(history.length)) + 3, 'Final TC trimming uses logarithmically many full tokenizer calls');
    assert.equal(history.length, 1500, 'Final fitting never modifies the original message collection');
    counted.length = 0;
    host.textCompletionSettings = { type: 'ollama', ollama_model: 'text-model-one', server_urls: { ollama: 'http://offline.invalid/one' } };
    host.getTextGenServer = () => host.textCompletionSettings.server_urls.ollama;
    const textModelMessage = { role: 'user', content: 'Text model cache' };
    await api.countMochiMessageTokens(textModelMessage, api.getMochiTokenLimits());
    await api.countMochiMessageTokens(textModelMessage, api.getMochiTokenLimits());
    assert.equal(counted.length, 1);
    host.textCompletionSettings.ollama_model = 'text-model-two';
    await api.countMochiMessageTokens(textModelMessage, api.getMochiTokenLimits());
    host.textCompletionSettings.server_urls.ollama = 'http://offline.invalid/two';
    await api.countMochiMessageTokens(textModelMessage, api.getMochiTokenLimits());
    assert.equal(counted.length, 3, 'Text-completion model and remote tokenizer endpoint changes invalidate token costs');

    host.mainApi = 'openai';
    host.chatCompletionSettings = { openai_max_context: 74, openai_max_tokens: 20 };
    delete host.formatRawPrompt;
    const realHistory = [{ role: 'assistant', content: 'Recent real reply' }];
    const examples = [[{ role: 'system', name: 'example_user', content: 'Example question' }, { role: 'system', name: 'example_assistant', content: 'Example answer' }]];
    const userTask = { role: 'user', content: 'Task' };
    api.markMochiBudgetCandidates(realHistory, examples, false);
    const unpinned = await api.fitMochiPromptToContext([...examples[0], ...realHistory, userTask], api.getMochiTokenLimits());
    assert.deepEqual(unpinned, [...realHistory, userTask], 'Unpinned example collections yield to real history as a whole');
    host.chatCompletionSettings.openai_max_context = 110;
    api.markMochiBudgetCandidates(realHistory, examples, true);
    const pinned = await api.fitMochiPromptToContext([...examples[0], ...realHistory, userTask], api.getMochiTokenLimits());
    assert.deepEqual(pinned, [...examples[0], userTask], 'Pinned examples keep both speakers together ahead of old history');
    let invalid = true;
    host.getTokenCountAsync = async (text) => invalid ? NaN : text.length;
    const retryMessage = { role: 'user', content: 'Tokenizer recovery' };
    await assert.rejects(api.fitMochiPromptToContext([retryMessage], api.getMochiTokenLimits()), /invalid token count/);
    invalid = false;
    assert.deepEqual(await api.fitMochiPromptToContext([retryMessage], api.getMochiTokenLimits()), [retryMessage], 'A failed token count is not retained in the cache');
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(host, key, descriptor); else delete host[key];
    }
    host.extensionSettings = extensionSettings;
  }
  console.log('PASS: cached typed archive indexes, buried/deleted/swiped records, configured native/profile token limits, lazy history counting, token-cache invalidation, final formatted budgets, and whole example retention');
}
