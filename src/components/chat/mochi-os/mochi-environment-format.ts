import type { MochiDateFormat, MochiOsSettings } from "@mochi-os/shared";

type EnvironmentFormatSettings = Pick<MochiOsSettings, "dateFormat" | "timeFormat" | "tempUnit">;

export function formatMochiDate(date: Date, format: MochiDateFormat, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: format === "YMD" ? "2-digit" : "long",
    day: format === "YMD" ? "2-digit" : "numeric",
    timeZone,
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  if (format === "YMD") return `${part("year")}-${part("month")}-${part("day")}`;
  if (format === "DMY") return `${part("day")} ${part("month")} ${part("year")}`;
  return `${part("month")} ${part("day")}, ${part("year")}`;
}

/** Date-only ISO values are calendar dates, not UTC instants. */
export function parseMochiDate(value: string): Date | null {
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(dateOnly ? `${text}T00:00:00` : text);
  if (Number.isNaN(date.getTime())) return null;
  if (dateOnly && formatMochiDate(date, "YMD") !== text) return null;
  return date;
}

/** Update recognizable examples, retaining custom values and surrounding instructions. */
export function formatMochiEnvironmentGuide(template: string, settings: EnvironmentFormatSettings): string {
  return template
    .replace(
      /(^[ \t]*date:[^\r\n]*?#Format:[ \t]*)([A-Za-z]+[ \t]+\d{1,2},[ \t]+\d{4}|\d{1,2}[ \t]+[A-Za-z]+[ \t]+\d{4}|\d{4}-\d{2}-\d{2})\b/gm,
      (match, prefix: string, example: string) => {
        const date = parseMochiDate(example);
        return date ? `${prefix}${formatMochiDate(date, settings.dateFormat)}` : match;
      },
    )
    .replace(
      /(^[ \t]*time:[^\r\n]*?#Most recent time, Format:[ \t]*)(?:h:mm[ \t]+AM\/PM|hh:mm)\b/gm,
      (_match, prefix: string) => `${prefix}${settings.timeFormat === "12h" ? "h:mm AM/PM" : "hh:mm"}`,
    )
    .replace(
      /(^[ \t]*temperature:[^\r\n]*?#Format:[ \t]*)(-?\d+(?:\.\d+)?)[ \t]*°[CF]\b/gm,
      (_match, prefix: string, example: string) => `${prefix}${example}°${settings.tempUnit}`,
    );
}
