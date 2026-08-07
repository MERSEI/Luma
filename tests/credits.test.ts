import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/client.js';
import { grantTrial, getBalance, TRIAL_SKU } from '../src/domain/credits/ledger.js';
import { acceptDisclosure } from '../src/domain/consent/index.js';
import { env } from '../src/config/env.js';

async function makeUser(telegramId = 1_000_001n) {
  return prisma.user.create({ data: { telegramUserId: telegramId, locale: 'ru' } });
}

describe('начисление trial-кредитов', () => {
  it('начисляет ровно TRIAL_MESSAGE_COUNT и пишет ledger', async () => {
    const user = await makeUser();
    const ent = await grantTrial(user.id);

    expect(ent).not.toBeNull();
    expect(ent?.balance).toBe(env.TRIAL_MESSAGE_COUNT);
    expect(ent?.kind).toBe('trial');
    expect(ent?.sku).toBe(TRIAL_SKU);

    const entries = await prisma.ledgerEntry.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.delta).toBe(env.TRIAL_MESSAGE_COUNT);
    expect(entries[0]?.eventType).toBe('trial_grant');
  });

  it('не начисляет второй раз при повторном вызове', async () => {
    const user = await makeUser();
    await grantTrial(user.id);
    const second = await grantTrial(user.id);

    expect(second).toBeNull();
    expect(await getBalance(user.id)).toBe(env.TRIAL_MESSAGE_COUNT);
    expect(await prisma.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it('не начисляет дважды при гонке параллельных вызовов', async () => {
    // Реальный сценарий: юзер дважды быстро нажал «Продолжить».
    const user = await makeUser();
    const results = await Promise.all([
      grantTrial(user.id),
      grantTrial(user.id),
      grantTrial(user.id),
    ]);

    const granted = results.filter((r) => r !== null);
    expect(granted).toHaveLength(1);
    expect(await getBalance(user.id)).toBe(env.TRIAL_MESSAGE_COUNT);
    expect(await prisma.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it('баланс сходится с суммой ledger (инвариант §3)', async () => {
    const user = await makeUser();
    await grantTrial(user.id);

    const [ledgerSum, balance] = await Promise.all([
      prisma.ledgerEntry.aggregate({ where: { userId: user.id }, _sum: { delta: true } }),
      getBalance(user.id),
    ]);
    expect(ledgerSum._sum.delta).toBe(balance);
  });

  it('не учитывает истёкшие entitlement в балансе', async () => {
    const user = await makeUser();
    await grantTrial(user.id);
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        sku: 'MSG_250',
        kind: 'purchased',
        balance: 250,
        status: 'active',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    expect(await getBalance(user.id)).toBe(env.TRIAL_MESSAGE_COUNT);
  });
});

describe('принятие disclosure', () => {
  it('проставляет согласие и начисляет trial', async () => {
    const user = await makeUser();
    const result = await acceptDisclosure(user.id);

    expect(result.firstTime).toBe(true);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.disclosureAcceptedAt).not.toBeNull();

    const consents = await prisma.consent.findMany({ where: { userId: user.id } });
    expect(consents).toHaveLength(1);
    expect(consents[0]?.type).toBe('disclosure');

    expect(await getBalance(user.id)).toBe(env.TRIAL_MESSAGE_COUNT);
  });

  it('повторное принятие не начисляет второй trial', async () => {
    const user = await makeUser();
    await acceptDisclosure(user.id);
    const second = await acceptDisclosure(user.id);

    expect(second.firstTime).toBe(false);
    expect(await getBalance(user.id)).toBe(env.TRIAL_MESSAGE_COUNT);
    expect(await prisma.consent.count({ where: { userId: user.id } })).toBe(1);
  });
});
