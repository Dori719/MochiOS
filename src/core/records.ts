/**
 * Mochi OS record layer.
 *
 * Ported from the engine's `packages/server/src/routes/mochios-data.routes.ts`.
 * Those functions ran server-side: the engine generated a turn on Fastify,
 * post-processed the model's YAML here, and wrote it to a file. A SillyTavern
 * extension has no backend, so the same functions now run in the browser around
 * `generateRaw` output, and the archive lives in `chat_metadata` instead of a
 * file on disk.
 *
 * The regexes, recovery paths and normalization rules are kept as they were:
 * models produce malformed output in the same ways regardless of who called
 * them, and every branch here exists because something real hit it.
 */
import yaml from 'yaml';

/** Strip reasoning traces, code fences and the `<phone_data>` wrapper. */
export function cleanAndExtractRawYaml(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';

  let cleanText = rawText;
  if (cleanText.includes('</think>')) {
    cleanText = cleanText.slice(cleanText.indexOf('</think>') + 8);
  } else if (cleanText.includes('</thinking>')) {
    cleanText = cleanText.slice(cleanText.indexOf('</thinking>') + 11);
  }
  cleanText = cleanText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();

  cleanText = cleanText
    .replace(/^```[a-zA-Z0-9_-]*\s*\n/i, '')
    .replace(/\n```\s*$/i, '')
    .trim();

  const phoneDataMatch = cleanText.match(/^<phone_data>([\s\S]*?)<\/phone_data>$/i);
  if (phoneDataMatch && phoneDataMatch[1]) {
    cleanText = phoneDataMatch[1].trim();
  }

  return cleanText;
}

/** Quote `{{user}}`-style keys so the YAML parser accepts them. */
export function sanitizeYamlTemplateKeys(yamlText: string): string {
  if (!yamlText) return '';
  return yamlText.replace(/^(\s*)\{\{([^}]+)\}\}:/gm, '$1"{{$2}}":');
}

