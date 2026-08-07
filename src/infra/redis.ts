import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Ошибка соединения с Redis');
});

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}

/**
 * Per-user лок (docs/decisions.md §6): сообщения одного пользователя
 * обрабатываются строго последовательно. Без него пять быстрых сообщений
 * подряд дают пять параллельных вызовов LLM и гонку на списании кредита.
 */
export interface LockOptions {
  /** Сколько лок живёт, если процесс умрёт не сняв его. */
  ttlMs?: number;
  /** Сколько ждать освобождения перед тем, как сдаться. */
  waitMs?: number;
}

export interface AcquiredLock {
  release(): Promise<void>;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export async function acquireLock(
  key: string,
  { ttlMs = 30_000, waitMs = 20_000 }: LockOptions = {},
): Promise<AcquiredLock | null> {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + waitMs;
  let delay = 50;

  for (;;) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') {
      return {
        async release() {
          // Снимаем только свой лок: чужой мог быть взят после истечения нашего TTL.
          await redis.eval(RELEASE_SCRIPT, 1, key, token);
        },
      };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 1_000);
  }
}

/** Счётчик с TTL. Возвращает значение после инкремента. Используется для rate limit и бюджета. */
export async function incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
  const results = await redis.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
  const value = results?.[0]?.[1];
  return typeof value === 'number' ? value : Number(value ?? 0);
}
