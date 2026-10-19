/**
 * The transport-independent half of the engine's i18n.
 *
 * The engine initialises `i18next` with `keySeparator: false` and
 * `nsSeparator: false`, so every catalog key is a flat literal string such as
 * `ui.chat.mochiosview.groupInfo`. That is exactly what this module serves: the
 * engine's own English catalog, looked up literally, with `{{name}}`
 * interpolation and `count` plurals — the two features the Mochi OS UI uses.
 *
 * The catalog is the engine's `localization/locales/en.json`, shipped whole so
 * every label renders exactly as it does in Dori-Engine.
 */
import catalog from '../st/en.json';

/** The engine's catalog is a flat map plus a leading `_meta` record. */
const messages: Record<string, string> = (() => {
  const source = catalog as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === '_meta') continue;
    if (typeof value === 'string') out[key] = value;
  }
  return out;
})();

export type TOptions = Record<string, unknown> | string;

function interpolate(template: string, options: Record<string, unknown> | undefined): string {
  if (!options || !template.includes('{{')) return template;
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*(?:,[^}]*)?\}\}/g, (match, name: string) => {
    const value = options[name];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

/**
 * Translate a key.
 *
 * `defaultValue` is accepted either as `t(key, "Fallback")` — the call style the
 * reused engine components use — or as `t(key, { defaultValue })`.
 */
export function translate(key: string, options?: TOptions): string {
  const defaultValue =
    typeof options === 'string' ? options : typeof options?.defaultValue === 'string' ? String(options.defaultValue) : undefined;
  const bag = options && typeof options === 'object' ? options : undefined;

  let value = messages[key];

  if (value === undefined && bag?.count !== undefined) {
    const count = Number(bag.count);
    const suffixes = count === 1 ? ['_one', '_plural'] : ['_other', '_plural'];
    for (const suffix of suffixes) {
      if (messages[key + suffix] !== undefined) {
        value = messages[key + suffix];
        break;
      }
    }
  }

  if (value === undefined) return defaultValue !== undefined ? interpolate(defaultValue, bag) : key;
  return interpolate(value, bag);
}

export type TFunction = (key: string, options?: TOptions) => string;

export const t: TFunction = translate;

/** The pieces of the `i18next` instance the engine's modules touch. */
export const i18next = {
  t: translate,
  language: 'en',
  resolvedLanguage: 'en',
  languages: ['en'],
  dir: () => 'ltr',
  exists: (key: string) => messages[key] !== undefined,
  changeLanguage: async () => 'en',
  on: () => undefined,
  off: () => undefined,
  getResource: () => undefined,
  addResourceBundle: () => undefined,
  hasResourceBundle: () => true,
  options: { keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false } },
};

export const catalogSize = Object.keys(messages).length;

export default i18next;
