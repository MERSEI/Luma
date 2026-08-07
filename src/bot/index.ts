import { Bot, GrammyError, HttpError } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import type { LumaContext } from './context.js';
import { env } from '../config/env.js';
import { logger } from '../infra/logger.js';
import { prisma } from '../db/client.js';
import { dedupMiddleware } from './middlewares/dedup.js';
import { userMiddleware } from './middlewares/user.js';
import { consentGateMiddleware } from './middlewares/consentGate.js';
import { startComposer } from './commands/start.js';

/** Telegram отвечает 403, когда пользователь заблокировал бота. */
const FORBIDDEN = 403;

export function createBot(): Bot<LumaContext> {
  const bot = new Bot<LumaContext>(env.TELEGRAM_BOT_TOKEN);

  // Уважает retry_after при 429 (docs/decisions.md §11).
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));

  bot.use(dedupMiddleware);
  bot.use(userMiddleware);
  bot.use(consentGateMiddleware);

  bot.use(startComposer);

  bot.catch(async ({ ctx, error }) => {
    const userId = (ctx as Partial<LumaContext>).dbUser?.id;

    if (error instanceof GrammyError) {
      if (error.error_code === FORBIDDEN && userId) {
        // Бот заблокирован пользователем — прекращаем любые отправки ему.
        await prisma.user
          .update({ where: { id: userId }, data: { blockedAt: new Date() } })
          .catch(() => undefined);
        logger.info({ userId }, 'Бот заблокирован пользователем');
        return;
      }
      logger.error(
        { userId, code: error.error_code, description: error.description },
        'Ошибка Telegram API',
      );
      return;
    }

    if (error instanceof HttpError) {
      logger.error({ userId, err: error }, 'Сетевая ошибка при обращении к Telegram');
      return;
    }

    logger.error({ userId, err: error }, 'Необработанная ошибка при обработке обновления');

    // Пытаемся сообщить пользователю. dict может отсутствовать, если падение
    // произошло раньше userMiddleware.
    const dict = (ctx as Partial<LumaContext>).dict;
    if (userId && dict) {
      await ctx.reply(dict.errors.generic).catch(() => undefined);
    }
  });

  return bot;
}

export async function registerBotCommands(bot: Bot<LumaContext>): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'balance', description: 'Сколько сообщений осталось' },
    { command: 'help', description: 'Список команд' },
    { command: 'privacy', description: 'Как я обращаюсь с данными' },
  ]);
}