/** Write the `{{user}}` marker back unquoted, the form the archive stores. */
export function normalizeUserFlagKey(yamlText: string): string {
  if (!yamlText) return '';
  return yamlText.replace(/^([ \t]*)(["'])\{\{user\}\}\2(\s*:)/gm, '$1{{user}}$3');
}

/**
 * Drop the quotes a model puts around a time or message body.
 *
 * Both format guides show `time: "{{Time}}"`, so a model quotes every time it
 * writes. Without this a thread alternates between quoted and unquoted YAML
 * depending on which turn wrote it. Only values the YAML library would write
 * plainly are unquoted.
 */
export function normalizeMochiRecordScalarQuoting(yamlText: string): string {
  if (!yamlText) return '';
  return yamlText.replace(
    /^([ \t]*)(time|contactname|c|name|date):[ \t]+"([^"\\\n]*)"[ \t]*$/gm,
    (full, indent: string, key: string, value: string) =>
      yaml.stringify({ probe: value }) === `probe: ${value}\n` ? `${indent}${key}: ${value}` : full,
  );
}

const RECORD_OPEN =
  /<(?:chat_history|privatechat_history|groupchat_history|messages|message)(?:\s+[^>]*)*>([\s\S]*?)<\/(?:chat_history|privatechat_history|groupchat_history|messages|message)>/gi;

const RECORD_OR_ENVIRONMENT =
  /<(?:chat_history|privatechat_history|groupchat_history|group_message|messages|message)(?:\s[^>]*)?>[\s\S]*?<\/(?:chat_history|privatechat_history|groupchat_history|group_message|messages|message)>|<environment>[\s\S]*?<\/environment>/gi;

export function extractPrivateChatLogBlocks(text: string): string[] {
  return Array.from(text.matchAll(RECORD_OR_ENVIRONMENT), (match) => match[0].trim()).filter(Boolean);
}

/**
 * Pull exactly one generated turn out of a model response.
 *
 * The `<environment>` block the model writes belongs to the turn, but a model
 * may put a line of prose before it or emit it ahead of the record, so it is
 * recovered independently and re-attached. Losing it means the archived turn has
 * no time, date or weather and the widget refuses to render it at all.
 */
export function extractPrivateChatTurn(text: string): string {
  const clean = cleanAndExtractRawYaml(text);
  const environment = clean.match(/<environment>[\s\S]*?<\/environment>/i)?.[0];
  const withEnvironment = (record: string): string =>
    environment && !record.includes(environment) ? `${record}\n${environment}` : record;

  const match = clean.match(
    /<(?:chat_history|privatechat_history|groupchat_history|group_message)(?:\s+target="[^"]*")?(?:\s+type="[^"]*")?[^>]*>[\s\S]*?<\/(?:chat_history|privatechat_history|groupchat_history|group_message)>\s*(?:<environment>[\s\S]*?<\/environment>)?/i,
  );
  if (match) return withEnvironment(match[0].trim());

  // The group guide used to close its envelope with a bare `<groupchat_history>`,
  // so a model copying it verbatim produced a record that never ends.
  const unclosedGroup = clean.match(
    /<(groupchat_history|group_message)(?:\s[^>]*)?>[\s\S]*?(?=\s*<environment>[\s\S]*?<\/environment>\s*$|$)/i,
  );
  if (unclosedGroup) {
    return withEnvironment(`${unclosedGroup[0].replace(/<([a-z_]+)>\s*$/i, '</$1>').trim()}`);
  }

  const legacy = clean.match(/<message(?:\s[^>]*)?>[\s\S]*?<\/message>/i);
  if (legacy) return withEnvironment(legacy[0]);

  const bareRecord = clean.match(/^[\s\S]*?(?=^\s*<environment>|\s*$)/im);
  return withEnvironment((bareRecord?.[0] || clean).replace(/<\/?(?:messages)>/gi, '').trim());
}

/** Normalize a turn to the canonical wrapper for its record type. */
export function normalizePrivateChatTurnTags(
  rawYaml: string,
  target: string,
  recordType: 'private' | 'group' = 'private',
): string {
  const safeTarget = target.replace(/"/g, '&quot;');
  const opener =
    recordType === 'private'
      ? `<privatechat_history target="${safeTarget}" type="private">`
      : `<chat_history target="${safeTarget}" type="${recordType}">`;
  const closer = recordType === 'group' ? '</groupchat_history>' : '</privatechat_history>';
  return rawYaml
    .replace(/<(?:message|groupchat_history|group_message)(?:\s[^>]*)?>/gi, opener)
    .replace(/<\/(?:message|groupchat_history|group_message)>/gi, closer)
    .replace(/<(?:chat_history|privatechat_history)(?:\s+target="[^"]*")?(?:\s+type="[^"]*")?[^>]*>/gi, opener)
    .replace(/<\/(?:chat_history|privatechat_history|groupchat_history|group_message)>/gi, closer);
}

/** Keep every generated turn below the previous turn's environment block. */
export function appendPrivateChatTurn(existingYaml: string, newTurnYaml: string): string {
  const existing = existingYaml.trim();
  const next = newTurnYaml.trim();
  if (!existing) return next ? `${next}\n` : '';
  if (!next) return `${existing}\n`;
  return `${existing}\n\n${next}\n`;
}

/** Read the thread name a YAML archive declares about itself. */
export function readThreadTarget(rawYaml: string, fallback?: string): string | undefined {
  const clean = cleanAndExtractRawYaml(rawYaml);
  const fromTag = clean.match(/<(?:chat_history|privatechat_history|groupchat_history)[^>]*\btarget="([^"]*)"/i);
  if (fromTag?.[1]?.trim()) return fromTag[1].trim();
  return fallback;
}

/**
 * Rebuild the user's own messages as archive items.
 *
 * `userName` is written as a `sender` only for group records, where every
 * message is attributed. A private record has a single counterpart, so its items
 * carry just the `{{user}}` marker.
 */
export function formatPrivateChatUserMessages(
  userMessageLines: string[],
  time: string,
  options: { userName?: string; recordType?: 'private' | 'group' } = {},
): string {
  const senderBlock =
    options.recordType === 'group' && options.userName?.trim()
      ? `\n    sender:\n      name: ${options.userName.trim()}`
      : '';
  const items: string[] = [];
  let pendingQuote: { name: string; content: string } | null = null;

  for (const line of userMessageLines) {
    const quoteLine = line.match(/^\[Quote(?:\s([^\]]*))?\]\s*(.*)$/);
    if (quoteLine) {
      pendingQuote = { name: quoteLine[1]?.trim() || 'Character', content: quoteLine[2]?.trim() || '' };
      continue;
    }

    // A sent transfer is a `t: transfer` item in the archive, not text that
    // happens to mention one.
    const transferLine = line.match(/^\[Transfer(-Accepted|-Rejected)?:\s*([^\]\s]+)\s*(?:·\s*(.*))?\]$/);
    if (transferLine) {
      const outcome =
        transferLine[1] === '-Accepted' ? 'accepted' : transferLine[1] === '-Rejected' ? 'rejected' : null;
      // The marker carries the currency symbol, which makes it a string.
      const amount = transferLine[2]?.trim() || '0';
      const note = transferLine[3]?.trim();
      items.push(
        [
          `  - t: transfer${outcome ? `-${outcome}` : ''}`,
          `    {{user}}: true${senderBlock}`,
          `    amt: ${/^[0-9.+-]+$/.test(amount) ? amount : JSON.stringify(amount)}`,
          ...(note && !outcome ? [`    note: "${note.replace(/"/g, '\\"')}"`] : []),
          `    time: ${time}`,
        ].join('\n'),
      );
      pendingQuote = null;
      continue;
    }

    if (pendingQuote) {
      items.push(
        [
          '  - t: quote',
          `    {{user}}: true${senderBlock}`,
          '    quote:',
          `      name: ${pendingQuote.name}`,
          '      t: text',
          `      c: ${pendingQuote.content}`,
          `    c: ${line}`,
          `    time: ${time}`,
        ].join('\n'),
      );
      pendingQuote = null;
      continue;
    }

    items.push(`  - t: text\n    {{user}}: true${senderBlock}\n    c: ${line}\n    time: ${time}`);
  }

  return items.join('\n');
}

