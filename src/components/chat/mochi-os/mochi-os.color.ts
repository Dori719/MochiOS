export interface MochiHsl {
  h: number;
  s: number;
  l: number;
}

export type MochiCustomThemeMode = "light" | "dark";
export type MochiCustomTokens = Record<string, string>;

const HEX_PATTERN = /^#?([\da-f]{6})$/i;
const SHORT_HEX_PATTERN = /^#?([\da-f]{3})$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  const short = SHORT_HEX_PATTERN.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const full = HEX_PATTERN.exec(trimmed);
  return full ? `#${full[1]}`.toUpperCase() : null;
}

export function hexToHsl(hex: string): MochiHsl {
  const normalized = normalizeHexColor(hex) ?? "#7FA061";
  const r = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const g = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const b = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToHex({ h, s, l }: MochiHsl): string {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const rgb = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][sector].map((value) => value + offset);
  return `#${rgb
    .map((value) =>
      Math.round(clamp(value, 0, 1) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 100)}%)`;
}

function hsla(h: number, s: number, l: number, alpha: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 100)}% / ${alpha})`;
}

/** Derive every Mochi surface token from the picked hue at preset-like steps. */
export function buildMochiCustomTokens(hex: string, mode: MochiCustomThemeMode): MochiCustomTokens {
  const { h, s, l } = hexToHsl(hex);
  // ponytail: cap vivid picks to the saturation range of the built-in palettes;
  // remove this clamp only if unrestricted neon themes are explicitly desired.
  const accentSaturation = clamp(s * 0.85, 0.2, 0.7);
  const surfaceSaturation = clamp(s * 0.9, 0.12, 0.85);
  const accentLightness = mode === "dark" ? clamp(l, 0.5, 0.68) : clamp(l, 0.42, 0.62);
  const shared = {
    "--acc": hsl(h, accentSaturation, accentLightness),
    "--acc-soft": hsl(h, accentSaturation * 0.5, mode === "dark" ? 0.22 : 0.94),
    "--bubble-line": hsl(h, accentSaturation * 0.6, mode === "dark" ? 0.28 : 0.94),
    "--dock-bg": hsla(h, accentSaturation, mode === "dark" ? 0.22 : 0.66, 0.55),
  };

  if (mode === "dark") {
    return {
      ...shared,
      "--screen": hsl(h, surfaceSaturation * 0.7, 0.18),
      "--tile-a": hsl(h, accentSaturation, 0.35),
      "--tile-b": hsl(h, accentSaturation, 0.28),
      "--ink": hsl(h, accentSaturation * 0.9, 0.92),
      "--paper": hsl(h, surfaceSaturation * 0.6, 0.15),
      "--paper-dim": hsl(h, surfaceSaturation * 0.7, 0.21),
      "--line": hsl(h, accentSaturation * 0.7, 0.28),
      "--text": hsl(h, accentSaturation * 0.75, 0.93),
      "--muted": hsl(h, accentSaturation * 0.45, 0.6),
      "--chat-bg": hsl(h, surfaceSaturation * 0.6, 0.13),
      "--chat-bubble-in": hsl(h, surfaceSaturation * 0.6, 0.18),
      "--chat-item-bg": hsl(h, surfaceSaturation * 0.6, 0.15),
      "--modal-bg": hsl(h, surfaceSaturation * 0.6, 0.15),
      "--nav-bg": hsl(h, surfaceSaturation * 0.6, 0.15),
      "--input-bg": hsl(h, surfaceSaturation * 0.7, 0.21),
    };
  }

  return {
    ...shared,
    "--screen": hsl(h, surfaceSaturation, 0.91),
    "--tile-a": hsl(h, accentSaturation, 0.69),
    "--tile-b": hsl(h, accentSaturation, 0.6),
    "--ink": "#FFFFFF",
    "--paper": hsl(h, surfaceSaturation * 0.8, 0.96),
    "--paper-dim": hsl(h, surfaceSaturation * 0.85, 0.92),
    "--line": hsl(h, accentSaturation * 0.9, 0.85),
    "--text": hsl(h, accentSaturation * 0.5, 0.22),
    "--muted": hsl(h, accentSaturation * 0.55, 0.5),
    "--chat-bg": hsl(h, surfaceSaturation * 0.5, 0.97),
    "--chat-bubble-in": "#FFFFFF",
    "--chat-item-bg": "#FFFFFF",
    "--modal-bg": "#FFFFFF",
    "--nav-bg": "#FFFFFF",
    "--input-bg": hsl(h, accentSaturation * 0.6, 0.94),
  };
}

export function resolveMochiCustomAccent(hex: string, mode: MochiCustomThemeMode): string {
  return buildMochiCustomTokens(hex, mode)["--acc"];
}
