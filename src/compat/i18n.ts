/**
 * Translation shim for the ported widgets.
 *
 * The engine's components call `useTranslation()` from `react-i18next` with the
 * engine's own keys (`ui.chat.mochiPrivateChat.…`). SillyTavern's i18n has no
 * such keys, so this resolves them against the extension's shipped English
 * dictionary and, when SillyTavern itself knows a key, prefers SillyTavern's
 * translation so an extension page follows the host language.
 */
import { useCallback } from 'react';
import { EN_DICT } from './i18n-dict';
import { stTranslate } from '../st/adapter';

export type TranslateParams = Record<string, string | number | undefined>;

/** `{{name}}` interpolation, matching the i18next syntax the guides are written in. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * Last-resort rendering for a key with no dictionary entry: turn the last
 * segment into readable words. A missing key should look like untranslated UI,
 * never like a crash or a raw identifier.
 */
function humanize(key: string): string {
  const tail = key.split('.').pop() ?? key;
  const words = tail.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function translate(key: string, params?: TranslateParams): string {
  const fromHost = stTranslate(key);
  const template = fromHost ?? EN_DICT[key];
  if (template === undefined) return humanize(key);
  return interpolate(template, params);
}

export function useTranslation() {
  const t = useCallback((key: string, params?: TranslateParams) => translate(key, params), []);
  return { t, i18n: { language: 'en' }, ready: true };
}

/** SillyTavern calls this `t` as a tagged template; the widgets do too. */
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  const key = strings.join('');
  const text = EN_DICT[key] ?? key;
  if (!values.length) return text;
  return text.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => String(values[Number(index)] ?? ''));
}