/**
 * The user-side lines that must be archived alongside a generated turn.
 *
 * A continuation request carries an instruction rather than something the user
 * said, so it resolves to nothing and no phantom user message is archived.
 */
export function resolvePrivateChatUserMessageLines(params: {
  userPrompt?: string;
  continuationOnly?: boolean;
}): string[] {
  if (params.continuationOnly) return [];

  const clean = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\[Text\]\s*/i, '').trim())
      .filter((line) => line.length > 0 && line !== '[Start Interaction]');

  if (typeof params.userPrompt === 'string' && params.userPrompt.trim()) {
    return clean(params.userPrompt);
  }
  return [];
}

/**
 * Parse a model response into structured phone data or a chat record.
 *
 * The tag-shaped records are tried first: raw YAML cannot parse a line that
 * starts with `<chat_history>`, so a record-wrapped response has to go through
 * the block parser even when the caller expected plain data.
 */
export function extractAndParsePhoneDataYaml(rawText: string, isThreadRecord = false): any {
  if (!rawText || !rawText.trim()) return null;

  const candidate = cleanAndExtractRawYaml(rawText);
  if (!candidate) return null;

  const hasXmlTags =
    /<(?:chat_history|privatechat_history|groupchat_history|messages|message|phone_data|environment)[\s>]/i.test(candidate);

  if (isThreadRecord || hasXmlTags) {
    try {
      const blocks = Array.from(candidate.matchAll(RECORD_OPEN), (match) => match[1] ?? '');
      if (blocks.length > 0) {
        const allMessages: any[] = [];
        let target = '';
        let latestDate = '';
        let latestTime = '';
        for (const body of blocks) {
          try {
            const parsed = yaml.parse(sanitizeYamlTemplateKeys(body.trim()));
            if (parsed && typeof parsed === 'object') {
              if (!target) target = parsed.contactname || parsed.name || parsed['Contact name'] || '';
              if (parsed.date) latestDate = String(parsed.date);
              if (parsed.time) latestTime = String(parsed.time);
              if (Array.isArray(parsed.messages)) allMessages.push(...parsed.messages);
            }
          } catch {
            // skip unparseable block
          }
        }
        if (allMessages.length > 0 || target) {
          return { target, date: latestDate, time: latestTime, messages: allMessages };
        }
      }
    } catch {
      // fall through to the plain-YAML attempt
    }
  }

  const candidateWithQuotes = sanitizeYamlTemplateKeys(candidate);
  try {
    const parsed = yaml.parse(candidateWithQuotes);
    if (parsed && typeof parsed === 'object') {
      if (parsed.phone_data && typeof parsed.phone_data === 'object') return parsed.phone_data;
      return parsed;
    }
  } catch {
    // attempt fallback sanitization
  }

  try {
    const sanitized = candidateWithQuotes
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('<') || !trimmed.endsWith('>');
      })
      .map((line) => line.replace(/\t/g, '  '))
      .join('\n');
    const parsed = yaml.parse(sanitized);
    if (parsed && typeof parsed === 'object') {
      if (parsed.phone_data && typeof parsed.phone_data === 'object') return parsed.phone_data;
      return parsed;
    }
  } catch (error: any) {
    if (isThreadRecord) return null;
    throw new Error(`Invalid YAML: ${error?.message || 'parse error'}`);
  }

  return null;
}

/**
 * Rewrite one message inside a thread archive.
 *
 * A thread holds one record per turn and message ids restart per record, so the
 * same `msg_003` can appear several times; `occurrence` selects which one.
 * Deleting the last character reply drops the whole connected turn, including
 * its user items and environment, because they all belong to that turn.
 */
