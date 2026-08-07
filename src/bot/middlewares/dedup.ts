import type { NextFunction } from 'grammy';
import type { LumaContext } from '../context.js';
import { prisma } from '../../db/client.js';
import { logger } from '../../infra/logger.js';

const UNIQUE_VIOLATION = 'P2002';

/**
 * Дедупликация Telegram updates (docs/decisions.md §5).
 *
 * Источник истины — таблица processed_updates, а не Redis: Redis не переживает
 * рестарт и eviction, и дубликат прошёл бы дальше, приведя к двойному списанию.
 *
 * Компромисс: update помечается обработанным ДО обработки. Если обработка упадёт,
 * повтора не будет. Это сознательный выбор — двойное списание кредита хуже, чем
 * потерянный ответ, тем более что кредит списывается только после успеха.
 */
export async function dedupMiddleware(ctx: LumaContext, next: NextFunction): Promise<void> {
  const updateId = BigInt(ctx.update.update_id);

  try {
    await prisma.processedUpdate.create({ data: { updateId } });
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION) {
      logger.info({ updateId: updateId.toString() }, 'Дубликат update — пропущен');
      return;
    }
    throw err;
  }

  await next();
}

/** Чистка старых записей. Вызывается по расписанию из src/index.ts. */
export async function cleanupProcessedUpdates(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const { count } = await prisma.processedUpdate.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
