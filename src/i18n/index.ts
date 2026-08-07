import { ru, type Dict } from './ru.js';
import { en } from './en.js';

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const DICTS: Record<Locale, Dict> = { ru, en };

export const DEFAULT_LOCALE: Locale = 'ru';

export function isSupportedLocale(value: string | undefined): value is Locale {
  return value !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Telegram отдаёт language_code вида "ru", "en-US". Берём основной субтег. */
export function resolveLocale(languageCode: string | undefined): Locale {
  const primary = languageCode?.split('-')[0]?.toLowerCase();
  return isSupportedLocale(primary) ? primary : DEFAULT_LOCALE;
}

export function t(locale: string): Dict {
  return isSupportedLocale(locale) ? DICTS[locale] : DICTS[DEFAULT_LOCALE];
}

export type { Dict };
