import Fastify from 'fastify';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { LumaContext } from './bot/context.js';
import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { prisma } from './db/client.js';
import { redis } from './infra/redis.js';
import { runInBackground, isDraining, activeTaskCount } from './infra/tasks.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

// Возвращаемый тип выводится: явная аннотация FastifyInstance конфликтует
// с типом инстанса pino, переданного через loggerInstance.
export function createServer(bot: Bot<LumaContext>) {
  const app = Fastify({ loggerInstance: logger });

  app.get('/health', async (_req, reply) => {
    const checks = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const db = checks[0].status === 'fulfilled';
    const cache = checks[1].status === 'fulfilled';
    const healthy = db && cache && !isDraining();

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      db,
      redis: cache,
      draining: isDraining(),
      activeTasks: activeTaskCount(),
    });
  });

  if (env.TELEGRAM_MODE === 'webhook') {
    /**
     * Решение §2: подтверждаем update немедленно и обрабатываем в фоне.
     * Штатный webhookCallback из grammY ждёт завершения обработки, что несовместимо
     * с требованием ТЗ «ack < 2 s» при генерации ответа за секунды.
     *
     * Потеря необработанного сообщения при падении процесса допустима: кредит
     * списывается только после успешного ответа, так что пользователь не платит.
     */
    app.post('/telegram/webhook', async (req, reply) => {
      if (req.headers[SECRET_HEADER] !== env.TELEGRAM_WEBHOOK_SECRET) {
        logger.warn('Webhook-запрос с неверным secret token отклонён');
        return reply.code(401).send({ ok: false });
      }

      if (isDraining()) {
        // Просим Telegram повторить позже, вместо того чтобы принять и потерять.
        return reply.code(503).send({ ok: false });
      }

      const update = req.body as Update;
      reply.code(200).send({ ok: true });

      runInBackground(`update:${update.update_id}`, async () => {
        await bot.handleUpdate(update);
      });
    });
  }

  return app;
}
