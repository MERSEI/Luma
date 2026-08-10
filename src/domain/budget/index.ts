import { redis } from '../../infra/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';

/**
 * Глобальный дневной бюджет (decisions.md §1, pricing.md §5). Агрегат по календарному
 * дню UTC в Redis — простой счётчик, не источник истины (та же роль, что у rate limit):
 * источник истины по фактической стоимости — analytics_events (llm_cost), это же
 * предохранитель на лету.
 */
function todayKey(): string {
  return `budget:usd:${new Date().toISOString().slice(0, 10)}`;
}

export async function isBudgetExceeded(): Promise<boolean> {
  if (env.KILL_SWITCH) return true;

  const raw = await redis.get(todayKey());
  const spent = raw ? Number(raw) : 0;
  return spent >= env.DAILY_BUDGET_USD;
}

export async function recordCost(usd: number): Promise<void> {
  if (usd <= 0) return;
  try {
    const key = todayKey();
    await redis.incrbyfloat(key, usd);
    await redis.expire(key, 172_800); // 2 суток — с запасом на пересечение UTC-полуночи
  } catch (err) {
    logger.warn({ err }, 'Не удалось записать стоимость в дневной бюджет');
  }
}
