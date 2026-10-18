/**
 * Widget view-model types, ported verbatim from the engine's
 * `components/chat/mochi-os/mochi-os.types.ts`.
 *
 * The engine's `MessageReaction` lives in `@marinara-engine/shared`.
 * SillyTavern has no reactions model, so the extension carries its own
 * identical shape.
 */
export interface MessageReaction {
  emoji: string;
  count: number;
  reactors?: string[];
  [key: string]: any;
}

export type {
  MochiTheme,
  MochiColorPreset,
  MochiTimeFormat,
  MochiTempUnit,
  MochiCurrency,
  MochiCustomRgb,
  MochiHomeIndicatorMode,
  MochiPresetMode,
  MochiOsSettings,
} from "./schema";

export interface MochiMessage {
  id?: string;
  me: 0 | 1;
  type:
    | "text"
    | "voice"
    | "sticker"
    | "image"
    | "quote"
    | "link"
    | "recalled"
    | "transfer"
    | "transfer-accepted"
    | "transfer-rejected"
    | "news"
    | string;
  text?: string;
  t?: string;
  d?: string;
  dur?: string;
  rawType?: string;
  /**
   * Author of a group-chat message, from the record's `sender: { name }` block.
   * Absent in a private chat, whose reader is always the single contact.
   */
  sender?: string;
  rawItem?: Record<string, any>;
  reactions?: MessageReaction[];
  swipes?: string[];
  activeSwipeIndex?: number;
}

export interface MochiContact {
  name: string;
  color: string;
  online: boolean;
  story: boolean;
  unread: number;
  started: string;
  preview: string;
  msgs: MochiMessage[];
}

export interface MochiContactsMap {
  [key: string]: MochiContact;
}

export type MochiMessagesTab = "chats" | "calls" | "people" | "profile";
export type MochiSettingsTab = "appearance" | "preset" | "format_guides" | "about";

export interface MochiCallItem {
  n: string;
  c: string;
  type: "Outgoing" | "Incoming" | "Missed";
  date: string;
  t: string;
  missed: boolean;
  video: boolean;
}

export interface MochiPersonItem {
  n: string;
  c: string;
  favorite?: boolean;
}
