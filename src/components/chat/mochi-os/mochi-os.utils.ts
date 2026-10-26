import yaml from "yaml";
import type { MochiContactsMap, MochiCurrency, MochiMessage } from "./mochi-os.types";
import type { MochiFormatGuideData } from "./mochi-os.constants";

export function two(n: number): string {
  return String(n).padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase();
}

export function fmtHm(h: number, mi: number, hour12: boolean): string {
  if (hour12) {
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h % 12 || 12;
    return `${h12}:${two(mi)} ${ampm}`;
  }
  return `${two(h)}:${two(mi)}`;
}

export function fmtTime(d: Date, hour12: boolean): string {
  return fmtHm(d.getHours(), d.getMinutes(), hour12);
}

export function fmtMsgTime(t: string | undefined, hour12: boolean): string {
  if (!t) return "";
  if (!hour12) return t;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = +m[1];
  const ampm = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

export function formatRelativeTime(dateStr: string | undefined, timeStr: string | undefined, hour12: boolean): string {
  if (!dateStr) return "";
  const msgDate = new Date(dateStr);
  // A thread's date is model-authored text, and the guides legitimately produce
  // values like `Today` or `Day 1` that `Date` cannot parse. Formatting an
  // Invalid Date throws inside `Intl`, which takes the whole list down with it,
  // so an unparseable date falls back to showing the time alone.
  if (Number.isNaN(msgDate.getTime())) return fmtMsgTime(timeStr, hour12);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());

  const diffTime = today.getTime() - msgDay.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return fmtMsgTime(timeStr, hour12);
  } else if (diffDays > 0 && diffDays < 7) {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(msgDate);
  } else {
    return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).format(msgDate);
  }
}

export function wxLabel(c: number): string {
  if (c === 0) return "Sunny";
  if (c <= 2) return "Partly Cloudy";
  if (c === 3) return "Cloudy";
  if (c <= 48) return "Foggy";
  if (c <= 57) return "Drizzle";
  if (c <= 67) return "Rainy";
  if (c <= 77) return "Snowy";
  if (c <= 82) return "Showers";
  if (c <= 86) return "Snow Showers";
  return "Thunderstorm";
}

export function fmtDur(s: number): string {
  return `${Math.floor(s / 60)}:${two(Math.floor(s % 60))}`;
}

/**
 * The kind of `<chat_history>` record a document holds. A private record carries
 * one conversation between the user and one character; a group record carries a
 * multi-party thread where every message names its own `sender`.
 */
export type MochiChatRecordType = "private" | "group";

/**
 * Whether a bare record tag is one of the guides' own group envelopes.
 *
 * The group guide names its output `<groupchat_history>`, while the two drawing
 * variants of that same guide call it `<group_message>`. All three mean the same
 * record, and none carries a `type` attribute, so the tag is what identifies them
 * as group records.
 */
export function isMochiGroupRecordTag(tag?: string): boolean {
  const name = (tag || "").trim().toLowerCase();
  return name === "groupchat_history" || name === "group_message";
}

/**
 * Remove one thread's own records from a roleplay message, leaving the rest.
 *
 * A generation prompt carries the thread on screen twice: once as the archived
 * records inside the roleplay stream, and once as the attributed replay of the
 * in-memory bubbles. For a group that replay is the readable form, so keeping
 * the raw copy too sends every message twice. Worse, a regeneration only
 * excludes the roleplay rows it deleted, so any turn still present there is
 * replayed into the prompt — the model then sees the messages it was asked to
 * replace and tends to repeat them.
 *
 * Only this thread's records of this thread's kind are cut. Another thread's
 * records in the same message, and the surrounding prose, must survive: a
 * roleplay turn can hold one character's private record alongside the group's.
 */
