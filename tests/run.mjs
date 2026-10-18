/**
 * Verification suite for the parts that have to be exactly right: the record
 * layer (ported from the engine's Fastify route) and the ported thread
 * renderers (rendered to markup and inspected).
 *
 *   node tests/run.mjs
 *
 * The render half matters because the widget layer is ported verbatim: rendering
 * it outside the browser proves the archive really does reach it in the shape it
 * expects, including the transfer, quote and sticker cases.
 */
import assert from 'node:assert/strict';

import {
  appendPrivateChatTurn,
  cleanAndExtractRawYaml,
  extractAndParsePhoneDataYaml,
  extractPrivateChatTurn,
  finalizeTurn,
  normalizeMochiRecordScalarQuoting,
  normalizeUserFlagKey,
  updateThreadMessageYaml,
} from '../src/core/records.ts';
import { protectTemplateBraces, restoreTemplateBraces } from '../src/core/generate.ts';
import {
  mergeMochiChatHistoryBlocks,
  parseChatHistoryBlocks,
  removeLastMochiChatRecord,
} from '../src/mochi/utils.ts';
import { buildThreadHistory } from '../src/core/prompt.ts';
import { normalizeMochiOsSettings } from '../src/mochi/schema.ts';
import { threadView, contactsFrom, groupsFrom } from '../src/ui/model.ts';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MochiPrivateChatThread } from '../src/mochi/PrivateChatWidget.tsx';
import { MochiGroupChatThread } from '../src/mochi/GroupChatWidget.tsx';

let passed = 0;
const failures: string[] = [];

