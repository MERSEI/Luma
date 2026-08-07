import { logger } from './logger.js';

/**
 * Трекер фоновых задач (docs/decisions.md §2).
 *
 * Webhook обязан ответить 200 за <2 с, а генерация ответа занимает секунды.
 * Поэтому обработка уходит в фон, а этот трекер даёт graceful shutdown
 * дождаться активных задач вместо того, чтобы оборвать их на середине.
 */
const active = new Set<Promise<void>>();

let draining = false;

export function isDraining(): boolean {
  return draining;
}

/** Запускает работу в фоне. Исключения логируются, наружу не пробрасываются. */
export function runInBackground(name: string, fn: () => Promise<void>): void {
  const task = fn()
    .catch((err: unknown) => {
      logger.error({ err, task: name }, 'Фоновая задача завершилась ошибкой');
    })
    .finally(() => {
      active.delete(task);
    });
  active.add(task);
}

export function activeTaskCount(): number {
  return active.size;
}

/** Дожидается завершения активных задач, но не дольше timeoutMs. */
export async function drainTasks(timeoutMs = 25_000): Promise<void> {
  draining = true;
  if (active.size === 0) return;

  logger.info({ count: active.size }, 'Ожидание завершения фоновых задач');

  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs).unref(),
  );
  const result = await Promise.race([Promise.allSettled([...active]), timeout]);

  if (result === 'timeout') {
    logger.warn({ remaining: active.size }, 'Часть фоновых задач не успела завершиться');
  } else {
    logger.info('Фоновые задачи завершены');
  }
}