export function stripMochiThreadRecordsFromContent(params: {
  content: string;
  targetName: string;
  recordType: MochiChatRecordType;
}): string {
  const wanted = params.targetName.trim().toLowerCase();
  if (!params.content || !wanted) return params.content || "";
  // Match an opener addressed to this thread, then its own closing tag, so a
  // neighbouring record of a different thread is never consumed.
  const recordPattern = new RegExp(
    `<(chat_history|privatechat_history|groupchat_history|group_message)(?=[^>]*\\btarget="([^"]*)")[^>]*>[\\s\\S]*?<\\/(?:chat_history|privatechat_history|groupchat_history|group_message)>` +
      `(?:\\s*<environment>[\\s\\S]*?<\\/environment>)?`,
    "gi",
  );
  return (
    params.content
      .replace(recordPattern, (full, tagName: string, target: string) => {
        const declaredType = full
          .match(/\btype="([^"]*)"/i)?.[1]
          ?.trim()
          .toLowerCase();
        const recordType: MochiChatRecordType =
          declaredType === "group" || (declaredType !== "private" && isMochiGroupRecordTag(tagName))
            ? "group"
            : "private";
        return recordType === params.recordType && target.trim().toLowerCase() === wanted ? "" : full;
      })
      // The cut leaves the blank lines that surrounded the record behind.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Read a record message's sender.
 *
 * Group-chat items name their author in `sender: { name: … }` per the group
 * format guide. A private-chat item has no sender because the reader is always
 * the single character, so an empty result is normal there.
 */
export function readMochiSender(item?: Record<string, any> | null): string {
  const sender = item?.sender ?? item?.from ?? item?.speaker;
  if (typeof sender === "string") return sender.trim();
  if (sender && typeof sender === "object") {
    return String(sender.name ?? sender.sender_name ?? sender.nickname ?? "").trim();
  }
  return "";
}

export interface ParsedMochiChatReply {
  id?: string;
  type: string;
  text?: string;
  dur?: string;
  time?: string;
  /** Author name from a group-chat record's `sender` block; empty in a private record. */
  sender?: string;
  rawItem?: Record<string, any>;
}

export function parseMochiChatResponse(rawText: string, defaultSenderName?: string, options?: { structuredOnly?: boolean }): ParsedMochiChatReply[] {
  if (!rawText || !rawText.trim()) return [];

  let text = stripMochiReasoning(rawText);
  if (!text) return [];

  // 2. Extract content strictly within the supported Mochi wrappers. A new
  // private-chat output closes a targeted record with </privatechat_history>, and
  // a group-chat output is wrapped in <groupchat_history target="…">.
  const tagMatch =
    text.match(/<messages>([\s\S]*?)<\/messages>/i) ||
    text.match(/<message>([\s\S]*?)<\/message>/i) ||
    text.match(/<(?:groupchat_history|group_message)(?:\s[^>]*)?>([\s\S]*?)<\/(?:groupchat_history|group_message)>/i) ||
    text.match(
      /<(?:chat_history|privatechat_history)[^>]*>([\s\S]*?)<\/(?:chat_history|privatechat_history|groupchat_history)>/i,
    ) ||
    text.match(/<private_chat>([\s\S]*?)<\/private_chat>/i) ||
    text.match(/<chat>([\s\S]*?)<\/chat>/i);
  if (tagMatch && tagMatch[1]) {
    text = tagMatch[1].trim();
  } else {
    const fenceMatch = text.match(/```(?:yaml)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      text = fenceMatch[1].trim();
      const innerMatch =
        text.match(/<messages>([\s\S]*?)<\/messages>/i) ||
        text.match(/<message>([\s\S]*?)<\/message>/i) ||
        text.match(
          /<(?:groupchat_history|group_message)(?:\s[^>]*)?>([\s\S]*?)<\/(?:groupchat_history|group_message)>/i,
        ) ||
        text.match(
          /<(?:chat_history|privatechat_history)[^>]*>([\s\S]*?)<\/(?:chat_history|privatechat_history|groupchat_history)>/i,
        );
      if (innerMatch && innerMatch[1]) {
        text = innerMatch[1].trim();
      }
    }
  }

  // 3. Try parsing with YAML parser first
  try {
    // The canonical transcript deliberately writes this marker unquoted, while
    // YAML requires it to be a string key. Normalize before parsing replies too.
    const parsedObj = yaml.parse(text.replace(/^(\s*)\{\{user\}\}:/gm, '$1"{{user}}":'));
    if (parsedObj && typeof parsedObj === "object") {
      const messagesList = Array.isArray(parsedObj.messages)
        ? parsedObj.messages
        : Array.isArray(parsedObj)
          ? parsedObj
          : null;
      if (messagesList && Array.isArray(messagesList)) {
        const results: ParsedMochiChatReply[] = [];
        for (const item of messagesList) {
          if (!item || typeof item !== "object") continue;
          const msgId = item.id ? String(item.id).trim() : undefined;
          const rawType = (item.t || item.type || "text").toString().toLowerCase();
          const cleanContent = (item.c ?? item.content ?? item.text ?? "").toString().trim();
          const timeVal = (item.time ?? item.t_time)?.toString().trim();
          const durVal = (item.dur ?? item.duration)?.toString().trim();
          const senderVal = readMochiSender(item);

          let bubbleType = rawType;
          let displayText = cleanContent;

          if (rawType === "sticker") {
            bubbleType = "sticker";
            displayText = cleanContent.replace(/^\[Sticker\]\s*/i, "") || "sticker";
          } else if (rawType === "voice") {
            bubbleType = "voice";
            displayText = cleanContent || "voice note";
          } else if (rawType === "image" || rawType === "imgdesc") {
            bubbleType = rawType;
            displayText = cleanContent ? `[Photo: ${cleanContent}]` : "[Photo]";
          } else if (isMochiTransferType(rawType)) {
            // A transfer is a card, not prose: its amount/note live in the raw
            // item, and `text` stays empty so copy/edit never offer a fake body.
            bubbleType = rawType;
            displayText = "";
          } else if (!displayText && item.quote) {
            displayText = typeof item.quote === "string" ? item.quote : item.quote.c || "[Quote]";
          }

          results.push({
            id: msgId,
            type: bubbleType,
            text: displayText,
            dur: durVal || (rawType === "voice" ? "0:05" : undefined),
            time: timeVal,
            sender: senderVal || undefined,
            rawItem: item,
          });
        }
        if (results.length > 0) {
          return results;
        }
      }
    }
  } catch {
    // Fall back to regex parsing
  }

  // 4. Try regex parsing line-by-line / block-by-block
  const results: ParsedMochiChatReply[] = [];

  // Look for items starting with "- id:" or "- t:" or similar YAML list entries
  const itemBlocks = text.split(/\n(?=-\s*(?:id|t):)/);
  for (const block of itemBlocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    const idMatch = trimmedBlock.match(/-\s*id:\s*([^\n\r]+)/i) || trimmedBlock.match(/id:\s*([^\n\r]+)/i);
    const typeMatch = trimmedBlock.match(/-\s*t:\s*([^\n\r]+)/i) || trimmedBlock.match(/t:\s*([^\n\r]+)/i);
    const contentMatch = trimmedBlock.match(/c:\s*(?:"([^"]*)"|'([^']*)'|([^\n\r]+))/i);
    const timeMatch = trimmedBlock.match(/time:\s*["']?([^"'\n\r]+)["']?/i);
    const durMatch = trimmedBlock.match(/duration:\s*["']?([^"'\n\r]+)["']?/i);
    const amtMatch = trimmedBlock.match(/amt:\s*["']?([^"'\n\r]+)["']?/i);
    const noteMatch = trimmedBlock.match(/note:\s*(?:"([^"]*)"|'([^']*)'|([^\n\r]+))/i);

    const msgId = idMatch ? idMatch[1].trim() : undefined;
    const rawType = typeMatch ? typeMatch[1].trim().toLowerCase() : "text";
    const rawContent = contentMatch ? contentMatch[1] || contentMatch[2] || contentMatch[3] || "" : "";
    const cleanContent = rawContent.trim();
    const timeVal = timeMatch ? timeMatch[1].trim() : undefined;
    const durVal = durMatch ? durMatch[1].trim() : undefined;
    const senderVal = /^\s*sender\s*:\s*(?:\{[^}]*\})?["']?([^\n\r"']+)/i.exec(trimmedBlock)?.[1]?.trim() ?? "";

    if (rawType === "sticker") {
      results.push({
        id: msgId,
        type: "sticker",
        text: cleanContent.replace(/^\[Sticker\]\s*/i, "") || "sticker",
        time: timeVal,
        sender: senderVal || undefined,
      });
    } else if (rawType === "voice") {
      results.push({
        id: msgId,
        type: "voice",
        text: cleanContent || "voice note",
        time: timeVal,
        dur: durVal || "0:05",
        sender: senderVal || undefined,
      });
    } else if (rawType === "image" || rawType === "imgdesc") {
      results.push({
        id: msgId,
        type: rawType,
        text: cleanContent ? `[Photo: ${cleanContent}]` : "[Photo]",
        time: timeVal,
        sender: senderVal || undefined,
      });
    } else if (rawType === "transfer") {
      results.push({
        id: msgId,
        type: "transfer",
        text: "",
        time: timeVal,
        sender: senderVal || undefined,
        rawItem: {
          ...(amtMatch ? { amt: amtMatch[1].trim() } : {}),
          ...(noteMatch ? { note: (noteMatch[1] ?? noteMatch[2] ?? noteMatch[3] ?? "").trim() } : {}),
          ...(timeVal ? { time: timeVal } : {}),
        },
      });
    } else if (rawType === "text" || cleanContent) {
      if (cleanContent) {
        results.push({
          id: msgId,
          type: "text",
          text: cleanContent,
          time: timeVal,
          sender: senderVal || undefined,
        });
      }
    }
  }

  // Fallback: If no structured list was matched, treat the cleaned text as a direct message reply
  if (results.length === 0 && !options?.structuredOnly) {
    // Strip XML opening/closing tags or YAML keys if leftover
    let fallbackText = text
      .replace(
        /<\/?(?:messages|message|chat_history|privatechat_history|groupchat_history|group_message|private_chat|chat|environment)[^>]*>/gi,
        "",
      )
      .replace(/^-\s*t:\s*text\s*\n\s*c:\s*/i, "")
      .trim();

    // If prefix like "Apex: " or "Name: " is present at start, strip character label
    if (defaultSenderName && fallbackText.toLowerCase().startsWith(`${defaultSenderName.toLowerCase()}:`)) {
      fallbackText = fallbackText.slice(defaultSenderName.length + 1).trim();
    } else if (/^Apex:\s*/i.test(fallbackText)) {
      fallbackText = fallbackText.replace(/^Apex:\s*/i, "").trim();
    }

    if (fallbackText) {
      results.push({
        type: "text",
        text: fallbackText,
      });
    }
  }

  return results;
}

/**
 * The currency symbols offered in Mochi OS settings, in display order.
 * Mirrors `MochiCurrencySchema` in the shared package.
 */
export const MOCHI_CURRENCY_CHOICES: MochiCurrency[] = ["$", "¥", "€", "£", "₩", "₹", "₽", "R$", "₫", "A$", "C$", "kr"];

/** The three money-transfer bubble types in the Mochi OS private-chat format. */
export const MOCHI_TRANSFER_TYPE = "transfer";
export const MOCHI_TRANSFER_ACCEPTED_TYPE = "transfer-accepted";
export const MOCHI_TRANSFER_REJECTED_TYPE = "transfer-rejected";

/** Every type that is a money-transfer card, in either direction or outcome. */
export function isMochiTransferType(type?: string | null): boolean {
  return type === MOCHI_TRANSFER_TYPE || type === MOCHI_TRANSFER_ACCEPTED_TYPE || type === MOCHI_TRANSFER_REJECTED_TYPE;
}

/** The resolved outcome of a transfer card, or `null` while it is still pending. */
export type MochiTransferOutcome = "accepted" | "rejected";

export function mochiTransferOutcome(type?: string | null): MochiTransferOutcome | null {
  if (type === MOCHI_TRANSFER_ACCEPTED_TYPE) return "accepted";
  if (type === MOCHI_TRANSFER_REJECTED_TYPE) return "rejected";
  return null;
}

/**
 * Format a transfer item's `amt` as the bare number the archive stores
 * (`520.00`). Non-numeric models of an amount are passed through untouched
 * rather than coerced to `NaN`, so a malformed transfer still shows its
 * authored text instead of an empty card.
 */
export function formatMochiTransferAmount(rawItem?: Record<string, any> | null): string {
  const raw = rawItem?.amt ?? rawItem?.amount;
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw === "number") return Number.isFinite(raw) ? raw.toFixed(2) : String(raw);
  // Strip currency symbols and separators ("$1,250.50") but keep the authored
  // text when nothing numeric survives, so "all of it" is not shown as 0.00.
  const digits = String(raw).replace(/[^0-9.-]/g, "");
  if (!digits) return String(raw).trim();
  const amount = Number(digits);
  return Number.isFinite(amount) ? amount.toFixed(2) : String(raw).trim();
}

/**
 * The display form of a transfer amount, prefixed with the chosen currency.
 *
 * The archive keeps `amt` a bare number and the symbol is a display preference,
 * so a model that already wrote `$520.00` still renders once, not `$$520.00`.
 */
export function formatMochiTransferDisplay(rawItem?: Record<string, any> | null, currency = "$"): string {
  const raw = rawItem?.amt ?? rawItem?.amount;
  const amount = formatMochiTransferAmount(rawItem);
  if (!amount) return "";
  const authored = raw === undefined || raw === null ? "" : String(raw);
  // A non-numeric amount is authored prose, not a number to re-currency.
  if (!/[0-9]/.test(authored)) return amount;
  // A model that wrote its own symbol ("¥520.00") keeps it; one that wrote a
  // bare number gets the display preference. Separators and the sign are not
  // symbols, so "-50.00" and "1,250.50" still take the preference.
  const authoredSymbol = authored.match(/^[^0-9\s.,+-]+/)?.[0] ?? "";
  return `${authoredSymbol || currency}${amount}`;
}

/**
 * The optional free-text note attached to a `t: transfer` item. Only `note` is
 * read: a transfer card has no prose body, so a stray `c:` on such an item is a
 * model mistake, not the note.
 */
export function mochiTransferNote(rawItem?: Record<string, any> | null): string {
  const note = rawItem?.note ?? rawItem?.memo;
  return note === undefined || note === null ? "" : String(note).trim();
}

/**
 * The marker a transfer sends to the model, e.g. `[Transfer: $520.00 · rent]`.
 * The amount carries the chosen currency symbol so the model sees the same
 * figure the user composed, matching the guide's `¥520.00` / `$520.00`
 * examples. The server rebuilds each marker into the matching `t:` archive item,
 * so the three marker shapes and the three archive types must stay in step.
 */
export function formatMochiTransferMarkerForAi(
  type: string,
  rawItem?: Record<string, any> | null,
  currency = "$",
): string {
  const display = formatMochiTransferDisplay(rawItem, currency);
  const outcome = mochiTransferOutcome(type);
  if (outcome) return `[Transfer-${outcome === "accepted" ? "Accepted" : "Rejected"}: ${display || "?"}]`;
  const note = mochiTransferNote(rawItem);
  return `[Transfer: ${display || "?"}${note ? ` · ${note}` : ""}]`;
}

/**
 * Contact-list preview text for the last bubble in a Mochi OS thread.
 *
 * A group thread is read by several people, so its previews are attributed:
 * "Alex: no" says who is being replied to, which an unattributed "no" cannot.
 */
export function mochiMessagePreview(m?: {
  me?: 0 | 1;
  type?: string;
  text?: string;
  sender?: string;
  rawItem?: Record<string, any>;
}): string {
  if (!m) return "";
  const prefix = m.me === 1 ? "" : m.sender?.trim() ? `${m.sender.trim()}: ` : "";
  if (m.type === "sticker") return `${prefix}sent a sticker`;
  if (m.type === "voice") return `${prefix}🎤 voice message`;
  if (isMochiTransferType(m.type)) {
    const amount = formatMochiTransferAmount(m.rawItem);
    const outcome = mochiTransferOutcome(m.type);
    if (outcome) return amount ? `[Transfer ${outcome}: ${amount}]` : `[Transfer ${outcome}]`;
    return amount ? `[Transfer: ${amount}]` : "[Transfer]";
  }
  if (!m.text) return prefix.trim();
  return `${prefix}${m.text}`;
}

/**
 * Which incoming transfer, if any, is still awaiting the user's answer.
 *
 * Accepting or rejecting appends its own `t: transfer-accepted` /
 * `t: transfer-rejected` message rather than mutating the original card, so
 * resolution is read back from the thread: the newest incoming transfer with no
 * outcome message after it is the one still actionable. Deriving it this way
 * means the buttons come back correctly after a reload, with no state that only
 * exists in the browser.
 *
 * ponytail: matching by position rather than by transfer id, because the
 * format guide's response items carry only `amt` and `time`. If two identical
 * pending transfers ever appear, only the newest is offered. Upgrade path: add
 * an `id` to the response item and match on it.
 */
export function findPendingMochiTransfer(messages: Array<{ me?: number; type?: string }>): number | null {
  let pending: number | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (mochiTransferOutcome(message.type)) {
      pending = null;
      continue;
    }
    if (message.me === 0 && message.type === MOCHI_TRANSFER_TYPE) pending = index;
  }
  return pending;
}

/**
 * The instruction sent when the user asks for another reply without typing
 * anything (the composer's refresh button).
 *
 * This is a request for the other party to keep talking, not something the user
 * said, so it must never be archived as a user message. Requests that carry one
 * set `continuationOnly`, and the server then injects no `{{user}}: true` item.
 */
export function buildMochiContinuationPrompt(contactName: string): string {
  return [
    `Private chat with ${contactName || "the other party"}.`,
    "Our side has not replied; let the other party continue sending messages.",
    "Please generate reply content according to the format requirements.",
  ].join("\n");
}

/**
 * The group-chat counterpart of {@link buildMochiContinuationPrompt}.
 *
 * The guide forbids speaking for the user and lets members message each other,
 * so the request names the roster instead of a single counterpart: the model is
 * told who may speak and left to choose. Without the roster it falls back to the
 * group name and would treat the group as a two-party thread.
 */
export function buildMochiGroupContinuationPrompt(groupName: string, memberNames: string[] = []): string {
  const roster = memberNames.map((name) => name.trim()).filter(Boolean);
  return [
    `Group chat "${groupName || "Group"}".`,
    roster.length > 0 ? `Group members: ${roster.join(", ")}.` : "",
    "Our side has not replied; let the group members continue sending messages.",
    "Please generate reply content according to the format requirements.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Strip a stored Mochi OS file down to the document its editor shows.
 *
 * A saved data-generation file carries a `# Mochi OS Data for Roleplay Chat` /
 * `# Saved at` header and wraps the document in `<phone_data>` tags, because the
 * log and file viewers need both. The YAML editor must not: it edits the
 * document, so showing the header invites saving it back as data, and showing the
 * tags puts XML into a YAML parse that the validation rejects as a stray tag.
 *
 * Returns "" when the file holds only a header and an empty document, so an
 * editor opened against an emptied file starts empty instead of prefilled with
 * `<phone_data></phone_data>`. That matters because an empty editor is the
 * user's signal to delete the file.
 */
export function extractPhoneDataEditorYaml(rawText: string): string {
  const cleaned = cleanAndExtractRawYaml(rawText || "").trim();
  if (!cleaned) return "";
  const tagged = cleaned.match(/<phone_data>([\s\S]*?)<\/phone_data>/i);
  const body = (tagged ? tagged[1] : cleaned)
    // Drop the file header, which is comment lines the editor has no use for.
    .replace(/^\s*#[^\n]*$/gm, "")
    .trim();
  return body;
}

/** Remove model reasoning, including nested/mixed-case tags and prefill closers.
 * An unfinished reasoning block is discarded, never saved as a chat reply. */
export function stripMochiReasoning(rawText: string): string {
  const text = rawText || "";
  const tags = /<\s*(\/?)\s*(think|thinking|think_format|analysis|reasoning|scratchpad)\b[^>]*>/gi;
  let depth = 0;
  let cursor = 0;
  let result = "";
  for (const match of text.matchAll(tags)) {
    const index = match.index!;
    if (!match[1]) {
      if (depth === 0) result += text.slice(cursor, index);
      if (!/\/\s*>$/.test(match[0])) depth++;
    } else if (depth > 0) {
      depth--;
    } else {
      const prefix = text.slice(cursor, index);
      // An orphaned close commonly finishes the preset's assistant <think>
      // prefill. A format example inside that reasoning is not a real reply.
      const start = prefix.trimStart().replace(/^```[a-zA-Z0-9_-]*\s*/i, "");
      if (result || /^(?:<(?:phone_data|chat_history|privatechat_history|groupchat_history|group_message|messages|message|private_chat|chat|environment)\b|(?:phone_data|messages|user|characters|groups):)/i.test(start)) result += prefix;
    }
    cursor = index + match[0].length;
  }
  if (depth === 0) result += text.slice(cursor);
  return result.trim();
}

export function cleanAndExtractRawYaml(rawText: string): string {
  if (!rawText || !rawText.trim()) return "";
  let cleanText = stripMochiReasoning(rawText);

  // 2. Strip outer markdown fences like ```yaml ... ```
  cleanText = cleanText
    .replace(/^```[a-zA-Z0-9_-]*\s*\n/i, "")
    .replace(/\n```\s*$/i, "")
    .trim();

  return cleanText;
}

export function formatUserMsgForAi(m: {
  type?: string;
  text?: string;
  dur?: string;
  rawItem?: Record<string, any>;
}): string {
  if (m.type === "quote") {
    // Keep the quoted line in the prompt. The server rebuilds user messages from
    // this text, so dropping it would archive the reply as plain text and lose the
    // quote block the format guide requires.
    const quote = m.rawItem?.quote;
    const quotedText = typeof quote === "string" ? quote : quote?.c;
    const quotedName = typeof quote === "string" ? "" : quote?.name;
    const prefix = quotedText ? `[Quote${quotedName ? ` ${quotedName}` : ""}] ${quotedText}\n` : "";
    return `${prefix}[Text] ${m.text || ""}`;
  }
  if (m.type === "sticker") return `[Sticker] ${m.text || "sticker"}`;
  if (m.type === "voice") return `[Voice] ${m.dur || "voice note"}`;
  if (isMochiTransferType(m.type)) return formatMochiTransferMarkerForAi(m.type ?? "transfer", m.rawItem);
  if (m.text?.startsWith("[") && m.text.includes("]")) return m.text; // e.g. [Photo: ...]
  return `[Text] ${m.text || ""}`;
}

/** The canonical field wins even when explicitly cleared; old documents stay readable. */
export function mochiSocialHandle(info?: {
  socialhandle?: string;
  screenName?: string;
  screen_name?: string;
  nickname?: string;
}): string {
  if (typeof info?.socialhandle === "string") return info.socialhandle.trim();
  return (info?.screenName || info?.screen_name || info?.nickname || "").trim();
}

/** Upgrade only the removed private output field; other guides/data stay intact. */
export function normalizeMochiPrivateChatGuide(template: string): string {
  return template.replace(/^contactname:[^\r\n]*(?:\r?\n|$)/gm, "");
}

export function normalizeMochiFormatGuides(guides: MochiFormatGuideData): MochiFormatGuideData {
  const privateChat = guides.formatGuide?.privateChat;
  return typeof privateChat === "string"
    ? { ...guides, formatGuide: { ...guides.formatGuide, privateChat: normalizeMochiPrivateChatGuide(privateChat) } }
    : guides;
}

export function formatFriendInfo(info?: {
  name?: string;
  contactname?: string;
  socialhandle?: string;
  screenName?: string;
  screen_name?: string;
  nickname?: string;
  email?: string;
  onlineStyle?: string;
  onlinestyle?: string;
  online_style?: string;
}): string {
  const name = info?.name?.trim() || "Not set";
  const contactNameLine = info?.contactname?.trim() ? `\nContact Name: ${info.contactname.trim()}` : "";
  const socialHandle = mochiSocialHandle(info) || "Not set";
  const email = info?.email?.trim() || "Not set";
  const chatStyle = info?.onlineStyle?.trim() || info?.onlinestyle?.trim() || info?.online_style?.trim() || "Not set";

  return `Friend Information:\nName: ${name}${contactNameLine}\nSocial Handle: ${socialHandle}\nEmail: ${email}\nChat Style: ${chatStyle}`;
}

export interface MochiRoleplayLocation {
  roleplayMessageId: string;
  /** Which record in the roleplay message holds this bubble. */
  recordIndex: number;
  /** Saved thread name, which can differ from its current display alias. */
  targetName: string;
  /** Index of the message inside that roleplay message's own record. */
  indexInRecord: number;
  /** Where this record begins in the merged thread shown in the UI. */
  recordStartIndex: number;
  /**
   * Whether the record holds any user-authored message.
   *
   * A turn generated by pressing refresh on an empty composer archives only the
   * character's replies, so it has none. The merged thread cannot show this: a
   * continuation turn appends its replies straight onto the previous turn's
   * character run, making `[input, reply, continuation]` look identical to one
   * two-reply turn. The record is the only place the boundary exists.
   */
  recordHasUserMessages: boolean;
}

/** A UI key derived from a saved position; never a transcript field. */
export function mochiRoleplayBubbleId(messageId: string, recordIndex: number, itemIndex: number): string {
  return `${messageId}:mochi:${recordIndex}:${itemIndex}`;
}

/**
 * Find the roleplay message and in-record index that back one bubble in the
 * merged private-chat thread.
 *
 * A contact's thread is hydrated by concatenating every `<chat_history>` record
 * for that contact across all of its roleplay messages, one record per
 * generated turn. So a UI index is only meaningful relative to the record it
 * came from, and addressing it needs the running total of the records before
 * it. Runtime bubble keys address the saved record and item without inserting
 * ids into transcript YAML. Imported ids may repeat, so they never override the
 * selected position.
 */
export function locateMochiMessageInRoleplay(params: {
  roleplayMessages: Array<{ id: string; role?: string; content: string }>;
  /** A render-time index avoids parsing the full archive once per bubble. */
  historyIndex?: { locate(target: { targetName: string; recordType?: MochiChatRecordType; threadIndex: number; threadMessageId?: string }): MochiRoleplayLocation | null };
  userName?: string;
  targetName: string;
  /** Which kind of thread this bubble belongs to. */
  recordType?: MochiChatRecordType;
  /** Index into the merged thread shown in the UI. */
  threadIndex: number;
  /** An in-memory bubble key; not a field written into the roleplay transcript. */
  threadMessageId?: string;
}): MochiRoleplayLocation | null {
  if (params.historyIndex) return params.historyIndex.locate(params);
  const wanted = params.targetName.trim().toLowerCase();
  const records = params.roleplayMessages.flatMap((message) => message.role === "assistant"
    ? parseChatHistoryBlocks(message.content, params.userName).map((block, recordIndex) => ({ message, block, recordIndex }))
    : []);
  const source = records.map((record) => ({
    ...record,
    itemIndex: record.block.messages.findIndex((_, index) =>
      mochiRoleplayBubbleId(record.message.id, record.recordIndex, index) === params.threadMessageId,
    ),
  })).find((record) => record.itemIndex >= 0);
  // A missing runtime source must not fall back to a different saved bubble.
  if (params.threadMessageId?.match(/:mochi:\d+:\d+$/) && !source) return null;
  if (source && params.recordType && source.block.type !== params.recordType) return null;
  const recordType = params.recordType || source?.block.type;
  const sourceTarget = source ? (source.block.target || source.block.contactname || source.block.name || "").trim().toLowerCase() : null;
  let offset = 0;
  let indexedLocation: MochiRoleplayLocation | null = null;

  for (const { message, block, recordIndex } of records) {
    if (recordType && block.type !== recordType) continue;
    const sameThread = sourceTarget !== null
      ? (block.target || block.contactname || block.name || "").trim().toLowerCase() === sourceTarget
      : [block.target, block.contactname, block.name].some((name) => name?.trim().toLowerCase() === wanted);
    if (!sameThread) continue;
    const location = (indexInRecord: number): MochiRoleplayLocation => ({
      roleplayMessageId: message.id, recordIndex, indexInRecord, recordStartIndex: offset,
      targetName: block.target || block.contactname || block.name || params.targetName,
      recordHasUserMessages: block.messages.some((item) => item.me === 1),
    });
    if (source?.message === message && source.recordIndex === recordIndex) return location(source.itemIndex);
    const local = params.threadIndex - offset;
    if (local >= 0 && local < block.messages.length) indexedLocation = location(local);
    offset += block.messages.length;
  }
  return indexedLocation;
}

/**
 * The `<environment>` block a thread's most recent archived turn declared.
 *
 * The clock and weather widgets are applied from a generation response, which
 * only covers the turn that was just produced. Every archived turn carries its
 * own `<environment>`, so without reading them the widgets show whatever the
 * settings held when Mochi OS was entered — on a fresh install that is the
 * `Sunny` / `20°C` default, never the world the thread actually describes. It
 * also means re-entering Mochi OS loses the weather the last turn set.
 *
 * Only a block belonging to this thread counts, and only one that follows this
 * thread's own record in the same message: two threads can share one roleplay
 * turn, each with its own environment, and the newest one in the message is not
 * necessarily the thread on screen.
 */
export function findMochiThreadEnvironment(params: {
  roleplayMessages: Array<{ role?: string; content: string }>;
  targetName: string;
  recordType: MochiChatRecordType;
}): string | null {
  const wanted = params.targetName.trim().toLowerCase();
  if (!wanted) return null;
  const opener = new RegExp(
    `<(?:chat_history|privatechat_history|groupchat_history|group_message)[^>]*\\btarget="${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    "i",
  );
  const environment = /<environment>[\s\S]*?<\/environment>/gi;

  for (let index = params.roleplayMessages.length - 1; index >= 0; index--) {
    const message = params.roleplayMessages[index];
    if (message?.role !== "assistant") continue;
    const recordAt = message.content.search(opener);
    if (recordAt === -1) continue;
    // The environment a turn declares sits after its record, so a block found
    // before the opener belongs to something this thread did not write.
    const lastAfter = [...message.content.matchAll(environment)]
      .filter((match) => match.index !== undefined && match.index > recordAt)
      .pop();
    if (lastAfter) return lastAfter[0];
  }
  return null;
}

/**
 * Work out which messages a regenerate replaces.
 *
 * A normal turn is a run of user inputs followed by the character replies they
 * produced, so the whole turn is replaced and the inputs are resent. A turn
 * generated by pressing refresh on an empty composer has no inputs at all: it
 * is only character replies, and regenerating it must replace just those replies
 * without resending anything the user said earlier.
 *
 * Without the record boundary the scan for the preceding input reaches straight
 * past a continuation turn into the turn before it, which then lumps two
 * records together and replays an input the user is no longer looking at.
 */
export function resolveMochiRegenerationTurn(params: {
  msgs: Array<{ me?: number }>;
  /** The bubble being regenerated. */
  bubbleIndex: number;
  location: Pick<MochiRoleplayLocation, "recordStartIndex" | "recordHasUserMessages"> | null;
}): { inputStartIndex: number; cutIndex: number; historyCutIndex: number; isContinuation: boolean } {
  const { bubbleIndex } = params;
  const turnFloor = params.location ? params.location.recordStartIndex : 0;
  const isContinuation = params.location !== null && !params.location.recordHasUserMessages;

  // A continuation record holds only the character's replies, so the whole record
  // is what a regeneration replaces — there is nothing earlier in it to keep.
  // `historyCutIndex` is where the prompt's history must stop, and it is NOT
  // `inputStartIndex`: that one means "the user said nothing this turn", so it
  // points at the pressed bubble and would hand the record's earlier replies back
  // to the model as history it is being asked to replace. The group's attributed
  // replay is built from that history, so it showed the replaced replies verbatim.
  if (isContinuation) {
    return {
      inputStartIndex: bubbleIndex,
      cutIndex: bubbleIndex,
      historyCutIndex: turnFloor,
      isContinuation: true,
    };
  }

  let precedingUserIdx = -1;
  for (let index = bubbleIndex; index >= turnFloor; index--) {
    if (params.msgs[index]?.me === 1) {
      precedingUserIdx = index;
      break;
    }
  }
  if (precedingUserIdx === -1) {
    return { inputStartIndex: bubbleIndex, cutIndex: bubbleIndex, historyCutIndex: bubbleIndex, isContinuation: false };
  }

  let userRunStart = precedingUserIdx;
  while (userRunStart > turnFloor && params.msgs[userRunStart - 1]?.me === 1) userRunStart--;
  return {
    inputStartIndex: userRunStart,
    cutIndex: precedingUserIdx + 1,
    historyCutIndex: userRunStart,
    isContinuation: false,
  };
}

/**
 * How many leading Mochi OS private-chat messages stay on screen while a bubble
 * is being regenerated, so the replaced bubbles disappear until new ones arrive.
 *
 * A normal turn keeps its resent user inputs and erases only the replies after
 * them (everything from `cutIndex` onward). A continuation turn has no inputs,
 * so every reply in its record is being replaced; trimming at cutIndex would
 * leave the earlier replies of that character-only record on screen until
 * generation finishes, because for a continuation cutIndex equals the pressed
 * bubble's own index. Those records are addressed by their position in the merged
 * thread and start at `recordStartIndex`.
 */
export function mochiRegenerationVisibleMessageCount(params: {
  isContinuation: boolean;
  recordStartIndex?: number | null;
  cutIndex: number;
}): number {
  if (params.isContinuation) return params.recordStartIndex ?? params.cutIndex;
  return params.cutIndex;
}

/**
 * The roleplay records a generated turn should overwrite in place, if any.
 *
 * A regeneration deletes the records it replaces before generating and passes
 * their ids as `deletedRecordIds`. Those records are already gone, so the
 * replacement must simply be appended.
 *
 * Matching by message id instead would compare the surviving records against
 * the history this turn *kept*, so a record carrying ids would match that kept
 * history and get overwritten. Regenerating a continuation turn then wiped the
 * previous turn, because the history it kept *was* the previous turn.
 */
export function resolveMochiReplacementTurns(params: {
  roleplayMessages: Array<{ id: string; role?: string; content: string }>;
  userName?: string;
  targetName: string;
  /** Which kind of thread the regenerated turn belongs to. */
  recordType: MochiChatRecordType;
  /** Records this regeneration already deleted. Any non-empty list disables replacement. */
  deletedRecordIds: string[];
  /** Messages whose ids mark a record as the one being replaced. */
  contactMessageIds: Array<string | undefined>;
}): Array<{ id: string }> {
  if (params.deletedRecordIds.length > 0) return [];
  const ids = new Set(params.contactMessageIds);
  const wanted = params.targetName.trim().toLowerCase();
  return params.roleplayMessages.filter((message) => {
    if (message.role !== "assistant") return false;
    const block = parseChatHistoryBlocks(message.content, params.userName, {
      recordType: params.recordType,
    }).find((entry) => (entry.target || "").trim().toLowerCase() === wanted);
    if (!block || block.type !== params.recordType) return false;
    return block.messages.some((item) => ids.has(item.id || ""));
  });
}

/**
 * Remove one message from a thread, dropping its whole turn when it was the
 * last character reply of one.
 *
 * A turn is the run of user messages followed by the run of character replies
 * they produced. Removing the final reply leaves an orphaned input with nothing
 * answering it, so the turn goes with it. Both the on-screen thread and the
 * archived record must apply this identically, or a delete updates the screen
 * and leaves the record holding a different history.
 */
export function removeMochiThreadMessage<T extends { me?: number }>(messages: T[], index: number): T[] {
  const removed = messages[index];
  if (!removed) return messages;

  if (removed.me !== 1) {
    let turnStart = index;
    while (turnStart > 0 && messages[turnStart - 1]?.me === 1) turnStart--;
    let turnEnd = index + 1;
    while (turnEnd < messages.length && messages[turnEnd]?.me !== 1) turnEnd++;
    const remainingReplies = messages
      .slice(turnStart, turnEnd)
      .filter((message, position) => turnStart + position !== index && message.me !== 1);
    if (remainingReplies.length === 0) {
      return messages.filter((_, position) => position < turnStart || position >= turnEnd);
    }
  }

  return messages.filter((_, position) => position !== index);
}

export interface ParsedChatHistoryBlock {
  target?: string;
  type?: string;
  name?: string;
  /** Display alias from a legacy record. Current private output identifies the contact by target=. */
  contactname?: string;
  date?: string;
  time?: string;
  /** Roster size a group record declares; absent on private records. */
  members?: number;
  messages: Array<{
    id?: string;
    me: 0 | 1;
    type: string;
    text: string;
    time?: string;
    date?: string;
    dur?: string;
    /** Author of a group message; absent in a private record, whose reader is always the contact. */
    sender?: string;
    rawItem?: Record<string, any>;
    reactions?: MochiMessage['reactions'];
  }>;
}

export interface ParsedMochiChatWidget {
  chat: ParsedChatHistoryBlock;
  environment: ParsedEnvironment;
}

export type MochiChatContentPart = { type: "text"; value: string } | { type: "widget"; value: ParsedMochiChatWidget };

/** Back-compat alias: the private-chat widget is a `MochiChatWidget` of type "private". */
export type ParsedMochiPrivateChatWidget = ParsedMochiChatWidget;

/** The record opener a given record type is stored as, e.g. `<privatechat_history target="…" type="private">` or `<chat_history target="…" type="group">`. */
function chatRecordOpener(recordType: MochiChatRecordType, target: string): string {
  if (recordType === "private") {
    return `<privatechat_history target="${target}" type="private">`;
  }
  return `<chat_history target="${target}" type="${recordType}">`;
}

/** The matching closer. A record is never closed with a bare `</chat_history>`. */
function chatRecordCloser(recordType: MochiChatRecordType): string {
  return recordType === "group" ? "</groupchat_history>" : "</privatechat_history>";
}

/**
 * Split complete records of one type that are immediately followed by a valid
 * environment block into widgets, keeping any surrounding text as text parts.
 */
function parseMochiChatContent(rawText: string, userName: string | undefined, recordType: MochiChatRecordType) {
  const openerPattern =
    recordType === "private"
      ? `(?:chat_history|privatechat_history)\\s+target="([^"]+)"\\s+type="${recordType}"`
      : `(?:chat_history|groupchat_history)\\s+target="([^"]+)"(?:\\s+type="${recordType}")?`;
  const recordPattern = new RegExp(
    `<${openerPattern}[^>]*>[\\s\\S]*?<\\/(?:chat_history|privatechat_history|groupchat_history)>\\s*<environment>([\\s\\S]*?)<\\/environment>`,
    "gi",
  );
  const matches = Array.from(rawText.matchAll(recordPattern));
  const validMatches = matches.filter((match) => {
    const source = match[0];
    const environmentIndex = source.search(/<environment>/i);
    return (
      parseChatHistoryBlocks(source.slice(0, environmentIndex).trim(), userName, { recordType }).length === 1 &&
      parseEnvironmentYaml(source.slice(environmentIndex)) !== null
    );
  });
  const parts: MochiChatContentPart[] = [];
  let cursor = 0;

  for (const match of validMatches) {
    const source = match[0];
    const chatSource = source.slice(0, source.search(/<environment>/i)).trim();
    const environmentSource = source.slice(source.search(/<environment>/i));
    const chat = parseChatHistoryBlocks(chatSource, userName || "{{user}}", { recordType })[0];
    const environment = parseEnvironmentYaml(environmentSource);
    if (!chat || !environment) continue;

    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", value: rawText.slice(cursor, index) });
    parts.push({ type: "widget", value: { chat, environment } });
    cursor = index + source.length;
  }

  if (parts.length === 0) return [];
  if (cursor < rawText.length) parts.push({ type: "text", value: rawText.slice(cursor) });
  return parts;
}

/** Split only complete targeted private-chat records immediately followed by a valid environment block. */
export function parseMochiPrivateChatContent(rawText: string, userName?: string): MochiChatContentPart[] {
  return parseMochiChatContent(rawText, userName, "private");
}

/** Split only complete targeted group-chat records immediately followed by a valid environment block. */
export function parseMochiGroupChatContent(rawText: string, userName?: string): MochiChatContentPart[] {
  return parseMochiChatContent(rawText, userName, "group");
}

/**
 * Parse every `<chat_history>` record in a YAML document, one result per thread.
 *
 * A record is one conversation: a private record holds the user's thread with a
 * single contact, a group record holds a multi-party thread identified by the
 * group name. Records must stay isolated — messages from one thread must never be
 * merged into another's.
 *
 * `recordType` narrows the result to one kind of thread, so a caller rebuilding
 * one thread's archive never picks up the other's records.
 */
export function parseChatHistoryBlocks(
  rawYaml: string,
  userName?: string,
  options?: { recordType?: MochiChatRecordType },
): ParsedChatHistoryBlock[] {
  if (!rawYaml || !rawYaml.trim()) return [];

  let cleanedYaml = stripMochiReasoning(rawYaml);
  if (!cleanedYaml) return [];

  const outerFence = cleanedYaml.match(/^```(?:yaml)?\s*([\s\S]*?)\s*```$/i);
  if (outerFence && outerFence[1]) {
    cleanedYaml = outerFence[1].trim();
  }

  // Only real record containers are split. `<messages>`/`<message>` are inner
  // list wrappers, so treating them as records would split one thread's history
  // into several fake threads. A `groupchat_history` opener with no `type`
  // attribute is the guide's own output form and is read as a group record.
  const recordPattern =
    /<(chat_history|privatechat_history|groupchat_history|group_message)(?:\s+target="([^"]*)")?(?:\s+type="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:chat_history|groupchat_history|group_message|privatechat_history)>/gi;
  const rawRecords = Array.from(cleanedYaml.matchAll(recordPattern));
  const wantedType = options?.recordType;
  const records: ParsedChatHistoryBlock[] = [];
  for (const match of rawRecords) {
    const targetAttr = match[2]?.trim();
    const declaredType = match[3]?.trim().toLowerCase();
    const recordType: MochiChatRecordType =
      declaredType === "group" || (declaredType !== "private" && isMochiGroupRecordTag(match[1])) ? "group" : "private";
    if (wantedType && recordType !== wantedType) continue;
    const record = parseSingleChatHistoryRecord(match[4] || "", targetAttr, recordType, userName);
    if (record) records.push(record);
  }
  if (records.length === 0 && !wantedType) {
    const single = parseLegacyChatHistoryRecord(cleanedYaml, userName);
    return single ? [single] : [];
  }
  return records;
}

/** Parse one `<chat_history>` record body into its normalized message list. */
function parseSingleChatHistoryRecord(
  rawBody: string,
  target?: string,
  type?: string,
  userName?: string,
): ParsedChatHistoryBlock | null {
  let blockBody = rawBody.trim();
  blockBody = blockBody
    .replace(/^```[a-zA-Z0-9_-]*\s*\n/i, "")
    .replace(/\n```\s*$/i, "")
    .trim();
  blockBody = blockBody.replace(/^(\s*)\{\{([^}]+)\}\}:/gm, '$1"{{$2}}":');

  try {
    const parsed = yaml.parse(repairTrailingQuotedYamlContent(blockBody));
    if (!parsed || typeof parsed !== "object") return null;
    const rawList = Array.isArray((parsed as any).messages) ? ((parsed as any).messages as any[]) : [];
    const normalizedUserName = (userName || "").trim().toLowerCase();
    const messages = rawList
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const senderVal = readMochiSender(item);
        let isUser = false;
        if (
          item["{{user}}"] === true ||
          item["{{user}}"] === "true" ||
          item["{{user}}"] === 1 ||
          Object.entries(item).some(([key, value]) => {
            const marker = key.trim().toLowerCase();
            const isTrue = value === true || value === "true" || value === 1;
            return (
              isTrue &&
              (marker === "{{user}}" ||
                (marker !== "me" &&
                  marker !== "user" &&
                  marker !== "isuser" &&
                  marker !== "sender" &&
                  marker !== (target || "").trim().toLowerCase()))
            );
          })
        ) {
          isUser = true;
        } else if (item.me === 1 || item.me === true || item.user === true || item.isUser === true) {
          isUser = true;
        } else if (normalizedUserName) {
          if (item[normalizedUserName] === true || item[normalizedUserName] === "true") {
            isUser = true;
          } else if (item.name && String(item.name).trim().toLowerCase() === normalizedUserName) {
            isUser = true;
          } else if (senderVal && senderVal.toLowerCase() === normalizedUserName) {
            // A group record attributes every message, including the user's own,
            // so the sender name is how the user's bubbles are recognised there.
            isUser = true;
          }
        }

        const rawType = (item.t || item.type || "text").toString().toLowerCase();
        const cleanContent = (item.c ?? item.content ?? item.text ?? "").toString().trim();
        const durVal = (item.dur ?? item.duration)?.toString().trim();

        let bubbleType = rawType;
        let displayText = cleanContent;
        if (rawType === "sticker") {
          displayText = cleanContent.replace(/^\[Sticker\]\s*/i, "") || "sticker";
        } else if (rawType === "voice") {
          displayText = cleanContent || "voice note";
        } else if (rawType === "image" || rawType === "imgdesc") {
          bubbleType = rawType;
          displayText = cleanContent ? `[Photo: ${cleanContent}]` : "[Photo]";
        } else if (isMochiTransferType(rawType)) {
          bubbleType = rawType;
          displayText = "";
        } else if (!displayText && item.quote) {
          displayText = typeof item.quote === "string" ? item.quote : item.quote.c || "[Quote]";
        } else if (!displayText && rawType === "file") {
          // A group file item carries `name`/`size`/`desc` and no prose body.
          displayText = String(item.name ?? item.fileName ?? "").trim();
        }

        return {
          id: item.id ? String(item.id).trim() : undefined,
          me: (isUser ? 1 : 0) as 0 | 1,
          type: bubbleType,
          text: displayText,
          time: (item.time ?? item.t_time)?.toString().trim() || undefined,
          dur: durVal || (rawType === "voice" ? "0:05" : undefined),
          sender: senderVal || undefined,
          rawItem: item,
          reactions: Array.isArray(item.reactions) ? item.reactions : undefined,
        };
      });

    const declaredMembers = Number((parsed as any).members);
    // Current private records need no name field: target= is their stable
    // identity. Continue reading contactname/name from older records.
    const recordName =
      typeof (parsed as any).contactname === "string" ? (parsed as any).contactname : (parsed as any).name;
    const recordContactName =
      typeof (parsed as any).contactname === "string" && (parsed as any).contactname
        ? (parsed as any).contactname
        : undefined;
    return {
      target: target || recordName || "Character",
      name: recordName || target,
      contactname: recordContactName,
      type: type || "private",
      date: parsed.date ? String(parsed.date) : undefined,
      time: parsed.time ? String(parsed.time) : undefined,
      members: Number.isFinite(declaredMembers) && declaredMembers > 0 ? declaredMembers : undefined,
      messages,
    };
  } catch {
    return null;
  }
}

/** Keep generated trailing text inside a quoted message scalar when YAML quotes are unbalanced. */
function repairTrailingQuotedYamlContent(source: string): string {
  return source.replace(
    /^(\s*c:\s*)"([^"]*)"([^\r\n]+)$/gm,
    (_line, prefix: string, quoted: string, trailing: string) => {
      if (!trailing.trim() || trailing.trimStart().startsWith("#")) return `${prefix}"${quoted}"${trailing}`;
      return `${prefix}${JSON.stringify(`"${quoted}"${trailing}`)}`;
    },
  );
}

