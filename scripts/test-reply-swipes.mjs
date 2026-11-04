import assert from 'node:assert/strict';

/** Exercise the real generation → canonical transcript → native swipe path.
 * A malformed scalar must never reduce a complete response to its first bubble. */
export async function runReplySwipeTests({ api, host, phonePath, chatPath, choose, setReply }) {
  const fixtures = [
    ["A snapshot of the glade's garden: morning sunlight filtering through the\n      canopy, dewdrops glistening on healing herbs, and a steaming cup of tea\n      left on a mossy stump.", "A snapshot of the glade's garden: morning sunlight filtering through the canopy, dewdrops glistening on healing herbs, and a steaming cup of tea left on a mossy stump."],
    ['"She said "stay here" and kept talking until the end."', 'She said "stay here" and kept talking until the end.'],
    ["'Don't say 'bye' before the rest of this reply.'", "Don't say 'bye' before the rest of this reply."],
    ['The plan is: stay here until morning.', 'The plan is: stay here until morning.'],
    ['"The complete reply is here without its closing quote', 'The complete reply is here without its closing quote'],
    ['"Wait." The rest of this reply must also survive.', '"Wait." The rest of this reply must also survive.'],
    [JSON.stringify('Escaped "quotes", a backslash \\, emoji 🌸 and a newline\nall survive.'), 'Escaped "quotes", a backslash \\, emoji 🌸 and a newline\nall survive.'],
    ['|-\n      First line: keep this colon.\n      c: "This is literal block content."\n      Last line stays too.', 'First line: keep this colon.\nc: "This is literal block content."\nLast line stays too.'],
    ['>-\n      A folded reply\n      keeps every word.', 'A folded reply keeps every word.'],
  ];
  const messageTexts = (content) => api.parseChatHistoryBlocks(content)[0].messages.map((message) => message.text);

  for (const profile of [null, 'profile-1']) {
    await choose(profile);
    for (const category of ['private_chats', 'group_chats']) {
      const group = category === 'group_chats';
      const target = group ? 'Test Group' : 'Character';
      const tag = group ? 'groupchat_history' : 'privatechat_history';
      const envelope = (body, name = target) => `<${tag} type = '${group ? 'group' : 'private'}' target = '${name}'>\ndate: Day 7\ntime: "3:15 PM"\nmessages:\n${body}\n</${tag} >`;
      const original = api.serializeChatHistoryYaml({ targetName: target, recordType: group ? 'group' : 'private', messages: [{ me: 0, type: 'text', text: 'Original swipe', sender: 'Character' }] });
      const start = host.chat.length;
      const turn = await api.request('POST', `${chatPath}/messages`, { role: 'assistant', content: original });
      const generate = () => api.request('POST', `${phonePath}/generate`, {
        category, contactName: target, characterName: target, userName: 'User', continuationOnly: true,
        userMessages: [], messages: [{ role: 'user', content: 'Regenerate this phone reply.' }],
      });
      let swipeCount = 1;
      try {
        for (const [scalar, expected] of fixtures) {
          // Keep later special bubbles/fields too, even when the first scalar is
          // invalid. This distinguishes complete parsing from regex recovery.
          setReply(`<think>Hidden planning</think>\n\`\`\`yaml\n${envelope(`  - t: text\n    c: ${scalar}\n    time: "3:15 PM"\n    sender: {name: Character}\n  - t: quote\n    c: Second complete bubble\n    quote: {name: User, c: Quoted input}\n    sender: {name: Other}\n  - t: voice\n    c: Final voice reply\n    duration: "0:09"\n    sender: {name: Character}`)}\n<environment>\nweather: Rainy\ntime: "3:16 PM"\n</environment>\n\`\`\``);
          const response = await generate();
          const expectedTexts = [expected, 'Second complete bubble', 'Final voice reply'];
          assert.deepEqual(messageTexts(response.rawOutput), expectedTexts, `${category}: full content and every later bubble survive generation`);
          const items = api.parseChatHistoryBlocks(response.rawOutput)[0].messages;
          assert.equal(items[1].rawItem.quote.c, 'Quoted input');
          assert.equal(items[2].dur, '0:09');
          if (group) assert.deepEqual(items.map((message) => message.sender), ['Character', 'Other', 'Character']);
          assert.equal(api.parseMochiChatContent(response.rawOutput).filter((part) => part.type === 'widget').length, 1);

          const saved = await api.request('POST', `${chatPath}/messages/${turn.id}/swipes`, { content: response.rawOutput });
          swipeCount++;
          assert.equal(host.chat.length, start + 1, 'Regeneration retains one native roleplay turn');
          assert.equal(saved.swipeCount, swipeCount);
          assert.equal(host.chat[start].mes, response.rawOutput);
          assert.equal(host.chat[start].swipes.at(-1), response.rawOutput);
          assert.equal(host.chat[start].swipe_info.length, swipeCount);
          assert.deepEqual(messageTexts(api.listMessages().at(-1).content), expectedTexts, 'The phone reads the same complete saved swipe');

          await api.request('PUT', `${chatPath}/messages/${turn.id}/active-swipe`, { index: 0 });
          assert.equal(host.chat[start].mes, original, 'The original response remains intact');
          await api.request('PUT', `${chatPath}/messages/${turn.id}/active-swipe`, { index: swipeCount - 1 });
          host.chat[start] = JSON.parse(JSON.stringify(host.chat[start]));
          assert.deepEqual(messageTexts(api.listMessages().at(-1).content), expectedTexts, 'Swipe selection and export/reload never shorten the new reply');
        }

        // Regression: the reported seven-bubble response has a malformed folded
        // photo caption after four valid messages, followed by two more replies.
        const caption = fixtures[0];
        setReply(envelope(`  - t: text\n    c: Bella is awake and resting\n      peacefully.\n    sender: {name: Seraphina}\n  - t: text\n    c: The wards hold.\n    sender: {name: Thistledown}\n  - t: quote\n    c: Please reinforce the northern boundary.\n    quote: {name: Thistledown, t: text, c: The wards hold.}\n    sender: {name: Seraphina}\n  - t: text\n    c: Already on it.\n    sender: {name: Mossbell}\n  - t: imgdesc\n    c: ${caption[0]}\n    time: 9:56 AM\n    sender: {name: Thistledown}\n  - t: text\n    c: Morning patrol complete.\n    sender: {name: Fernwhisper}\n  - t: text\n    c: Keep your voices gentle.\n    sender: {name: Seraphina}`));
        const recovered = await generate();
        const recoveredItems = api.parseChatHistoryBlocks(recovered.rawOutput)[0].messages;
        assert.equal(recoveredItems.length, 7);
        assert.equal(recoveredItems[4].rawItem.c, caption[1]);
        assert.equal(recoveredItems[4].type, 'imgdesc');
        assert.equal(recoveredItems[6].text, 'Keep your voices gentle.');
        if (group) assert.equal(recoveredItems[4].sender, 'Thistledown');

        // A model can use multiple envelopes for one generated turn. All matching
        // records survive, but another target's replies/environment stay out.
        setReply(`${envelope('  - t: text\n    c: First envelope')}\n<environment>weather: First weather</environment>\n${envelope('  - t: text\n    c: Unrelated reply', 'Unrelated contact')}\n<environment>weather: Unrelated weather</environment>\n${envelope('  - t: text\n    c: Last envelope')}\n<environment>weather: Last weather</environment>`);
        const multiple = await generate();
        assert.deepEqual(messageTexts(multiple.rawOutput), ['First envelope', 'Last envelope']);
        assert.ok(multiple.rawOutput.includes('First weather') && multiple.rawOutput.includes('Last weather') && !multiple.rawOutput.includes('Unrelated'));
        await api.request('POST', `${chatPath}/messages/${turn.id}/swipes`, { content: multiple.rawOutput });
        assert.deepEqual(messageTexts(host.chat[start].mes), ['First envelope', 'Last envelope']);

        // One irreparable item or later envelope rejects the entire response,
        // leaving the old swipe available instead of saving a partial success.
        for (const invalid of [
          envelope('  - t: text\n    c: Valid first bubble\n  - Broken non-object bubble'),
          `${envelope('  - t: text\n    c: Valid first envelope')}\n${envelope('  - t: quote\n    c: Later reply\n    quote: [broken YAML')}`,
          envelope('  - t: text\n    c: Keep this\n    c: Duplicate key must not silently replace text'),
        ]) {
          const before = JSON.stringify(host.chat[start]);
          setReply(invalid);
          await assert.rejects(generate(), /invalid chat YAML.*No partial response was saved/);
          assert.equal(JSON.stringify(host.chat[start]), before);
          assert.equal(host.chat.length, start + 1);
        }
        const beforeIncompatibleList = JSON.stringify(host.chat[start]);
        setReply(`${envelope('  - t: text\n    c: Valid earlier envelope')}\n<${tag} target="${target}">\nmessages: {t: text, c: This incompatible later list must not be lost}\n</${tag}>`);
        await assert.rejects(generate(), /no incoming chat messages/);
        assert.equal(JSON.stringify(host.chat[start]), beforeIncompatibleList, 'An incompatible later list cannot turn into a partial successful swipe');
      } finally {
        await api.request('DELETE', `${chatPath}/messages/${turn.id}`);
      }
      assert.equal(host.chat.length, start);
    }
  }
  console.log('PASS: complete private/group replies, YAML scalar recovery, all envelopes and sender/media fields, native swipes/reload, and no partial saves on invalid output');
}
