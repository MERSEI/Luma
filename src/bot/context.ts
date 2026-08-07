import type { Context } from 'grammy';
import type { User } from '../generated/prisma/client.js';
import type { Dict } from '../i18n/index.js';

/**
 * Кастомный контекст. Поля заполняются middleware в порядке подключения
 * (см. src/bot/index.ts) и гарантированно присутствуют у всех обработчиков,
 * зарегистрированных после них.
 */
export type LumaContext = Context & {
  dbUser: User;
  dict: Dict;
};
