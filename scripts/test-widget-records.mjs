import assert from 'node:assert/strict';

export function runWidgetRecordTests(api) {
  const record = (opener, closer, text = 'Compatible message') => `<${opener}>\nmessages:\n  - t: text\n    c: ${text}\n    sender: {name: User}\n</${closer}>`;
  const privateRecord = record('privatechat_history target="Character"', 'privatechat_history');
  const groupRecord = record('groupchat_history target="Group"', 'groupchat_history', 'Group message');
  const env = '<environment>\nweather: Rainy\ntime: "12:00"\n</environment>';
  for (const content of [
    privateRecord,
    privateRecord + '\n' + env,
    record('privatechat_history type="private" target="Character"', 'privatechat_history'),
    record("PRIVATECHAT_HISTORY other='value'\n type = 'PRIVATE'\n target = 'Character'", 'PRIVATECHAT_HISTORY'),
    record('chat_history target="Character" type="private"', 'privatechat_history'),
    record('chat_history type="private" target="Character"', 'chat_history'),
    record('privatechat_history', 'privatechat_history').replace('messages:', 'contactname: Legacy Contact\nmessages:'),
  ]) {
    assert.ok(api.mayContainMochiWidget(content), 'The entry point loads private transcripts without requiring environment or a type attribute');
    const parts = api.parseMochiChatContent(content, 'User');
    const widget = parts.find((part) => part.type === 'widget')?.value;
    assert.ok(widget, 'Every supported private envelope produces a widget');
    assert.equal(widget.chat.type, 'private');
    assert.equal(widget.chat.messages[0].me, 1, 'Inline widgets recognize the roleplay user from sender names');
    assert.equal(api.parseMochiGroupChatContent(content).length, 0, 'Private transcripts are never misclassified as group transcripts');
    assert.equal(api.parseChatHistoryBlocks(content)[0].target, widget.chat.target, 'Widget and archive readers agree on the contact identity');
  }
  for (const content of [
    groupRecord,
    record('chat_history type="group" target="Group"', 'groupchat_history'),
    record("group_message target = 'Group'", 'group_message'),
    record('group_message', 'group_message').replace('messages:', 'name: Group\nmessages:'),
  ]) {
    assert.ok(api.mayContainMochiWidget(content), 'Drawing-guide group_message tags also trigger lazy loading');
    assert.equal(api.parseMochiChatContent(content)[0].value.chat.type, 'group');
    assert.equal(api.parseMochiPrivateChatContent(content).length, 0);
    assert.equal(api.parseChatHistoryBlocks(content)[0].type, 'group');
  }
  for (const [first, second] of [[privateRecord, groupRecord], [groupRecord, privateRecord]]) {
    const parts = api.parseMochiChatContent(`Before.\n${first}\n${env}\nBetween.\n${second}\nAfter.`);
    assert.equal(parts.filter((part) => part.type === 'widget').length, 2, 'Mixed private/group messages render both record types in either order');
    assert.deepEqual(parts.filter((part) => part.type === 'text').map((part) => part.value), ['Before.\n', '\nBetween.\n', '\nAfter.']);
    assert.equal(parts[1].value.environment.weather, 'Rainy');
    assert.deepEqual(parts[3].value.environment, {}, 'An environment belongs only to its adjacent record');
  }
  const invalidEnv = '<environment>Not environment data</environment>';
  const invalidParts = api.parseMochiChatContent(privateRecord + '\n' + invalidEnv);
  assert.equal(invalidParts[0].type, 'widget', 'Missing/invalid environment does not hide a valid transcript');
  assert.equal(invalidParts[1].value, '\n' + invalidEnv, 'Unparseable environment remains in the host-formatted prose');
  const spacedEnv = '<environment source="phone">\nweather: Snowy\n</environment >';
  assert.equal(api.parseMochiChatContent(privateRecord + '\n' + spacedEnv)[0].value.environment.weather, 'Snowy');
  const incomplete = '<privatechat_history target="Unfinished">\nmessages:\n';
  const recovered = api.parseMochiChatContent(incomplete + groupRecord);
  assert.equal(recovered[0].value, incomplete, 'Incomplete markup remains text without swallowing the next valid record');
  assert.equal(recovered[1].value.chat.type, 'group');
  const unfinishedEnv = '<environment>\nweather: Unfinished\n';
  const envRecovery = api.parseMochiChatContent(privateRecord + '\n' + unfinishedEnv + groupRecord + '\n' + env);
  assert.equal(envRecovery.filter((part) => part.type === 'widget').length, 2, 'Unfinished environment markup cannot consume a later record');
  assert.equal(envRecovery[1].value, '\n' + unfinishedEnv);
  assert.equal(envRecovery[2].value.environment.weather, 'Rainy', 'A later environment stays with its own group');
  for (const content of ['', 'Ordinary roleplay mentions chat_history.', '<phone_data>messages: []</phone_data>',
    '<messages>messages: []</messages>', incomplete, record('privatechat_history target="Character"', 'privatechat_history').replace('messages:', 'unrelated:'),
    '<privatechat_history target="Character">\nmessages: [\n</privatechat_history>']) {
    assert.deepEqual(api.parseMochiChatContent(content), [], 'Only complete, compatible transcripts replace SillyTavern rendering');
  }
  console.log('PASS: private/group/drawing envelopes, optional environment, mixed records, attribute compatibility, sender identities, and preserved malformed/unrelated prose');
}
