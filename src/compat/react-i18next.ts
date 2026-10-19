/**
 * `react-i18next` stand-in.
 *
 * The engine's components call `useTranslation()` and destructure `{ t }`. They
 * never change the language from the component tree, so the hook only has to
 * return the shared translator plus enough of the instance shape to satisfy the
 * odd `i18n.language` read.
 */
import { i18next, translate, type TFunction, type TOptions } from './i18next';

export type { TFunction, TOptions };

export interface UseTranslationResult {
  t: TFunction;
  i18n: typeof i18next;
  ready: boolean;
}

export function useTranslation(_namespace?: string | string[]): UseTranslationResult {
  return { t: translate, i18n: i18next, ready: true };
}

/** Registered by the engine's bootstrap; nothing to install here. */
export const initReactI18next = {
  type: '3rdParty' as const,
  init: () => undefined,
};

export default { useTranslation, initReactI18next };
