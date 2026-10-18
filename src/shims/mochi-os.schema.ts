import { z } from "zod";

export const MOCHI_OS_SETTINGS_KEY = "mochi-os-settings";

export const MochiThemeSchema = z.enum(["auto", "light", "dark"]);
export const MochiColorPresetSchema = z.enum(["", "ocean", "plum", "peach", "custom"]);
export const MochiTimeFormatSchema = z.enum(["12h", "24h"]);
export const MochiTempUnitSchema = z.enum(["C", "F"]);

/**
 * Currency symbols offered for transfer amounts. The amount itself is stored
 * and archived as a bare number; the symbol is a display preference applied when
 * a transfer card renders.
 */
export const MochiCurrencySchema = z.enum(["$", "¥", "€", "£", "₩", "₹", "₽", "R$", "₫", "A$", "C$", "kr"]);

export const MochiCustomRgbSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});

export const MochiHomeIndicatorModeSchema = z.enum(["click", "drag", "both"]);
export const MochiPresetModeSchema = z.enum(["default", "engine", "custom"]);

export const MochiOsSettingsSchema = z.object({
  theme: MochiThemeSchema.default("auto"),
  colorPreset: MochiColorPresetSchema.default(""),
  customRgb: MochiCustomRgbSchema.default({ r: 127, g: 160, b: 97 }),
  timeFormat: MochiTimeFormatSchema.default("24h"),
  tempUnit: MochiTempUnitSchema.default("C"),
  currency: MochiCurrencySchema.default("$"),
  clockMode: z.enum(["tz", "custom"]).default("tz"),
  clockTz: z.string().default("UTC"),
  clockOffset: z.number().default(0),
  clockAiDecide: z.boolean().default(false),
  aiDecidedDate: z.string().default(""),
  aiDecidedTime: z.string().default(""),
  wxTemp: z.number().default(20),
  wxCondition: z.string().default("Sunny"),
  wxPlace: z.string().default(""),
  wxAiDecide: z.boolean().default(false),
  linkedPersonaId: z.string().nullable().default(null),
  homeIndicatorMode: MochiHomeIndicatorModeSchema.default("both"),
  promptPresetMode: MochiPresetModeSchema.default("default"),
  selectedEnginePresetId: z.string().nullable().default(null),
  customPresetJson: z.string().default(""),
  formatGuidesJson: z.string().default(""),
});

export type MochiTheme = z.infer<typeof MochiThemeSchema>;
export type MochiColorPreset = z.infer<typeof MochiColorPresetSchema>;
export type MochiTimeFormat = z.infer<typeof MochiTimeFormatSchema>;
export type MochiTempUnit = z.infer<typeof MochiTempUnitSchema>;
export type MochiCurrency = z.infer<typeof MochiCurrencySchema>;
export type MochiCustomRgb = z.infer<typeof MochiCustomRgbSchema>;
export type MochiHomeIndicatorMode = z.infer<typeof MochiHomeIndicatorModeSchema>;
export type MochiPresetMode = z.infer<typeof MochiPresetModeSchema>;
export type MochiOsSettings = z.infer<typeof MochiOsSettingsSchema>;

export const DEFAULT_MOCHI_OS_SETTINGS: MochiOsSettings = {
  theme: "auto",
  colorPreset: "",
  customRgb: { r: 127, g: 160, b: 97 },
  timeFormat: "24h",
  tempUnit: "C",
  currency: "$",
  clockMode: "tz",
  clockTz: "UTC",
  clockOffset: 0,
  clockAiDecide: false,
  aiDecidedDate: "",
  aiDecidedTime: "",
  wxTemp: 20,
  wxCondition: "Sunny",
  wxPlace: "",
  wxAiDecide: false,
  linkedPersonaId: null,
  homeIndicatorMode: "both",
  promptPresetMode: "default",
  selectedEnginePresetId: null,
  customPresetJson: "",
  formatGuidesJson: "",
};

export function normalizeMochiOsSettings(value: unknown): MochiOsSettings {
  if (!value) return DEFAULT_MOCHI_OS_SETTINGS;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return MochiOsSettingsSchema.parse(parsed);
    } catch {
      return DEFAULT_MOCHI_OS_SETTINGS;
    }
  }
  if (typeof value === "object") {
    const result = MochiOsSettingsSchema.safeParse(value);
    if (result.success) return result.data;
  }
  return DEFAULT_MOCHI_OS_SETTINGS;
}

export interface MochiOsUserData {
  id?: string;
  nickname?: string;
  bio?: string;
  avatar?: string;
  email?: string;
  [key: string]: any;
}

export interface MochiOsCharacterData {
  id?: string;
  name?: string;
  contactname?: string;
  nickname?: string;
  bio?: string;
  email?: string;
  onlinestyle?: string;
  online_style?: string;
  onlineStyle?: string;
  avatar?: string;
  [key: string]: any;
}

export interface MochiOsGroupData {
  id?: string;
  name?: string;
  main_members?: string[] | string;
  mainMembers?: string[] | string;
  other_members?: string[] | string;
  otherMembers?: string[] | string;
  description?: string;
  avatar?: string;
  [key: string]: any;
}

export interface MochiOsPhoneData {
  user?: MochiOsUserData;
  characters?: MochiOsCharacterData[];
  groups?: MochiOsGroupData[];
  private_contacts?: MochiOsCharacterData[];
  [key: string]: any;
}

export interface MochiOsPhoneDataResponse {
  phoneData: MochiOsPhoneData | null;
  rawYaml: string | null;
  /**
   * `rawYaml` reduced to the canonical Mochi OS log format (the record's own tag
   * blocks, with file headers and reasoning traces stripped). `null` means no
   * YAML file exists for this chat/category. Only resolved for `private_chats`,
   * which is the category the roleplay Mochi OS log bubble reads from.
   */
  logYaml?: string | null;
}