export function updateThreadMessageYaml(
  rawYaml: string,
  messageId: string,
  content: string | undefined,
  options: { target?: string; occurrence?: number } = {},
): string {
  let found = false;
  let occurrence = 0;
  const wanted = (options.target || '').trim().toLowerCase();
  const blockPattern =
    /(<(chat_history|privatechat_history|groupchat_history|messages|message)([^>]*)>)([\s\S]*?)(<\/(?:\2|privatechat_history|groupchat_history)>)(\s*<environment>[\s\S]*?<\/environment>)?/gi;

  const updated = rawYaml.replace(
    blockPattern,
    (full, opening, _tagName, attrs, body, closing, environment) => {
      if (found) return full;
      if (wanted) {
        const targetAttr = String(attrs || '').match(/\btarget="([^"]*)"/i);
        const blockTarget = targetAttr?.[1]?.trim().toLowerCase() || '';
        if (blockTarget && blockTarget !== wanted) return full;
        if (!blockTarget) {
          const nameMatch = String(body).match(/^\s*(?:contact)?name:\s*(.+)$/m);
          const blockName = nameMatch?.[1]?.trim().toLowerCase() || '';
          if (blockName && blockName !== wanted) return full;
        }
      }

      const parsed = yaml.parse(sanitizeYamlTemplateKeys(String(body).trim()));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.messages)) return full;

      let index = -1;
      for (let itemIndex = 0; itemIndex < parsed.messages.length; itemIndex++) {
        const item = parsed.messages[itemIndex];
        if (!item || typeof item !== 'object' || String((item as Record<string, unknown>).id || '') !== messageId) {
          continue;
        }
        if (occurrence++ === (options.occurrence ?? 0)) {
          index = itemIndex;
          break;
        }
      }
      if (index < 0) return full;

      if (content === undefined) {
        parsed.messages.splice(index, 1);
      } else {
        const item = parsed.messages[index] as Record<string, unknown>;
        item.c = content;
      }
      found = true;

      const stillHasCharacterMessages = parsed.messages.some((item: unknown) => !isUserMessageItem(item));
      if (content === undefined && !stillHasCharacterMessages) return '';

      const nextBody = normalizeUserFlagKey(yaml.stringify(parsed).trim());
      if (!nextBody) return '';
      return `${opening}\n${nextBody}\n${closing}${environment || ''}`;
    },
  );

  if (!found) throw new Error(`Message ${messageId} was not found`);
  return updated.replace(/\n{3,}/g, '\n\n').trim();
}

/** True when an archive item belongs to the user rather than the character. */
export function isUserMessageItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  const flag = record['{{user}}'];
  if (flag === true || flag === 'true' || flag === 1) return true;
  return record.me === 1 || record.me === true || record.user === true || record.isUser === true;
}

/**
 * The user message time, derived from the character message that follows it.
 *
 * The user always spoke first, so their timestamp is one minute earlier than the
 * first character message in the turn.
 */
export function deriveUserMessageTime(turnYaml: string): string {
  const match =
    turnYaml.match(
      /-\s*t:\s*(?:text|sticker|image|imgdesc|file|voice|link|quote|transfer(?:-accepted|-rejected)?)[\s\S]*?time:\s*["']?([^"'\n\r]+)["']?/i,
    ) || turnYaml.match(/time:\s*["']?([^"'\n\r]+)["']?/i);

  const raw = match?.[1]?.trim();
  if (raw) {
    const parts = raw.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (parts) {
      let hours = Number(parts[1]);
      let minutes = Number(parts[2]);
      const ampm = parts[3]?.toUpperCase();
      if (ampm) {
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        if (minutes === 0) {
          minutes = 59;
          hours = (hours - 1 + 24) % 24;
        }
        return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
      }
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Full post-processing of one generated turn, in the engine's order. */
export function finalizeTurn(params: {
  rawOutput: string;
  target: string;
  recordType: 'private' | 'group';
  userLines?: string[];
  userName?: string;
}): string {
  const { rawOutput, target, recordType } = params;
  let turn = extractPrivateChatTurn(cleanAndExtractRawYaml(rawOutput)).trim();

  // The caller passes what the user typed, which may be several lines. The
  // engine split this before archiving (each line becomes its own archive item,
  // and a `[Quote …]` marker is only recognised at the start of a line), so the
  // split happens here rather than trusting every caller to have done it.
  const userLines = (params.userLines ?? [])
    .flatMap((line) => line.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
  if (userLines.length > 0 && !turn.includes('{{user}}: true')) {
    const items = formatPrivateChatUserMessages(userLines, deriveUserMessageTime(turn), {
      userName: params.userName,
      recordType,
    });
    if (turn.includes('messages:')) {
      turn = turn.replace(/(messages:\s*\n)/i, `$1${items}\n`);
    } else if (/<messages>/i.test(turn)) {
      turn = turn.replace(/(<messages>\s*\n?)/i, `$1${items}\n`);
    }
  }

  turn = normalizePrivateChatTurnTags(turn, target, recordType);
  turn = normalizeUserFlagKey(turn);
  turn = normalizeMochiRecordScalarQuoting(turn);
  return turn;
}