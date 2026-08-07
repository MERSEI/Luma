import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { createBot, registerBotCommands } from './bot/index.js';
import { createServer } from './server.js';
import { disconnectDb } from './db/client.js';
import { disconnectRedis } from './infra/redis.js';
import { drainTasks } from './infra/tasks.js';
import { cleanupProcessedUpdates } from './bot/middlewares/dedup.js';

const CLEANUP_INTERVAL_MS = 3_600_000; // раз в час

async function main(): Promise<void> {
  const bot = createBot();
  const app = createServer(bot);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, mode: env.TELEGRAM_MODE }, 'HTTP-сервер запущен');

  await registerBotCommands(bot);

  if (env.TELEGRAM_MODE === 'webhook') {
    const url = `${env.TELEGRAM_WEBHOOK_URL}/telegram/webhook`;
    await bot.api.setWebhook(url, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET as string,
      drop_pending_updates: false,
    });
    logger.info({ url }, 'Webhook зарегистрирован');
  } else {
    // Локальная разработка: long polling, публичный HTTPS и ngrok не нужны.
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    void bot.start({
      onStart: (info) => logger.info({ username: info.username }, 'Polling запущен'),
    });
  }

  const cleanup = setInterval(() => {
    cleanupProcessedUpdates()
      .then((count) => {
        if (count > 0) logger.debug({ count }, 'Очищены старые processed_updates');
      })
      .catch((err: unknown) => logger.warn({ err }, 'Не удалось очистить processed_updates'));
  }, CLEANUP_INTERVAL_MS);
  cleanup.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Останавливаюсь');

    clearInterval(cleanup);
    try {
      if (env.TELEGRAM_MODE === 'polling') await bot.stop();
      // Сначала перестаём принимать новые updates, потом дожидаемся активных.
      await app.close();
      await drainTasks();
      await disconnectRedis();
      await disconnectDb();
      logger.info('Остановлен корректно');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Ошибка при остановке');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Не удалось запуститься');
  process.exit(1);
});
