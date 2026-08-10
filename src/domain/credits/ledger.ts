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

/**
 * Какой entitlement спишется следующим (без мутации) — нужно знать ДО вызова Gemini,
 * чтобы выбрать GEMINI_MODEL_TRIAL/GEMINI_MODEL_PAID (pricing.md §4: модель может отличаться
 * для trial и платных сообщений). Та же сортировка, что в spendCredit.
 */
export async function peekNextEntitlementKind(userId: string): Promise<'trial' | 'purchased' | null> {
  const candidates = await prisma.entitlement.findMany({
    where: {
      userId,
      status: 'active',
      balance: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { kind: true, expiresAt: true, createdAt: true },
  });

  const [target] = candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'trial' ? -1 : 1;
    const aExpiry = a.expiresAt?.getTime() ?? Infinity;
    const bExpiry = b.expiresAt?.getTime() ?? Infinity;
    if (aExpiry !== bExpiry) return aExpiry - bExpiry;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return target?.kind ?? null;
}

/**
 * Списание 1 кредита за одно сообщение. Идемпотентно по messageId — при ретрае (например,
 * повторной обработке того же update) второй раз не спишет (аналог grantTrial).
 *
 * Порядок списания — decisions.md §4: сначала trial, затем purchased по expiresAt ASC
 * NULLS LAST, при равенстве — по createdAt ASC (сначала тратим то, что раньше сгорит).
 *
 * Возвращает false, если ни у одного entitlement нет доступного баланса — вызывающий код
 * обязан проверить getBalance() > 0 до вызова Gemini, так что это должно быть редкой гонкой,
 * а не штатным путём.
 */
export async function spendCredit(userId: string, messageId: string): Promise<boolean> {
  const idempotencyKey = `debit:${messageId}`;

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) return true;

      const candidates = await tx.entitlement.findMany({
        where: {
          userId,
          status: 'active',
          balance: { gt: 0 },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });

      const [target] = candidates.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'trial' ? -1 : 1;
        const aExpiry = a.expiresAt?.getTime() ?? Infinity;
        const bExpiry = b.expiresAt?.getTime() ?? Infinity;
        if (aExpiry !== bExpiry) return aExpiry - bExpiry;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      if (!target) return false;

      const newBalance = target.balance - 1;
      await tx.entitlement.update({
        where: { id: target.id },
        data: { balance: newBalance, status: newBalance === 0 ? 'exhausted' : target.status },
      });

      await tx.ledgerEntry.create({
        data: { userId, entitlementId: target.id, eventType: 'debit', delta: -1, idempotencyKey },
      });

      return true;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      logger.debug({ userId, messageId }, 'Повторное списание предотвращено идемпотентным ключом');
      return true;
    }
    throw err;
  }
}
