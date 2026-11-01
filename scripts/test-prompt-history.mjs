import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Optional read-only comparison with the user's actual SillyTavern source.
 * Only isolated formatter functions run, never ST's application or a request. */
async function readNativeFormatters() {
  const argument = process.argv.indexOf('--st-reference');
  const directory = argument >= 0 ? process.argv[argument + 1] : process.env.SILLYTAVERN_REFERENCE_DIR;
  if (!directory) return null;
  assert.ok(typeof directory === 'string' && !directory.startsWith('--'), '--st-reference needs a SillyTavern directory');
  const [openai, script] = await Promise.all([
    fs.readFile(path.join(directory, 'public/scripts/openai.js'), 'utf8'),
    fs.readFile(path.join(directory, 'public/script.js'), 'utf8'),
  ]);
  const compile = (source, name, environment) => {
    // Top-level function closers start at column zero; nested closers do not.
    const definition = source.match(new RegExp(`^(?:export )?function ${name}\\([\\s\\S]*?^}`, 'm'))?.[0];
    assert.ok(definition, `Native ${name} must exist in the reference installation`);
    return Function(...Object.keys(environment), `${definition.replace(/^export /, '')}\nreturn ${name};`)(...Object.values(environment));
  };
  return {
    history(host, settings, ignore, core) {
      const serialize = compile(openai, 'setOpenAIMessages', {
        oai_settings: settings, getChatCompletionModel: () => 'offline-model', IGNORE_SYMBOL: ignore,
        system_message_types: { NARRATOR: 'narrator' }, character_names_behavior: { NONE: -1, DEFAULT: 0, COMPLETION: 1, CONTENT: 2 },
        selected_group: host.groupId, name1: host.name1, name2: host.name2,
        getMediaDisplay: () => 'list', getMediaIndex: () => 0,
      });
      // populateChatHistory reverses setOpenAIMessages' newest-first collection,
      // expands macros, and includes sanitized names only in COMPLETION mode.
      return serialize(core).filter(Boolean).reverse().map((message) => ({
        role: message.role, content: host.substituteParams(message.content),
        ...(settings.names_behavior === 1 && message.name ? { name: message.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64) } : {}),
      })).filter((message) => message.content);
    },
    textHistory(host, ignore, core, messages) {
      const format = compile(script, 'formatMessageHistoryItem', {
        system_message_types: { NARRATOR: 'narrator' }, name1: host.name1, name2: host.name2,
        IGNORE_SYMBOL: ignore, formatInstructModeChat: () => { throw new Error('Instruct is disabled in this text fixture'); },
      });
      const raw = compile(script, 'createRawPrompt', {
        power_user: { instruct: { enabled: false } }, name1: host.name1, name2: host.name2,
        substituteParams: host.substituteParams.bind(host), formatInstructModeChat: () => {}, formatInstructModeStoryString: () => {},
        formatInstructModePrompt: () => {}, adjustNovelInstructionPrompt: (text) => text,
      });
      assert.equal(raw(messages.map((message) => ({ ...message })), 'textgenerationwebui', false, false, '', ''),
        core.map((message) => format(message, false, false)).join('').replace(/\r/g, ''),
        'Native raw text requests reproduce ST speaker-prefixed history without double names');
    },
  };
}

