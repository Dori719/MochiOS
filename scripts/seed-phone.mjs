/**
 * Seed a chat's metadata with a Mochi OS phone, for testing the read path.
 *
 *   node scripts/seed-phone.mjs <chat.jsonl>
 *
 * Generation needs a live model, which a test checkout has none of. Writing the
 * stored shape directly is what lets the read path, the thread renderers and the
 * persistence round trip be exercised without one.
 */
import fs from 'node:fs';

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
  console.error('usage: node scripts/seed-phone.mjs <chat.jsonl>');
  process.exit(1);
}

const phoneDataYaml = `<phone_data>
user:
  id: "moonlit"
  nickname: "Moonlit"
  bio: "Night-shift radio listener. Collects songs that feel like rain."
  email: "moonlit@postbox.local"
characters:
  - id: "aria"
    name: "Aria"
    contactname: "Aria ♪"
    bio: "Runs the late-night show. Sends voice notes instead of typing."
    onlinestyle: "on air until 3"
groups:
  - name: "The Night Shift"
    description: "Three people who should be asleep."
    main_members: ["Aria", "Jun"]
    other_members: ["Vale"]
</phone_data>`;

const threadYaml = `<privatechat_history target="Aria ♪" type="private">
name: Aria ♪
date: October 16, 2026
time: "23:41"
emotion: warm
location: Studio B
state: leaning over the desk, one headphone half off, the on-air light still burning behind her
thought: they finally answered. do not make it weird.
messages:
  - t: text
    c: you're still up? the show's been running for two hours.
    time: "23:41"
  - t: transfer
    amt: 40.00
    note: "for the coffee you pretended not to buy me"
    time: "23:44"
  - t: quote
    quote:
      name: Moonlit
      t: text
      c: long shift
    c: long shift deserves long-shift pay
    time: "23:47"
  - t: sticker
    c: sticker:heart_hands:
    time: "23:48"
  - t: text
    c: accepted. obviously. now put your phone down, the next song is yours.
    time: "23:49"
</privatechat_history>
<environment>
timezone: Asia/Shanghai
date: October 16, 2026
time: "23:49"
location: Studio B
temperature: "18°C"
weather: Light rain
</environment>

<privatechat_history target="Aria ♪" type="private">
name: Aria ♪
date: October 17, 2026
time: "00:12"
emotion: sleepy
location: Studio B
state: curled into the chair with the desk lamp off, phone brightness at its lowest
messages:
  - t: text
    c: hey. song's out.
    time: "00:12"
  - t: voice
    c: here's what I almost played instead. don't judge the second verse.
    time: "00:14"
</privatechat_history>
<environment>
timezone: Asia/Shanghai
date: October 17, 2026
time: "00:14"
location: Studio B
temperature: "17°C"
weather: Clear
</environment>
`;

const groupYaml = `<chat_history target="The Night Shift" type="group">
name: The Night Shift
date: October 17, 2026
time: "00:31"
members: 3
messages:
  - t: text
    {{user}}: true
    c: are you two still up?
    time: "00:29"
  - t: text
    c: define still. jun fell asleep during the chorus again.
    time: "00:30"
    sender:
      name: Aria
  - t: text
    c: I plead the fifth. my feet are dead.
    time: "00:31"
    sender:
      name: Jun
</chat_history>
<environment>
timezone: Asia/Shanghai
date: October 17, 2026
time: "00:31"
location: Aria's flat
temperature: "16°C"
weather: Clear
</environment>`;

const mochios = {
  version: 1,
  phoneDataYaml,
  threads: [
    { id: 'dm-aria', target: 'Aria ♪', type: 'private', yaml: threadYaml, updatedAt: Date.now() },
    { id: 'group-the-night-shift', target: 'The Night Shift', type: 'group', yaml: groupYaml, updatedAt: Date.now() },
  ],
};

const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
const header = JSON.parse(lines[0]);
header.chat_metadata = { ...header.chat_metadata, mochios };
lines[0] = JSON.stringify(header);

fs.writeFileSync(target, `${lines.join('\n')}\n`);
console.log(`seeded a phone into ${target}`);