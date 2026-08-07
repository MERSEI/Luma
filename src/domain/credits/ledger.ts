import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';
import type { Entitlement } from '../../generated/prisma/client.js';

export const TRIAL_SKU = 'TRIAL_100';

/** Prisma-код нарушения unique-констрейнта. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION;
}

/**
 * Начисление стартовых кредитов. Идемпотентно по ledger-ключу `trial_grant:<userId>`:
 * повторный вызов (в т.ч. при гонке двух параллельных нажатий) второй раз не начислит.
 *
 * Инвариант §3: balance и LedgerEntry пишутся в одной транзакции.
 */
export async function grantTrial(userId: string): Promise<Entitlement | null> {
  const idempotencyKey = `trial_grant:${userId}`;

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) return null;

      const entitlement = await tx.entitlement.create({
        data: {
          userId,
          sku: TRIAL_SKU,
          kind: 'trial',
          balance: env.TRIAL_MESSAGE_COUNT,
          status: 'active',
        },
      });

      await tx.ledgerEntry.create({
        data: {
          userId,
          entitlementId: entitlement.id,
          eventType: 'trial_grant',
          delta: env.TRIAL_MESSAGE_COUNT,
          idempotencyKey,
        },
      });

      return entitlement;
    });
  } catch (err) {
    // Гонка: обе транзакции не увидели записи, вторая упала на unique-ключе.
    // Это ожидаемый исход, а не ошибка — начисление уже произошло.
    if (isUniqueViolation(err)) {
      logger.debug({ userId }, 'Повторное начисление trial предотвращено идемпотентным ключом');
      return null;
    }
    throw err;
  }
}

/**
 * Суммарный доступный баланс: активные, не истёкшие entitlement'ы.
 * Отрицательные балансы (долг после возврата, §13) уменьшают сумму.
 */
export async function getBalance(userId: string): Promise<number> {
  const rows = await prisma.entitlement.findMany({
    where: {
      userId,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { balance: true },
  });
  return rows.reduce((sum, r) => sum + r.balance, 0);
}
