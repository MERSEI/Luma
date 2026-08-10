import { incrWithTtl } from '../../infra/redis.js';
import { env } from '../../config/env.js';

export type RateLimitResult = 'ok' | 'per_minute' | 'per_day';

/** decisions.md §1/pricing.md §5: 20 запросов/мин и 300/сутки на юзера. */
export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  const perMinute = await incrWithTtl(`ratelimit:min:${userId}`, 60);
  if (perMinute > env.RATE_LIMIT_PER_MINUTE) return 'per_minute';

  const perDay = await incrWithTtl(`ratelimit:day:${userId}`, 86_400);
  if (perDay > env.RATE_LIMIT_PER_DAY) return 'per_day';

  return 'ok';
}
