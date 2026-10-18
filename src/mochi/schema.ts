/**
 * Mochi OS settings schema, ported from the engine's shared package
 * (`packages/shared/src/schemas/mochi-os.schema.ts`).
 *
 * The engine validates with zod. An extension cannot take a zod dependency, so
 * the shape is described by a field table and `normalizeMochiOsSettings` applies
 * it field by field. Every rule the zod version enforced is preserved: unknown
 * keys are dropped, a wrong type falls back to the field default, and `NaN` is
 * treated as missing so a hand-edited settings blob can never poison the UI.
 */

export type MochiTheme = "auto" | "light" | "dark";
export type MochiColorPreset = "" | "ocean" | "plum" | "peach" | "custom";
export type MochiTimeFormat = "12h" | "24h";
export type MochiTempUnit = "C" | "F";
export type MochiCurrency = "$" | "¥" | "€" | "£" | "₩" | "₹" | "₽" | "R$" | "₫" | "A$" | "C$" | "kr";
export type MochiHomeIndicatorMode = "click" | "drag" | "both";
export type MochiPresetMode = "default" | "engine" | "custom";

export interface MochiCustomRgb {
  r: number;
  g: number;
  b: number;
}

export interface MochiOsSettings {
  theme: MochiTheme;
  colorPreset: MochiColorPreset;
  customRgb: MochiCustomRgb;
  timeFormat: MochiTimeFormat;
  tempUnit: MochiTempUnit;
  currency: MochiCurrency;
  clockMode: "tz" | "custom";
  clockTz: string;
  clockOffset: number;
  clockAiDecide: boolean;
  aiDecidedDate: string;
  aiDecidedTime: string;
  wxTemp: number;
  wxCondition: string;
  wxPlace: string;
  wxAiDecide: boolean;
  linkedPersonaId: string | null;
  homeIndicatorMode: MochiHomeIndicatorMode;
  promptPresetMode: MochiPresetMode;
  selectedEnginePresetId: string | null;
  customPresetJson: string;
  formatGuidesJson: string;
}

export const MOCHI_OS_SETTINGS_KEY = "mochi-os-settings";

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

const THEMES: MochiTheme[] = ["auto", "light", "dark"];
const COLOR_PRESETS: MochiColorPreset[] = ["", "ocean", "plum", "peach", "custom"];
const TIME_FORMATS: MochiTimeFormat[] = ["12h", "24h"];
const TEMP_UNITS: MochiTempUnit[] = ["C", "F"];
const CURRENCIES: MochiCurrency[] = ["$", "¥", "€", "£", "₩", "₹", "₽", "R$", "₫", "A$", "C$", "kr"];
const HOME_INDICATOR_MODES: MochiHomeIndicatorMode[] = ["click", "drag", "both"];
const PRESET_MODES: MochiPresetMode[] = ["default", "engine", "custom"];

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clampByte(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Coerce any stored value into a complete, valid settings object.
 *
 * Accepts an object or a JSON string, because the engine stored the settings
 * blob as a serialized string and an extension may inherit one through a copied
 * `extension_settings` block.
 */
export function normalizeMochiOsSettings(value: unknown): MochiOsSettings {
  if (!value) return { ...DEFAULT_MOCHI_OS_SETTINGS };

  let source: unknown = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return { ...DEFAULT_MOCHI_OS_SETTINGS };
    }
  }
  if (typeof source !== "object" || source === null) return { ...DEFAULT_MOCHI_OS_SETTINGS };

  const raw = source as Record<string, unknown>;
  const rawRgb = (raw.customRgb ?? {}) as Record<string, unknown>;
  const defaults = DEFAULT_MOCHI_OS_SETTINGS;

  return {
    theme: pickEnum(raw.theme, THEMES, defaults.theme),
    colorPreset: pickEnum(raw.colorPreset, COLOR_PRESETS, defaults.colorPreset),
    customRgb: {
      r: clampByte(rawRgb.r, defaults.customRgb.r),
      g: clampByte(rawRgb.g, defaults.customRgb.g),
      b: clampByte(rawRgb.b, defaults.customRgb.b),
    },
    timeFormat: pickEnum(raw.timeFormat, TIME_FORMATS, defaults.timeFormat),
    tempUnit: pickEnum(raw.tempUnit, TEMP_UNITS, defaults.tempUnit),
    currency: pickEnum(raw.currency, CURRENCIES, defaults.currency),
    clockMode: pickEnum(raw.clockMode, ["tz", "custom"] as const, defaults.clockMode),
    clockTz: pickString(raw.clockTz, defaults.clockTz),
    clockOffset: pickNumber(raw.clockOffset, defaults.clockOffset),
    clockAiDecide: pickBoolean(raw.clockAiDecide, defaults.clockAiDecide),
    aiDecidedDate: pickString(raw.aiDecidedDate, defaults.aiDecidedDate),
    aiDecidedTime: pickString(raw.aiDecidedTime, defaults.aiDecidedTime),
    wxTemp: pickNumber(raw.wxTemp, defaults.wxTemp),
    wxCondition: pickString(raw.wxCondition, defaults.wxCondition),
    wxPlace: pickString(raw.wxPlace, defaults.wxPlace),
    wxAiDecide: pickBoolean(raw.wxAiDecide, defaults.wxAiDecide),
    linkedPersonaId: pickNullableString(raw.linkedPersonaId),
    homeIndicatorMode: pickEnum(raw.homeIndicatorMode, HOME_INDICATOR_MODES, defaults.homeIndicatorMode),
    promptPresetMode: pickEnum(raw.promptPresetMode, PRESET_MODES, defaults.promptPresetMode),
    selectedEnginePresetId: pickNullableString(raw.selectedEnginePresetId),
    customPresetJson: pickString(raw.customPresetJson, defaults.customPresetJson),
    formatGuidesJson: pickString(raw.formatGuidesJson, defaults.formatGuidesJson),
  };
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