/**
 * Parse a legacy document that has no typed `<chat_history>` record, falling
 * back to the guide's own `groupchat_history` form and the inner
 * `<messages>`/`<message>` wrappers.
 */
function parseLegacyChatHistoryRecord(cleanedYaml: string, userName?: string): ParsedChatHistoryBlock | null {
  const tagMatch =
    cleanedYaml.match(
      /<(chat_history|privatechat_history|groupchat_history|group_message)(?:\s+target="([^"]*)")?(?:\s+type="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:chat_history|groupchat_history|group_message|privatechat_history)>/i,
    ) ||
    cleanedYaml.match(/<messages>([\s\S]*?)<\/messages>/i) ||
    cleanedYaml.match(/<message>([\s\S]*?)<\/message>/i);
  if (!tagMatch) {
    return parseSingleChatHistoryRecord(cleanedYaml, undefined, undefined, userName);
  }
  const declaredType = tagMatch[3]?.trim().toLowerCase();
  const recordType: MochiChatRecordType =
    declaredType === "group" || (declaredType !== "private" && isMochiGroupRecordTag(tagMatch[1]))
      ? "group"
      : "private";
  return parseSingleChatHistoryRecord(tagMatch[4] || "", tagMatch[2], recordType, userName);
}

/**
 * Parse the chat history for a single thread.
 *
 * `contactName` scopes the result to that thread's own record so messaging one
 * character never repopulates another conversation, and `recordType` keeps the two
 * thread kinds apart. When the file holds no record for that thread, `null` is
 * returned rather than falling back to another thread's messages.
 */
