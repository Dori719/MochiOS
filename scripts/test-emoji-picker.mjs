import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/components/chat/conversation-emoji.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { EMOJI_GROUPS, filterEmojiGroups } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const values = (query, category) => filterEmojiGroups(query, category).flatMap((group) => group.emojis.map((emoji) => emoji.value));
assert.equal(new Set(values('')).size, values('').length, 'choices have unique keyboard identities');
assert.ok(EMOJI_GROUPS.every((group) => group.emojis.every((emoji) => emoji.label.trim())));
assert.ok(values('  :THUMBS_UP:  ').includes('👍'));
assert.ok(values('ｐａｒｔｙ').includes('🥳'));
assert.ok(values('❤').includes('❤️'));
assert.ok(values('love', 'hearts').includes('❤️'));
assert.ok(!values('love', 'hearts').includes('😍'));
assert.deepEqual(values('nonexistent-expression'), []);
assert.ok(values('happy grin').includes('😃'));
assert.deepEqual(filterEmojiGroups('', 'gestures').map((group) => group.id), ['gestures']);
console.log('PASS emoji picker: labels, categories, multiword search, aliases, Unicode normalization and empty results');