function test(name: string, run: () => void): void {
  try {
    run();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error: any) {
    failures.push(`${name}: ${error?.message ?? error}`);
    console.log(`  FAIL ${name}\n       ${error?.message ?? error}`);
  }
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** A model reply shaped the way the format guide asks for. */
const MODEL_TURN = `<think>the user asked about the shift, reply with two messages</think>
<privatechat_history target="Aria ♪" type="private">
name: Aria ♪
date: October 17, 2026
time: "00:12"
messages:
  - t: text
    c: hey. song's out.
    time: "00:12"
</privatechat_history>
<environment>
timezone: Asia/Shanghai
date: October 17, 2026
time: "00:12"
location: Studio B
temperature: "17°C"
weather: Clear
</environment>`;

const USER_TURN = `<privatechat_history target="Aria ♪" type="private">
name: Aria ♪
date: October 16, 2026
time: "23:41"
messages:
  - id: msg_001
    t: text
    c: you're still up? the show's been running for two hours.
    time: "23:41"
  - id: msg_002
    t: transfer
    {{user}}: true
    amt: 40.00
    note: "for the coffee you pretended not to buy me"
    time: "23:44"
  - id: msg_003
    t: quote
    quote:
      name: Moonlit
      t: text
      c: long shift
    c: long shift deserves long-shift pay
    time: "23:47"
  - id: msg_004
    t: sticker
    c: "sticker:heart_hands:"
    time: "23:48"
  - id: msg_005
    t: text
    c: accepted. obviously. now put your phone down.
    time: "23:49"
</privatechat_history>`;

/**
 * The second turn as the archive really stores it: the model response run
 * through `finalizeTurn`, which is what strips the think block and files the
 * user's own line into the record.
 */
const SECOND_TURN = finalizeTurn({
  rawOutput: MODEL_TURN,
  target: 'Aria ♪',
  recordType: 'private',
  userLines: ['did you eat?'],
  userName: 'Moonlit',
});

/* ------------------------------------------------------------------ *
 * Record layer
 * ------------------------------------------------------------------ */

console.log('\nrecord layer');

test('strips code fences, think blocks and the wrapper tag', () => {
  const wrapped = '```yaml\n<phone_data>\nuser:\n  id: x\n</phone_data>\n```';
  assert.equal(cleanAndExtractRawYaml(wrapped), 'user:\n  id: x');
  assert.equal(cleanAndExtractRawYaml('<think>hmm</think>\nname: Aria'), 'name: Aria');
});

test('extracts one turn and keeps its environment', () => {
  const turn = extractPrivateChatTurn(MODEL_TURN);
  assert.match(turn, /<privatechat_history/);
  assert.match(turn, /<environment>/);
  assert.match(turn, /hey\. song's out\./);
});

test('finalizeTurn archives the user line with the {{user}} marker', () => {
  const turn = finalizeTurn({
    rawOutput: MODEL_TURN,
    target: 'Aria ♪',
    recordType: 'private',
    userLines: ['did you eat?'],
    userName: 'Moonlit',
  });

  assert.match(turn, /\{\{user\}\}: true/, 'user marker must stay literal');
  assert.match(turn, /did you eat\?/, 'the user line must be archived');
  assert.match(turn, /<privatechat_history target="Aria ♪" type="private">/);
  assert.match(turn, /<environment>/);
});

test('a quoted user line becomes a quote item, not plain text', () => {
  // The marker is what the ported `formatUserMsgForAi` writes for a quote reply:
  // the quoted line, then the reply on its own `[Text]` line.
  const turn = finalizeTurn({
    rawOutput: MODEL_TURN,
    target: 'Aria ♪',
    recordType: 'private',
    userLines: ['[Quote Aria ♪] song\'s out\n[Text] yes, that one'],
  });
  assert.match(turn, /- t: quote/);
  assert.match(turn, /name: Aria ♪/);
  assert.match(turn, /yes, that one/, 'the reply survives as the item body');
  assert.match(turn, /song's out/, 'the quoted line is kept for the model');
});

test('a user transfer marker becomes a transfer item', () => {
  const turn = finalizeTurn({
    rawOutput: MODEL_TURN,
    target: 'Aria ♪',
    recordType: 'private',
    userLines: ['[Transfer: 12.50 · dinner money]'],
  });
  assert.match(turn, /- t: transfer\b/);
  assert.match(turn, /amt: 12\.50/);
  assert.match(turn, /note: "dinner money"/);
});

test('a continuation archives no user message at all', () => {
  const turn = finalizeTurn({
    rawOutput: MODEL_TURN,
    target: 'Aria ♪',
    recordType: 'private',
    userLines: [],
  });
  assert.doesNotMatch(turn, /\{\{user\}\}/);
});

test('a group turn is wrapped and attributed for the group record type', () => {
  const turn = finalizeTurn({
    rawOutput: MODEL_TURN,
    target: 'The Night Shift',
    recordType: 'group',
    userLines: ['morning'],
    userName: 'Moonlit',
  });
  assert.match(turn, /<chat_history target="The Night Shift" type="group">/);
  assert.match(turn, /<\/groupchat_history>/);
  assert.match(turn, /sender:\s*\n\s*name: Moonlit/);
});

test('quoted times are written unquoted, the way the archive stores them', () => {
  assert.equal(normalizeMochiRecordScalarQuoting('time: "00:12"'), 'time: 00:12');
  assert.equal(normalizeUserFlagKey('"{{user}}": true'), '{{user}}: true');
});

test('turns append below the previous turn, in order', () => {
  const archive = appendPrivateChatTurn(appendPrivateChatTurn('', USER_TURN), SECOND_TURN);
  const order = [...archive.matchAll(/target="Aria ♪"/g)];
  assert.equal(order.length, 2);
  assert.ok(archive.indexOf('23:41') < archive.indexOf('00:12'), 'earlier turn stays first');
});

test('deleting a message removes only that message', () => {
  const archive = appendPrivateChatTurn(USER_TURN, SECOND_TURN);
  const trimmed = updateThreadMessageYaml(archive, 'msg_005', undefined, { target: 'Aria ♪' });
  assert.doesNotMatch(trimmed, /now put your phone down/, 'the deleted message is gone');
  assert.match(trimmed, /you.re still up/, 'the rest of the record survives');
  assert.match(trimmed, /song.s out/, 'the following record is untouched');
});

test('deleting the last character message drops the whole turn', () => {
  // The user item belongs to the turn the character answered, so a record left
  // with nothing but the user's own line is an orphan and goes too.
  const onlyCharacterReply = `<privatechat_history target="Aria ♪" type="private">
contactname: Aria ♪
date: October 18, 2026
time: "02:10"
messages:
  - id: msg_010
    t: text
    {{user}}: true
    c: still there?
    time: "02:09"
  - id: msg_011
    t: text
    c: barely. go to sleep.
    time: "02:10"
</privatechat_history>`;

  const trimmed = updateThreadMessageYaml(onlyCharacterReply, 'msg_011', undefined, { target: 'Aria ♪' });
  assert.equal(trimmed, '', 'the orphaned record is removed rather than kept');
});

test('regeneration removes only the newest record', () => {
  const archive = appendPrivateChatTurn(USER_TURN, SECOND_TURN);
  const trimmed = removeLastMochiChatRecord(archive, 'Aria ♪', undefined, { recordType: 'private' });
  assert.match(trimmed, /23:41/, 'the first turn stays');
  assert.doesNotMatch(trimmed, /song\'s out\./, 'the regenerated turn is dropped');
});

test('phone data parses out of a wrapped document', () => {
  const parsed = extractAndParsePhoneDataYaml(
    '<phone_data>\nuser:\n  nickname: Moonlit\ncharacters:\n  - name: Aria\n    contactname: "Aria ♪"\ngroups:\n  - name: Night Shift\n    main_members: ["Aria", "Jun"]\n</phone_data>',
  );
  assert.equal(parsed.user.nickname, 'Moonlit');
  assert.equal(parsed.characters[0].contactname, 'Aria ♪');
  assert.equal(parsed.groups[0].name, 'Night Shift');
});

/* ------------------------------------------------------------------ *
 * Brace protection
 * ------------------------------------------------------------------ */

console.log('\ngeneration');

test('template braces survive SillyTavern macro substitution', () => {
  const payload = 'archive:\n  {{user}}: true\n  time: "{{Time}}"';
  const sent = protectTemplateBraces(payload);
  assert.doesNotMatch(sent, /\{\{/, 'no macro can match on the way out');
  assert.equal(restoreTemplateBraces(sent), payload);
});

/* ------------------------------------------------------------------ *
 * Prompt assembly
 * ------------------------------------------------------------------ */

console.log('\nprompt assembly');

test('history is rebuilt from the archive, private and group kept apart', () => {
  const archive = appendPrivateChatTurn(USER_TURN, SECOND_TURN);
  const priv = buildThreadHistory(archive, 'private');
  assert.match(priv, /23:41/);
  assert.match(priv, /00:12/);

  const asGroup = buildThreadHistory(archive, 'group');
  assert.equal(asGroup, '', 'a private record is never fed to a group turn');
});

/* ------------------------------------------------------------------ *
 * View models
 * ------------------------------------------------------------------ */

console.log('\nview models');

test('a thread reads back as one continuous conversation', () => {
  const archive = appendPrivateChatTurn(USER_TURN, SECOND_TURN);
  const blocks = parseChatHistoryBlocks(archive, 'Moonlit', { recordType: 'private' });
  const merged = mergeMochiChatHistoryBlocks(blocks);
  assert.equal(merged.length, 1, 'both turns belong to one contact');
  assert.equal(merged[0].messages.length, 7, 'five from the first turn, two from the second');

  const view = threadView(
    { id: 'dm-aria', target: 'Aria ♪', type: 'private', yaml: archive, updatedAt: 0 },
    'Moonlit',
  );
  assert.ok(view, 'the phone has something to render');
  assert.equal(view.environment.time, '00:12', 'the newest environment describes now');
  assert.equal(
    view.chat.messages.filter((message) => message.me).length,
    2,
    'the transfer and the second turn\'s own line are the user\'s',
  );
});

test('contacts and groups come out of a generated phone document', () => {
  const phoneData = extractAndParsePhoneDataYaml(
    '<phone_data>\ncharacters:\n  - name: Aria\n    contactname: "Aria ♪"\n    onlinestyle: "on air"\ngroups:\n  - name: Night Shift\n    main_members: ["Aria", "Jun"]\n    other_members: Vale\n</phone_data>',
  );
  const contacts = contactsFrom(phoneData);
  assert.equal(contacts[0].name, 'Aria ♪', 'the contact name the user chose wins');
  assert.equal(contacts[0].status, 'on air');

  const groups = groupsFrom(phoneData);
  assert.equal(groups[0].memberCount, 3, 'a comma-separated roster is read too');
});

test('settings are coerced rather than trusted', () => {
  const settings = normalizeMochiOsSettings({
    theme: 'neon',
    currency: 'bitcoin',
    wxTemp: Number.NaN,
    customRgb: { r: 999, g: -4 },
  });
  assert.equal(settings.theme, 'auto', 'an unknown enum falls back to the default');
  assert.equal(settings.currency, '$');
  assert.equal(settings.wxTemp, 20, 'NaN is treated as missing');
  assert.deepEqual(settings.customRgb, { r: 255, g: 0, b: 97 });
});

/* ------------------------------------------------------------------ *
 * Ported renderers
 * ------------------------------------------------------------------ */

console.log('\nported renderers');

function renderPrivate(archive: string): string {
  const view = threadView({ id: 't', target: 'Aria ♪', type: 'private', yaml: archive, updatedAt: 0 }, 'Moonlit')!;
  return renderToStaticMarkup(createElement(MochiPrivateChatThread, { data: view }));
}

test('a private thread renders its bubbles, transfer card and quote', () => {
  const markup = renderPrivate(USER_TURN);
  assert.match(markup, /mochi-private-thread/);
  // Markup is HTML-escaped, so apostrophes arrive as entities.
  assert.match(markup, /still up\?/, 'a text bubble is rendered');
  assert.match(markup, /mochi-private-transfer/, 'the transfer card is rendered by the port');
  assert.match(markup, /\$40\.00/, 'the amount is shown with the currency');
  assert.match(markup, /coffee you pretended not to buy me/, 'the memo is shown');
  assert.match(markup, /mochi-private-quoted-message/, 'the quote is rendered');
  assert.match(markup, /long shift/, 'the quoted text is shown');
  assert.match(markup, /sticker:heart_hands:/, 'an unresolved sticker falls back to its name');
});

test('the environment panel renders what the model wrote', () => {
  const markup = renderPrivate(SECOND_TURN);
  assert.match(markup, /mochi-private-environment/);
  assert.match(markup, /Studio B/);
  assert.match(markup, /Asia\/Shanghai/);
});

test('a group thread renders sender names', () => {
  const groupArchive = `<chat_history target="The Night Shift" type="group">
name: The Night Shift
date: October 17, 2026
time: "01:02"
members: 3
messages:
  - t: text
    c: she fell asleep during the chorus again
    time: "01:02"
    sender:
      name: Jun
</chat_history>
<environment>
date: October 17, 2026
time: "01:02"
location: Aria's flat
</environment>`;

  const view = threadView(
    { id: 'g', target: 'The Night Shift', type: 'group', yaml: groupArchive, updatedAt: 0 },
    'Moonlit',
  )!;
  const markup = renderToStaticMarkup(createElement(MochiGroupChatThread, { data: view }));
  assert.equal(markup.includes('she fell asleep during the chorus'), true, markup.slice(0, 400));
  assert.match(markup, /mochi-msg-sender[^>]*>Jun</, 'the sender is attributed');
  assert.match(markup, /she fell asleep during the chorus/);
});

/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}