export function parseChatHistoryYaml(
  rawYaml: string,
  userName?: string,
  contactName?: string,
  options?: { recordType?: MochiChatRecordType },
): ParsedChatHistoryBlock | null {
  if (!rawYaml || !rawYaml.trim()) return null;

  if (contactName) {
    const blocks = parseChatHistoryBlocks(rawYaml, userName, options);
    const wanted = contactName.trim().toLowerCase();
    const match =
      blocks.find((b) => (b.target || "").trim().toLowerCase() === wanted) ||
      blocks.find((b) => (b.name || "").trim().toLowerCase() === wanted);
    return match || null;
  }

  // Unscoped call: fall back to the legacy single-record parse so files without
  // typed records still hydrate.
  const legacy = parseLegacyChatHistoryRecord(rawYaml, userName);
  if (legacy && options?.recordType && legacy.type !== options.recordType) return null;
  return legacy;
}

/**
 * Build the Time/Date/Weather guide block a format-guides marker sends.
 *
 * The guide template always goes out: it is what tells the model to answer with
 * an `<environment>` block. The `# Current Time / Date / Weather Settings` list
 * appended to it only goes out when the user actually configured something.
 * With both the clock and the weather set to "let AI decide", every line in that
 * list is an empty placeholder and the only other line is the generic condition
 * menu, so the list carries no information at all — it only reads as a set of
 * blanks the model is meant to ignore.
 */
