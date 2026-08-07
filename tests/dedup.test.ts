import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { dedupMiddleware, cleanupProcessedUpdates } from '../src/bot/middlewares/dedup.js';
import type { LumaContext } from '../src/bot/context.js';

function ctxWithUpdate(updateId: number): LumaContext {
  return { update: { update_id: updateId } } as unknown as LumaContext;
}

describe('дедупликация Telegram updates', () => {
  it('пропускает первый update дальше по цепочке', async () => {
    const next = vi.fn(async () => undefined);
    await dedupMiddleware(ctxWithUpdate(555), next);

    expect(next).toHaveBeenCalledOnce();
    expect(await prisma.processedUpdate.count()).toBe(1);
  });

  it('не пропускает тот же update во второй раз', async () => {
    // Telegram повторяет доставку, если не получил 200 вовремя.
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);

    await dedupMiddleware(ctxWithUpdate(777), first);
    await dedupMiddleware(ctxWithUpdate(777), second);

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(await prisma.processedUpdate.count()).toBe(1);
  });

  it('обрабатывает ровно один раз при одновременной доставке дубликата', async () => {
    const next = vi.fn(async () => undefined);
    await Promise.all([
      dedupMiddleware(ctxWithUpdate(888), next),
      dedupMiddleware(ctxWithUpdate(888), next),
      dedupMiddleware(ctxWithUpdate(888), next),
    ]);

    expect(next).toHaveBeenCalledOnce();
    expect(await prisma.processedUpdate.count()).toBe(1);
  });

  it('разные update_id обрабатываются независимо', async () => {
    const next = vi.fn(async () => undefined);
    await dedupMiddleware(ctxWithUpdate(1), next);
    await dedupMiddleware(ctxWithUpdate(2), next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(await prisma.processedUpdate.count()).toBe(2);
  });

  it('чистка удаляет только записи старше порога', async () => {
    await prisma.processedUpdate.create({
      data: { updateId: 100n, createdAt: new Date(Date.now() - 48 * 3_600_000) },
    });
    await prisma.processedUpdate.create({ data: { updateId: 101n } });

    const removed = await cleanupProcessedUpdates(24);

    expect(removed).toBe(1);
    const left = await prisma.processedUpdate.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]?.updateId).toBe(101n);
  });
});
