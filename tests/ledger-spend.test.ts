import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/client.js';
import { grantTrial, spendCredit, getBalance, peekNextEntitlementKind } from '../src/domain/credits/ledger.js';
import { env } from '../src/config/env.js';

async function makeUser(telegramId = 2_000_001n) {
  return prisma.user.create({ data: { telegramUserId: telegramId, locale: 'ru' } });
}

describe('списание кредита', () => {
  it('списывает 1 с trial и пишет debit-запись в ledger', async () => {
    const user = await makeUser();
    await grantTrial(user.id);

    const ok = await spendCredit(user.id, 'msg-1');

    expect(ok).toBe(true);
    expect(await getBalance(user.id)).toBe(env.TRIAL_MESSAGE_COUNT - 1);

    const entry = await prisma.ledgerEntry.findUnique({ where: { idempotencyKey: 'debit:msg-1' } });
    expect(entry?.delta).toBe(-1);
    expect(entry?.eventType).toBe('debit');
  });

  it('не списывает дважды при повторном вызове с тем же messageId', async () => {
    const user = await makeUser();
    await grantTrial(user.id);
    const before = await getBalance(user.id);

    await spendCredit(user.id, 'msg-dup');
    await spendCredit(user.id, 'msg-dup');

    expect(await getBalance(user.id)).toBe(before - 1);
    expect(await prisma.ledgerEntry.count({ where: { idempotencyKey: 'debit:msg-dup' } })).toBe(1);
  });

  it('трайл списывается раньше purchased, даже если purchased создан раньше (decisions.md §4)', async () => {
    const user = await makeUser();
    const purchased = await prisma.entitlement.create({
      data: { userId: user.id, sku: 'MSG_250', kind: 'purchased', balance: 250, status: 'active' },
    });
    await grantTrial(user.id);

    expect(await peekNextEntitlementKind(user.id)).toBe('trial');
    await spendCredit(user.id, 'msg-order-1');

    const trialEntitlement = await prisma.entitlement.findFirst({ where: { userId: user.id, kind: 'trial' } });
    const purchasedAfter = await prisma.entitlement.findUniqueOrThrow({ where: { id: purchased.id } });
    expect(trialEntitlement?.balance).toBe(env.TRIAL_MESSAGE_COUNT - 1);
    expect(purchasedAfter.balance).toBe(250);
  });

  it('между purchased раньше списывается тот, что раньше истекает', async () => {
    const user = await makeUser();
    const soon = await prisma.entitlement.create({
      data: {
        userId: user.id,
        sku: 'MSG_250',
        kind: 'purchased',
        balance: 10,
        status: 'active',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        sku: 'MSG_1000',
        kind: 'purchased',
        balance: 10,
        status: 'active',
        expiresAt: new Date(Date.now() + 7200_000),
      },
    });

    await spendCredit(user.id, 'msg-expiry-order');

    const soonAfter = await prisma.entitlement.findUniqueOrThrow({ where: { id: soon.id } });
    expect(soonAfter.balance).toBe(9);
  });

  it('выставляет status=exhausted, когда баланс entitlement доходит до нуля', async () => {
    const user = await makeUser();
    const ent = await prisma.entitlement.create({
      data: { userId: user.id, sku: 'MSG_250', kind: 'purchased', balance: 1, status: 'active' },
    });

    await spendCredit(user.id, 'msg-exhaust');

    const after = await prisma.entitlement.findUniqueOrThrow({ where: { id: ent.id } });
    expect(after.balance).toBe(0);
    expect(after.status).toBe('exhausted');
  });

  it('возвращает false, если нет entitlement с доступным балансом', async () => {
    const user = await makeUser();
    expect(await spendCredit(user.id, 'msg-no-balance')).toBe(false);
  });

  it('инвариант §3: сумма ledger сходится с балансом после нескольких списаний', async () => {
    const user = await makeUser();
    await grantTrial(user.id);

    await spendCredit(user.id, 'msg-a');
    await spendCredit(user.id, 'msg-b');
    await spendCredit(user.id, 'msg-c');

    const [ledgerSum, balance] = await Promise.all([
      prisma.ledgerEntry.aggregate({ where: { userId: user.id }, _sum: { delta: true } }),
      getBalance(user.id),
    ]);
    expect(ledgerSum._sum.delta).toBe(balance);
  });
});