export function buildMochiTimeDateWeatherBlock(params: {
  template: string;
  envLines: string[];
  /** False when the clock and the weather are both AI-decided. */
  hasConfiguredSettings: boolean;
}): string {
  if (!params.hasConfiguredSettings) return params.template;
  return `${params.template}\n\n# Current Time / Date / Weather Settings\n${params.envLines.join("\n")}`;
}

/**
 * Build the `format_guides` marker block for a Mochi OS data generation.
 *
 * The marker is shared by both request kinds, so the data generation used to
 * send every guide. Only the data guide belongs here: the chat and drawing
 * guides describe a chat turn's output rather than the `<phone_data>` document
 * being generated, and the time/date/weather guide asks for an `<environment>`
 * block that this request has nowhere to put. The existing document still goes
 * out first, since the model is asked to extend it rather than start over.
 */
export function buildMochiDataGenerationGuideBlock(params: { existingYaml?: string; dataGuide: string }): string {
  let block = "以下是现有的数据，请在此基础上按照已知信息补充数据，允许新增人物群聊：";
  if (params.existingYaml) {
    block += `\n\n<current_phone_data>\n${params.existingYaml}\n</current_phone_data>\n\nModify, update, or expand this data according to the user's instructions and roleplay context while preserving existing IDs and details unless asked to change them.`;
  }
  if (params.dataGuide) {
    block += `\n\n${params.dataGuide}`;
  }
  return block;
}

