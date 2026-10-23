/**
 * The engine's `@marinara-engine/shared`, reduced to what the Mochi OS port uses.
 *
 * The engine's shared package is a monorepo package with its own build. The port
 * cannot depend on it, so this module stands in for the import specifier: the
 * pure utilities are the engine's own files (copied verbatim), and the types are
 * declared here.
 *
 * The types are deliberately open — an index signature plus the fields the port
 * actually reads. The engine's real interfaces carry dozens of fields belonging
 * to features the port replaces (agents, games, sprites, connections), and
 * restating them would add nothing but a chance of being wrong.
 */

export * from './avatar-crop';
// `AvatarCrop` and `LegacyAvatarCrop` live in the engine's shared types package,
// which `lib/utils.ts` and the crop helpers import by name.
export * from '../types/avatar-crop';
export * from './text-matching';
export * from './token-estimator';
export * from './character-token-estimator';
export * from './chat-persona';
export * from './macro-engine';
export * from './mochi-os.schema';

/* ------------------------------------------------------------------ *
 * Reactions
 * ------------------------------------------------------------------ */

/**
 * A reaction on a Conversation message: an emoji token plus who reacted.
 * Mirrors `MessageReaction` in the engine's `shared/src/types/chat.ts`.
 */
export interface MessageReaction {
  /** A unicode emoji (e.g. "😂") or a custom-emoji ref ":name:". */
  emoji: string;
  /** Resolved image URL for a custom-emoji reaction; null/absent for unicode. */
  imageUrl?: string | null;
  /** Who reacted: the "user" sentinel for the human, or character ids for bots. */
  by: string[];
  /** Index of the speaker segment this reaction targets, for grouped messages. */
  segment?: number | null;
  /** Speaker name of the targeted segment, captured at react time. */
  segmentAuthor?: string | null;
  [key: string]: any;
}

/* ------------------------------------------------------------------ *
 * Characters, personas, lorebooks
 * ------------------------------------------------------------------ */

export interface Character {
  id: string;
  name: string;
  comment?: string;
  avatarPath?: string | null;
  avatar?: string | null;
  avatarCrop?: AvatarCropLike;
  description?: string;
  personality?: string;
  scenario?: string;
  tags?: string[];
  data: Record<string, any>;
  [key: string]: any;
}

type AvatarCropLike = import('../types/avatar-crop').AvatarCrop;

export interface Persona {
  id: string;
  name: string;
  title?: string;
  isActive?: boolean;
  comment?: string;
  description?: string;
  personality?: string;
  backstory?: string;
  appearance?: string;
  scenario?: string;
  avatarPath?: string | null;
  avatarCrop?: AvatarCropLike;
  [key: string]: any;
}

export interface LorebookScope {
  mode: 'all' | 'disabled' | 'specific';
  chatIds: string[];
}

export interface Lorebook {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  isGlobal?: boolean;
  hiddenFromLibrary?: boolean;
  scope?: LorebookScope;
  characterId?: string | null;
  characterIds?: string[];
  personaId?: string | null;
  personaIds?: string[];
  chatId?: string | null;
  sourceAgentId?: string | null;
  entries?: LorebookEntry[];
  [key: string]: any;
}

export interface LorebookEntry {
  id: string;
  lorebookId?: string;
  keys?: string[];
  content?: string;
  enabled?: boolean;
  [key: string]: any;
}

/** The engine's `/lorebooks/scan/:chatId` payload shape. */
export interface ActiveLorebookScan {
  entries?: Array<Record<string, any>>;
  lorebookIds?: string[];
  [key: string]: any;
}

/* ------------------------------------------------------------------ *
 * Chats and messages
 * ------------------------------------------------------------------ */

export interface Chat {
  id: string;
  name: string;
  metadata?: Record<string, any> | string | null;
  characterIds?: string[];
  characterId?: string | null;
  personaId?: string | null;
  personaCharacterId?: string | null;
  groupId?: string | null;
  mode?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface Message {
  id: string;
  chatId?: string;
  role: 'system' | 'user' | 'assistant' | string;
  name?: string;
  isSystem?: boolean;
  forceAvatar?: string;
  content: string;
  characterId?: string | null;
  personaId?: string | null;
  createdAt?: string;
  activeSwipeIndex?: number;
  swipeCount?: number;
  swipes?: string[];
  extra?: Record<string, any>;
  metadata?: Record<string, any>;
  [key: string]: any;
}

/* ------------------------------------------------------------------ *
 * Prompt presets
 * ------------------------------------------------------------------ */

export interface PromptPreset {
  id: string;
  name?: string;
  description?: string;
  [key: string]: any;
}

export interface PromptGroup {
  id: string;
  [key: string]: any;
}

export interface PromptSection {
  id: string;
  [key: string]: any;
}

export interface ChoiceBlock {
  id: string;
  [key: string]: any;
}

/* ------------------------------------------------------------------ *
 * App settings and capability packages
 * ------------------------------------------------------------------ */

export interface AppSettingsResponse {
  key: string;
  value: string | null;
  [key: string]: any;
}

export interface InstalledCapabilityPackage {
  id: string;
  manifest?: { id?: string; name?: string; [key: string]: any };
  [key: string]: any;
}
