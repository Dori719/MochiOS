export * from "./mochi-os.schema";

export interface MessageReaction {
  emoji: string;
  by: string[];
  imageUrl?: string;
  segment?: number;
  segmentSpeaker?: string | null;
}

export interface CharacterData {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  tags?: string[];
  creator?: string;
  character_version?: string;
  alternate_greetings?: string[];
  extensions?: Record<string, any>;
  character_book?: any;
  [key: string]: any;
}

export interface Character {
  id: string;
  data: CharacterData | string;
  comment?: string | null;
  avatarPath?: string | null;
  spriteFolderPath?: string | null;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export interface MessageExtra {
  reactions?: MessageReaction[];
  swipes?: string[];
  [key: string]: any;
}

export interface Message {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant";
  characterId?: string | null;
  content: string;
  activeSwipeIndex?: number;
  swipeCount?: number;
  swipes?: string[];
  rowid?: number;
  createdAt?: string | number;
  extra?: MessageExtra | string | null;
}

export function normalizeTextForMatch(text: string): string {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}