/**
 * Build a chat thread's history section of a generation prompt.
 *
 * Returns "" when there is no prior Mochi OS history, so an empty
 * `messages: []` block is never sent to the model on a chat's first message.
 * `roleplayHistory` is included when present, and the thread YAML is appended
 * after it without nesting it inside a second `<chat_history>` wrapper.
 */
export function buildMochiChatHistoryPromptSection(params: {
  roleplayHistory?: string;
  messages: Array<MochiMessage>;
  targetName: string;
  /** Which thread kind to serialize when no archive is supplied. */
  recordType?: MochiChatRecordType;
  members?: number;
  /** Canonical records taken from the archived YAML. Preferred over re-serialization. */
  archivedYaml?: string;
  environmentBlocks?: string[];
}): string {
  const threadYaml =
    params.archivedYaml !== undefined
      ? params.archivedYaml
      : params.messages.length > 0
        ? serializeChatHistoryYaml({
            targetName: params.targetName,
            messages: params.messages,
            recordType: params.recordType,
            members: params.members,
          })
        : "";
  return [params.roleplayHistory, threadYaml, ...(params.environmentBlocks || [])].filter(Boolean).join("\n\n");
}

/** Return archived environments whose associated contact record still has retained messages. */
export function getRetainedPrivateChatEnvironmentBlocks(
  rawYaml: string,
  targetName: string,
  retainedMessages: MochiMessage[],
): string[] {
  const retainedIds = new Set(retainedMessages.map((message) => message.id).filter(Boolean));
  if (!rawYaml || retainedIds.size === 0) return [];

  const wantedTarget = targetName.trim().toLowerCase();
  const blockPattern =
    /<(?:chat_history|privatechat_history|groupchat_history|group_message)(?:\s+target="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:chat_history|privatechat_history|groupchat_history|group_message)>(\s*<environment>[\s\S]*?<\/environment>)?/gi;
  const environments: string[] = [];
  for (const match of rawYaml.matchAll(blockPattern)) {
    const recordTarget = (match[1] || "").trim().toLowerCase();
    if (wantedTarget && recordTarget && recordTarget !== wantedTarget) continue;
    const ids = Array.from((match[2] || "").matchAll(/^\s*-\s*id:\s*["']?([^\s"']+)/gm), (idMatch) => idMatch[1]);
    if (!ids.some((id) => retainedIds.has(id))) continue;
    const environment = match[3]?.trim();
    if (environment && !environments.includes(environment)) environments.push(environment);
  }
  return environments;
}

/**
 * Build the shared private-chat history straight from archived YAML, so each
 * character sees the same cross-contact history shown by the Mochi OS log.
 *
 * Re-serializing the in-memory bubbles used to produce a different document:
 * quote replies lost their nested `quote` block, environments were emitted out of
 * order, and any message deleted from the file could still be sent because it was
 * rebuilt from stale UI state. Reading the archive instead means the prompt can
 * only contain records that still exist, in their canonical format.
 *
 * The archive, not the in-memory bubbles, is authoritative. This preserves exact
 * turn and environment formatting and avoids losing messages when IDs restart in
 * each record. Regeneration persists its truncated archive before building this
 * prompt, so the replaced turn is already absent here. The full archive is shared
 * across contacts; a character can see messages sent to other Mochi contacts.
 */
export function buildPrivateChatPromptFromArchive(params: { rawYaml: string }): string {
  return buildChatHistoryPromptFromArchive({ ...params, recordType: "private" });
}

/**
 * Build one group's prompt history straight from its archived records.
 *
 * Group records are kept apart from private ones on purpose: the group guide
 * scopes a turn to the named group, so handing a group roster the user's private
 * conversations with the same characters would contradict the format it must
 * follow. `groupName` selects the records when the archive holds several groups.
 */
export function buildGroupChatPromptFromArchive(params: { rawYaml: string; groupName?: string }): string {
  return buildChatHistoryPromptFromArchive({ ...params, recordType: "group" });
}

/** Shared archive reader behind the private- and group-chat prompt builders. */
function buildChatHistoryPromptFromArchive(params: {
  rawYaml: string;
  recordType: MochiChatRecordType;
  groupName?: string;
}): string {
  const { rawYaml, recordType } = params;
  if (!rawYaml || !rawYaml.trim()) return "";

  const wantedType = recordType;
  const wantedTarget = params.groupName?.trim().toLowerCase();
  const recordPattern =
    /<(chat_history|privatechat_history|groupchat_history|group_message|message|messages)(?:\s+target="([^"]*)")?(?:\s+type="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:\1|privatechat_history|groupchat_history|group_message)>(\s*<environment>[\s\S]*?<\/environment>)?/gi;

  const records: string[] = [];
  for (const match of rawYaml.matchAll(recordPattern)) {
    const body = match[4] || "";
    if (!body.trim()) continue;
    const declaredType = match[3]?.trim().toLowerCase();
    const isGroup = declaredType === "group" || (declaredType !== "private" && isMochiGroupRecordTag(match[1]));
    if ((isGroup ? "group" : "private") !== wantedType) continue;
    const target = (match[2] || "").trim().toLowerCase();
    if (wantedTarget && target && target !== wantedTarget) continue;
    // Preserve each canonical record and its attached environment verbatim.
    records.push(match[0].trim());
  }

  return records.join("\n\n");
}

/** Merge roleplay messages and canonical chat log records by receive time. */
export function buildChronologicalChatHistoryContent(params: {
  privateChatLog: string;
  roleplayMessages: Array<{ timestamp: string; content: string }>;
  privateChatTimestamps?: Array<{ timestamp: string; content: string }>;
}): string {
  type HistoryItem = { timestamp: number; order: number; content: string };
  const items: HistoryItem[] = [];
  let order = 0;

  if (params.privateChatLog.trim()) {
    const records = Array.from(
      params.privateChatLog.matchAll(
        /<(chat_history|groupchat_history|group_message|message|messages)(?:\s+[^>]*)?>[\s\S]*?<\/(?:\1|privatechat_history|groupchat_history|group_message)>(\s*<environment>[\s\S]*?<\/environment>)?/gi,
      ),
    );
    const timestampByContent = new Map<string, number>();
    for (const entry of params.privateChatTimestamps || []) {
      const timestamp = Date.parse(entry.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      const loggedRecords = entry.content.matchAll(
        /<(chat_history|groupchat_history|group_message|message|messages)(?:\s+[^>]*)?>[\s\S]*?<\/(?:\1|privatechat_history|groupchat_history|group_message)>(\s*<environment>[\s\S]*?<\/environment>)?/gi,
      );
      for (const loggedRecord of loggedRecords) {
        const content = loggedRecord[0].trim();
        if (!timestampByContent.has(content)) timestampByContent.set(content, timestamp);
      }
    }
    for (const record of records) {
      const content = record[0].trim();
      const timestamp = timestampByContent.get(content);
      items.push({
        timestamp: timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
        order: order++,
        content,
      });
    }
  }

  for (const message of params.roleplayMessages) {
    const timestamp = Date.parse(message.timestamp);
    items.push({
      timestamp: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
      order: order++,
      content: message.content,
    });
  }

  items.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);
  return items
    .map((item) => item.content)
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Remove only the last `<chat_history>` record for one thread, together with the
 * `<environment>` block directly attached to it.
 *
 * Regeneration replaces the newest turn of the thread being regenerated, whether
 * that thread is a contact's private chat or a group. Truncating the archive this
 * way keeps every earlier record and its environment intact, and leaves other
 * threads in the same document untouched — which matters most here, because a
 * single archive can hold private records and group records side by side. The
 * `recordType` filter is what keeps the two kinds from truncating each other.
 * Re-serializing the retained messages instead (the previous approach) silently
 * discarded every environment that was not carried in the in-memory state, so
 * regenerating one turn deleted environments belonging to unrelated earlier turns.
 */
export function removeLastMochiChatRecord(
  rawYaml: string,
  targetName: string,
  recordIds?: Array<string | undefined>,
  options?: { recordType?: MochiChatRecordType },
): string {
  if (!rawYaml || !rawYaml.trim()) return "";

  const wantedType = options?.recordType;
  const wantedTarget = targetName.trim().toLowerCase();
  const recordPattern =
    /<(chat_history|privatechat_history|groupchat_history|group_message)(?:\s+target="([^"]*)")?(?:\s+type="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:chat_history|privatechat_history|groupchat_history|group_message)>(\s*<environment>[\s\S]*?<\/environment>)?/gi;

  // Track every record for this thread, so the last one (the regenerated turn)
  // can be removed without touching earlier turns or other threads.
  const matches = Array.from(rawYaml.matchAll(recordPattern));
  let lastStart = -1;
  let lastEnd = -1;
  for (const match of matches) {
    const declaredType = match[3]?.trim().toLowerCase();
    const recordType: MochiChatRecordType =
      declaredType === "group" || (declaredType !== "private" && isMochiGroupRecordTag(match[1])) ? "group" : "private";
    if (wantedType && recordType !== wantedType) continue;
    const recordTarget = (match[2] || "").trim().toLowerCase();
    if (wantedTarget && recordTarget && recordTarget !== wantedTarget) continue;

    // When the caller knows the ids of the regenerated turn, only drop a record
    // that actually holds one of them. This avoids deleting an unrelated newest
    // record when the regenerated turn was never archived.
    if (recordIds && recordIds.length > 0) {
      const body = match[4] || "";
      const holdsTurn = recordIds.some((id) => id && new RegExp(`\\bid:\\s*["']?${id}\\b`).test(body));
      if (!holdsTurn) continue;
    }

    // Only the environment attached to the matched record is part of its span.
    lastStart = match.index ?? -1;
    lastEnd = (match.index ?? 0) + match[0].length;
  }

  if (lastStart < 0) return rawYaml.trim();

  const before = rawYaml.slice(0, lastStart);
  const after = rawYaml.slice(lastEnd);
  return `${before.replace(/\s+$/, "")}${after ? `\n${after.replace(/^\s+/, "")}` : ""}`.trim();
}

/**
 * Decide whether a private-chat YAML payload should be applied to on-screen state.
 *
 * A refetch that was already in flight when a delete was saved resolves with the
 * YAML as it was *before* that delete. React Query returns a fresh object for it,
 * so rehydrating on identity alone puts a message the user just deleted straight
 * back, and it only disappears after a second delete. Comparing content makes
 * such a repeat a no-op while genuine external edits and new turns still apply.
 */
export function shouldHydratePrivateChatYaml(lastAppliedYaml: string | undefined, incomingYaml: string): boolean {
  if (!incomingYaml) return false;
  return incomingYaml !== lastAppliedYaml;
}

/** Preserve answered user bubbles if history hydration runs during generation. */
export function restoreAnsweredUserMessages(
  currentMessages: MochiMessage[],
  answeredUserMessages: MochiMessage[],
): MochiMessage[] {
  const missing = answeredUserMessages.filter((message) => !currentMessages.includes(message));
  return missing.length ? [...currentMessages, ...missing] : currentMessages;
}

/**
 * The contacts-map entry for the thread on screen, and nothing else.
 *
 * Falling back to the map's first entry shows one thread's messages inside
 * another thread's header: opening a group chat that has no rehydrated record
 * yet would render an unrelated character's private chat. A thread that has no
 * entry is an empty thread, so an unmatched id resolves to `undefined`.
 */
export function selectMochiThreadContact<T>(contacts: Record<string, T>, threadId: string): T | undefined {
  if (!contacts || !threadId) return undefined;
  return contacts[threadId];
}

/** Saved roleplay history replaces local history, including an emptied thread.
 * Only unsaved user inputs and explicitly in-flight regenerations may survive. */
export function reconcileMochiContactHistory(params: {
  local: MochiContactsMap;
  archived: MochiContactsMap;
  pendingUserMessages: Record<string, MochiMessage[]>;
  regeneratingThreadIds: ReadonlySet<string>;
}): MochiContactsMap {
  const next: MochiContactsMap = { ...params.local };
  let changed = false;
  const threadIds = new Set([...Object.keys(params.local), ...Object.keys(params.archived)]);
  for (const threadId of threadIds) {
    const previous = params.local[threadId];
    if (previous && params.regeneratingThreadIds.has(threadId)) continue;
    const archived = params.archived[threadId];
    const contact = archived || previous;
    if (!contact) continue;
    const msgs = [...(archived?.msgs || [])];
    const savedIds = new Set(msgs.map((message) => message.id).filter(Boolean));
    for (const pending of params.pendingUserMessages[threadId] || []) {
      if (pending.id && savedIds.has(pending.id)) continue;
      msgs.push(pending);
      if (pending.id) savedIds.add(pending.id);
    }
    const preview = mochiMessagePreview(msgs.at(-1));
    if (previous && previous.name === contact.name && previous.preview === preview &&
        JSON.stringify(previous.msgs) === JSON.stringify(msgs)) continue;
    next[threadId] = {
      ...previous, ...contact, color: previous?.color || contact.color,
      msgs, preview, unread: 0,
    };
    changed = true;
  }
  return changed ? next : params.local;
}

/** Merge separate archived turns into one thread's chronological message history. */
export function mergeMochiChatHistoryBlocks<
  T extends {
    type?: string;
    target?: string;
    name?: string;
    date?: string;
    time?: string;
    members?: number;
    messages: MochiMessage[];
  },
>(blocks: T[]): T[] {
  const merged = new Map<string, T>();
  for (const block of blocks) {
    const key = `${block.type || "private"}:${(block.target || block.name || "Character").trim().toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) {
      existing.messages.push(...block.messages);
      existing.date = block.date || existing.date;
      existing.time = block.time || existing.time;
      existing.members = Math.max(existing.members ?? 0, block.members ?? 0) || undefined;
    } else {
      merged.set(key, { ...block, messages: [...block.messages] });
    }
  }
  return Array.from(merged.values());
}

export function serializeChatHistoryYaml(params: {
  targetName: string;
  date?: string;
  time?: string;
  messages: Array<MochiMessage>;
  environmentYaml?: string;
  /** Which thread kind to write. Group records close with `</groupchat_history>`. */
  recordType?: MochiChatRecordType;
  /** Roster size written into a group record's `members:` field. */
  members?: number;
}): string {
  const { targetName, messages, environmentYaml } = params;
  const recordType = params.recordType ?? "private";
  const conversationDate =
    params.date ||
    new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const conversationTime = params.time || messages[0]?.t || "12:00 PM";

  const messageItems = messages.map((m) => {
    const rawType = m.rawType || m.type || "text";
    const item: Record<string, any> = {
      t: rawType,
    };

    if (m.t) {
      item.time = m.t;
    }

    if (m.me === 1) {
      item["{{user}}"] = true;
    }

    // Group records attribute every message. The user's own items keep the
    // `{{user}}` marker as the source of truth for which side spoke, and carry the
    // name only so the transcript matches the guide's `sender` shape.
    const senderName = (m.sender ?? readMochiSender(m.rawItem) ?? "").trim();
    if (recordType === "group" && senderName) {
      item.sender = { name: senderName };
    }
    if (m.reactions?.length) item.reactions = m.reactions;

    if (rawType === "voice") {
      item.c = m.text || "voice note";
      if (m.dur) item.duration = m.dur;
    } else if (rawType === "sticker") {
      item.c = m.text || "sticker";
    } else if (isMochiTransferType(rawType)) {
      // The card's body is amt/note, so never invent a `c:` for it. An
      // outcome item has no note of its own; it restates the amount it settled.
      // The authored amount is kept verbatim so a currency the sender wrote
      // (the guide's `¥520.00`) survives a reload instead of being re-currencyed.
      const authored = m.rawItem?.amt ?? m.rawItem?.amount;
      const amount = formatMochiTransferAmount(m.rawItem);
      if (amount) item.amt = authored === undefined || authored === null ? amount : String(authored);
      if (!mochiTransferOutcome(rawType)) {
        const note = mochiTransferNote(m.rawItem);
        if (note) item.note = note;
      }
    } else if (m.rawItem && typeof m.rawItem === "object") {
      // Preserve other fields like quote, link, etc. if available. `sender` is
      // excluded because it was resolved above and re-copying the raw object would
      // override an edited author with the one the model originally wrote.
      for (const [key, val] of Object.entries(m.rawItem)) {
        if (key !== "id" && key !== "t" && key !== "time" && key !== "{{user}}" && key !== "name" && key !== "sender" && key !== "reactions") {
          item[key] = val;
        }
      }
      if (!item.c && m.text) {
        item.c = m.text;
      }
    } else {
      item.c = m.text || "";
    }

    return item;
  });

  // Private records identify the character exclusively through target=. Contact
  // aliases live in phone_data, not the private output. Group output is unchanged.
  const chatObj: Record<string, any> = {
    ...(recordType === "group" ? { name: targetName } : {}),
    date: conversationDate,
    time: conversationTime,
  };
  if (recordType === "group") {
    // The guide's group envelope declares its roster size; fall back to the number
    // of distinct speakers so a record written without a roster is still valid.
    const distinctSenders = new Set(
      messageItems.map((item) => (item.sender as { name?: string } | undefined)?.name?.trim() || ""),
    );
    distinctSenders.delete("");
    chatObj.members =
      params.members ?? (distinctSenders.size > 0 ? distinctSenders.size : messageItems.length || undefined);
    if (chatObj.members !== undefined) chatObj.members = Number(chatObj.members) || undefined;
  }
  chatObj.messages = messageItems;

  const yamlBody = yaml.stringify(chatObj).trim();

  // The YAML library must quote the `{{user}}` key because it is not a plain key,
  // but the canonical Mochi OS format writes it unquoted. Normalize here so every
  // client write path (edit, delete, regenerate, branch) matches the server's
  // output and the log stays consistent across a fresh chat and a continuation.
  const normalizedBody = unquoteUserFlagKey(yamlBody);

  let result = `${chatRecordOpener(recordType, targetName)}\n${normalizedBody}\n${chatRecordCloser(recordType)}`;

  if (environmentYaml && environmentYaml.trim()) {
    const envTrimmed = environmentYaml.trim();
    const envBlock = envTrimmed.startsWith("<environment>")
      ? envTrimmed
      : `<environment>\n${envTrimmed}\n</environment>`;
    result += `\n\n${envBlock}`;
  }

  return result;
}

/**
 * Write the `{{user}}` marker unquoted.
 *
 * Serializing with the YAML library always quotes the key (`"{{user}}": true`)
 * because it is not a plain scalar. The canonical format uses the bare key, and
 * the server writes it bare, so both forms would otherwise appear depending on
 * whether a turn was written by the client or the server.
 */
export function unquoteUserFlagKey(yamlText: string): string {
  return yamlText.replace(/^([ \t]*)(["'])\{\{user\}\}\2(\s*:)/gm, "$1{{user}}$3");
}

export interface ParsedEnvironment {
  timezone?: string;
  date?: string;
  time?: string;
  location?: string;
  temperature?: string;
  weather?: string;
}

export function parseEnvironmentYaml(rawText: string): ParsedEnvironment | null {
  if (!rawText || !rawText.trim()) return null;

  const cleaned = stripMochiReasoning(rawText);
  if (!cleaned) return null;

  // Extract <environment>...</environment> (find the last one if multiple exist)
  const allEnvMatches = Array.from(cleaned.matchAll(/<environment>([\s\S]*?)<\/environment>/gi));
  const envMatch = allEnvMatches.length > 0 ? allEnvMatches[allEnvMatches.length - 1] : null;
  const block = envMatch && envMatch[1] ? envMatch[1].trim() : cleaned.trim();

  // Try parsing with yaml parser
  try {
    const parsed = yaml.parse(block);
    if (parsed && typeof parsed === "object") {
      return {
        timezone: (parsed.timezone ?? parsed.tz)?.toString().trim(),
        date: parsed.date?.toString().trim(),
        time: parsed.time?.toString().trim(),
        location: (parsed.location ?? parsed.loc ?? parsed.city)?.toString().trim(),
        temperature: (parsed.temperature ?? parsed.temp)?.toString().trim(),
        weather: (parsed.weather ?? parsed.weather_condition ?? parsed.condition)?.toString().trim(),
      };
    }
  } catch {
    // Fall back to regex parsing
  }

  const tzMatch = block.match(/timezone:\s*["']?([^"'\n\r]+)["']?/i);
  const dateMatch = block.match(/date:\s*["']?([^"'\n\r]+)["']?/i);
  const timeMatch = block.match(/time:\s*["']?([^"'\n\r]+)["']?/i);
  const locMatch = block.match(/location:\s*["']?([^"'\n\r]+)["']?/i);
  const tempMatch = block.match(/temperature:\s*["']?([^"'\n\r]+)["']?/i);
  const wxMatch =
    block.match(/weather(?:_condition)?:\s*["']?([^"'\n\r]+)["']?/i) ||
    block.match(/condition:\s*["']?([^"'\n\r]+)["']?/i);

  if (!tzMatch && !dateMatch && !timeMatch && !locMatch && !tempMatch && !wxMatch) {
    return null;
  }

  return {
    timezone: tzMatch ? tzMatch[1].trim() : undefined,
    date: dateMatch ? dateMatch[1].trim() : undefined,
    time: timeMatch ? timeMatch[1].trim() : undefined,
    location: locMatch ? locMatch[1].trim() : undefined,
    temperature: tempMatch ? tempMatch[1].trim() : undefined,
    weather: wxMatch ? wxMatch[1].trim() : undefined,
  };
}
