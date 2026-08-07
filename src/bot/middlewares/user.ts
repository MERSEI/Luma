import type { NextFunction } from 'grammy';
import type { LumaContext } from '../context.js';
import { prisma } from '../../db/client.js';
import { resolveLocale, t } from '../../i18n/index.js';
import { logger } from '../../infra/logger.js';

/**
 * Загружает (или заводит) пользователя и подкладывает словарь локали.
 * Обновления без `from` (посты в каналах и т.п.) пропускаются мимо обработчиков.
 */
export async function userMiddleware(ctx: LumaContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from || from.is_bot) return;

  const user = await prisma.user.upsert({
    where: { telegramUserId: BigInt(from.id) },
    create: {
      telegramUserId: BigInt(from.id),
      locale: resolveLocale(from.language_code),
    },
    update: {},
  });

  if (user.bannedAt) {
    logger.info({ userId: user.id }, 'Забаненный пользователь — обновление проигнорировано');
    return;
  }

  // Пользователь снова пишет — значит бот больше не заблокирован.
  if (user.blockedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { blockedAt: null } });
    user.blockedAt = null;
  }

  ctx.dbUser = user;
  ctx.dict = t(user.locale);

  await next();
}