export async function runPromptHistoryTests({ api, host, choose, calls }) {
  const native = await readNativeFormatters();
  const keys = ['chat', 'chatMetadata', 'groupId', 'mainApi', 'name1', 'name2', 'symbols', 'chatCompletionSettings', 'powerUserSettings',
    'extensionPrompts', 'promptRegex', 'getWorldInfoPrompt', 'getTokenCountAsync', 'ConnectionManagerRequestService', 'CONNECT_API_MAP', 'getPresetManager'];
  const saved = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  const extensionSettings = structuredClone(host.extensionSettings);
  const ignore = Symbol('ignore-history');
  const config = { maxMessages: 0, includeSystem: false, includeUser: true, tagFilters: [] };
  const marker = { identifier: 'chat_history', isMarker: true };
  const input = { blocks: [marker], characters: [], persona: null, userName: 'Phone Persona', characterName: 'Private Contact',
    userInput: 'New phone task', formatGuides: '', idMacroCards: '', historyConfig: config };
  const privateRecord = (text, me = false) => `<privatechat_history target="Character">\nmessages:\n  - t: text\n    c: ${text}\n    {{user}}: ${me}\n</privatechat_history>`;
  try {
    await choose(null);
    host.mainApi = 'openai'; host.groupId = null; host.name1 = 'User'; host.name2 = 'Character';
    host.symbols = { ignore }; host.chatMetadata = {}; host.extensionPrompts = {}; host.powerUserSettings = {};
    host.getWorldInfoPrompt = async () => ({ worldInfoBefore: '', worldInfoAfter: '' });
    host.getTokenCountAsync = async () => 1;
    const fixture = () => [
      { name: 'Character', mes: '  Greeting for {{user}}\r\n', extra: {} },
      { name: 'User', is_user: true, mes: 'Input for {{char}}', extra: { files: [{ text: 'File one' }, { text: 'File two' }], media: [{ title: 'Photo title', append_title: true }] } },
      { name: 'Other-Character', mes: '    Indented reply\r\n\n', force_avatar: 'other.png', extra: {} },
      { name: 'Narrator', mes: '\nNarration\r\n', extra: { type: 'narrator' } },
      { name: 'System', is_system: true, mes: 'Hidden system turn', extra: {} },
      { name: 'Character', mes: 'Ignored turn', extra: { [ignore]: true } },
      { name: 'User', is_user: true, mes: privateRecord('Legacy user item', true), extra: { mochiosTurnId: 'legacy-turn' } },
      { name: 'Other-Character', mes: privateRecord('Legacy reply'), force_avatar: 'other.png', extra: { mochiosTurnId: 'legacy-turn' } },
      { name: 'Other-Character', mes: '', extra: {} },
    ];
    const baseContents = ['  Greeting for User\n', 'File one\n\nFile two\n\nInput for Character\n\nPhoto title',
      '    Regexed reply\n\n', '\nNarration\n', privateRecord('Legacy user item', true).replace('{{user}}', 'User'),
      privateRecord('Legacy reply').replace('{{user}}', 'User'), ''];
    const names = ['Character', 'User', 'Other-Character', 'Narrator', 'User', 'Other-Character', 'Other-Character'];
    const roles = ['assistant', 'user', 'assistant', 'system', 'user', 'assistant', 'assistant'];
    const snapshots = (mode, group) => baseContents.flatMap((text, index) => {
      const prefix = mode === 2 ? index !== 3 : mode === 0 && (group && names[index] !== 'User' || index === 2 || index === 5);
      const content = prefix ? `${names[index]}: ${text}` : text;
      return content ? [{ role: roles[index], content, ...(mode === 1 ? { name: names[index].replace('-', '_') } : {}) }] : [];
    });
    for (const group of [false, true]) {
      host.groupId = group ? 'group-42' : null;
      for (const mode of [-1, 0, 1, 2]) {
        host.chat = fixture();
        host.chatCompletionSettings = { openai_max_context: 8192, openai_max_tokens: 512, names_behavior: mode };
        const regexCalls = [];
        host.promptRegex = (text, placement, options) => { regexCalls.push({ text, placement, depth: options.depth }); return text.replace('Indented', 'Regexed'); };
        const originalText = host.chat.map((message) => message.mes);
        const prompt = await api.buildMochiPresetMessages(input);
        const history = prompt.slice(0, -1);
        assert.deepEqual(history, snapshots(mode, group), `Physical ST history preserves all roles, content and names (group=${group}, names=${mode})`);
        assert.deepEqual(regexCalls.map((call) => call.depth), [7, 6, 5, 4, 3, 2, 1, 0], 'Ignored turns count toward native prompt-regex depths; system turns do not');
        assert.equal(regexCalls[0].text, '  Greeting for User\r\n', 'Greeting macros expand before its regex scripts');
        assert.equal(regexCalls[4].text, 'Ignored turn', 'Ignored messages are removed at native history serialization, not before depth calculation');
        assert.deepEqual(host.chat.map((message) => message.mes), originalText, 'Preparing prompt history never edits or combines saved messages');
        assert.equal(host.chat[1].extra.fileLength, undefined, 'Attachment prefix bookkeeping stays on the prompt copy');
        assert.equal(prompt.at(-1).content, input.userInput);
        assert.equal(api.listMessages().filter((message) => message.id === 'legacy-turn').length, 1, 'The UI still reads a split legacy turn as one response');
        if (native) {
          const core = host.chat.filter((message) => !message.is_system).map((message, index) => ({ ...message,
            mes: index === 0 ? '  Greeting for User\r\n' : index === 1 ? 'File one\n\nFile two\n\nInput for {{char}}\n\nPhoto title' : message.mes.replace('Indented', 'Regexed'),
          }));
          assert.deepEqual(history, native.history(host, host.chatCompletionSettings, ignore, core), 'History matches the reference installation’s actual setOpenAIMessages function');
        }
        await api.generateMochiOutput(prompt);
        assert.deepEqual(calls.at(-1).options.prompt, prompt, 'Default requests send the assembled history unchanged and without UI archive metadata');
      }
    }
    host.groupId = null; host.chat = fixture(); host.chatCompletionSettings.names_behavior = -1;
    host.promptRegex = (text) => text.replace('Indented', 'Regexed');
    const physicalLegacyId = api.mapMessage(6).id;
    for (const excludedId of ['legacy-turn', physicalLegacyId]) {
      const prompt = await api.buildMochiPresetMessages({ ...input, excludedMessageIds: [excludedId] });
      assert.ok(!prompt.some((message) => message.content.includes('Legacy user item')), 'Regeneration accepts logical or physical excluded turn ids');
      assert.equal(prompt.some((message) => message.content.includes('Legacy reply')), excludedId !== 'legacy-turn', 'Logical ids exclude every split part; physical ids exclude only their own message');
    }
    const filtered = await api.buildMochiPresetMessages({ ...input, historyConfig: { ...config, includeUser: false, maxMessages: 2 } });
    assert.deepEqual(filtered.slice(0, -1).map((message) => message.content), [baseContents[5]], 'Saved history filters/limits apply after physical-role selection, not to a merged user/assistant turn');

    // A private contact and a different phone persona must not rewrite roleplay
    // history macros or speaker names. All phone request kinds share this path.
    for (const kind of ['data', 'private', 'group']) {
      const prompt = await api.buildMochiPresetMessages({ ...input, userInput: `Task for ${kind}` });
      await api.generateMochiOutput(prompt);
      assert.ok(calls.at(-1).options.prompt.some((message) => message.content.includes('Input for Character')));
      assert.ok(!calls.at(-1).options.prompt.some((message) => /Greeting for Phone Persona|Input for Private Contact/.test(message.content)));
    }

    host.powerUserSettings.reasoning = { add_to_prompts: true, max_additions: 1, prefix: '<think>', suffix: '</think>', separator: '\n' };
    host.groupId = 'group-42';
    host.chat = [
      { name: 'Character', mes: 'Older text', extra: { reasoning: 'Older thoughts' } },
      { name: 'Character', mes: 'Latest main text', extra: { reasoning: 'Latest main thoughts' } },
      { name: 'Other-Character', mes: 'Other text', extra: { reasoning: 'Other thoughts' } },
    ];
    host.promptRegex = (text, placement) => placement === 5 ? `Regexed ${text}` : text;
    const withReasoning = await api.buildMochiPresetMessages({ ...input, historyConfig: api.DEFAULT_FORMAT_GUIDES.historyConfig });
    assert.ok(withReasoning.some((message) => message.content === '<think>Regexed Latest main thoughts</think>\nLatest main text'), 'Configured reasoning survives Mochi filters, with native newest-first limits and reasoning regexes');
    assert.ok(!withReasoning.some((message) => /Older thoughts|Other thoughts/.test(message.content)), 'Reasoning from older turns or other group speakers is not injected');
    assert.equal(host.chat[1].mes, 'Latest main text');
    assert.equal(host.chat[1].extra.reasoning, 'Latest main thoughts');
    host.powerUserSettings = {}; host.groupId = null; host.chat = fixture(); host.promptRegex = (text) => text.replace('Indented', 'Regexed');

    const activeSettings = JSON.stringify(host.chatCompletionSettings);
    host.ConnectionManagerRequestService = { ...host.ConnectionManagerRequestService,
      getProfile: () => ({ id: 'profile-1', api: 'openai', preset: 'Saved history preset' }),
    };
    host.getPresetManager = () => ({ getCompletionPresetByName: () => ({ openai_max_context: 8192, openai_max_tokens: 256, names_behavior: 1 }) });
    await choose('profile-1');
    const named = await api.buildMochiPresetMessages(input);
    assert.deepEqual(named.slice(0, -1), snapshots(1, false), 'A saved connection uses its own speaker-name formatting, not the active preset’s mode');
    await api.generateMochiOutput(named);
    assert.deepEqual(calls.at(-1).messages, named);
    assert.equal(JSON.stringify(host.chatCompletionSettings), activeSettings, 'Formatting a saved-profile request never switches active ST settings');

    await choose(null); host.mainApi = 'textgenerationwebui'; host.chatCompletionSettings.names_behavior = 2;
    const text = await api.buildMochiPresetMessages(input);
    assert.equal(text[2].name, 'Other-Character', 'Text/instruct requests keep original speaker names, not CC-sanitized names');
    assert.equal(text[2].content, baseContents[2], 'CC content-name prefixes never leak into text/instruct formatting');
    assert.ok(!Object.hasOwn(text[3], 'name'), 'Narrator text does not acquire a speaker prefix');
    if (native) {
      const core = host.chat.filter((message) => !message.is_system && !message.extra?.[ignore]).map((message, index) => ({ ...message,
        mes: index === 0 ? '  Greeting for User\n' : index === 1 ? baseContents[1] : host.substituteParams(message.mes.replace('Indented', 'Regexed')).replace(/\r/g, ''),
      }));
      native.textHistory(host, ignore, core, text.slice(0, -1));
    }
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(host, key, descriptor); else delete host[key];
    }
    host.extensionSettings = extensionSettings;
  }
  console.log(`PASS: physical prompt-history parity, roles/names/whitespace, greeting macros, native regex depths, attachments, legacy exclusions, reasoning and saved-profile formatting${native ? ', compared with read-only SillyTavern source' : ''}`);
}
