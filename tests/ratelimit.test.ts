import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../src/domain/ratelimit/index.js';
import { env } from '../src/config/env.js';

describe('rate limit', () => {
  it('пропускает, пока не превышен порог per-minute', async () => {
    const userId = 'user-rl-1';
    for (let i = 0; i < env.RATE_LIMIT_PER_MINUTE; i++) {
      expect(await checkRateLimit(userId)).toBe('ok');
    }
  });

  it('блокирует по per-minute после превышения порога', async () => {
    const userId = 'user-rl-2';
    for (let i = 0; i < env.RATE_LIMIT_PER_MINUTE; i++) {
      await checkRateLimit(userId);
    }
    expect(await checkRateLimit(userId)).toBe('per_minute');
  });

  it('разные пользователи не влияют друг на друга', async () => {
    const a = 'user-rl-a';
    const b = 'user-rl-b';
    for (let i = 0; i < env.RATE_LIMIT_PER_MINUTE; i++) {
      await checkRateLimit(a);
    }
    expect(await checkRateLimit(a)).toBe('per_minute');
    expect(await checkRateLimit(b)).toBe('ok');
  });
});
