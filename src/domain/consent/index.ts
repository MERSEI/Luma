import { prisma } from '../../db/client.js';
import { grantTrial } from '../credits/ledger.js';
import { track, EVENTS } from '../../infra/analytics.js';

/**
 * Версия правил. Инкрементируется при изменении текста disclosure или
 * политики приватности — согласия старых версий при этом остаются в истории.
 */
export const POLICY_VERSION = '1.0.0';

export interface AcceptResult {
  /** false, если disclosure уже был принят раньше (повторное нажатие кнопки). */
  firstTime: boolean;
}

/**
 * Принятие disclosure. Отмечает согласие, проставляет disclosureAcceptedAt
 * и начисляет стартовые кредиты (ТЗ §4.2: кредит создаётся ПОСЛЕ согласия).
 *
 * Идемпотентно: повторное нажатие не начислит второй trial — за это отвечает
 * идемпотентный ключ в grantTrial.
 */
export async function acceptDisclosure(userId: string): Promise<AcceptResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.disclosureAcceptedAt) {
    return { firstTime: false };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { disclosureAcceptedAt: new Date() },
    });
    await tx.consent.create({
      data: { userId, type: 'disclosure', policyVersion: POLICY_VERSION },
    });
  });

  await grantTrial(userId);
  await track(userId, EVENTS.disclosureAccepted, { policyVersion: POLICY_VERSION });

  return { firstTime: true };
}

export function hasAcceptedDisclosure(user: { disclosureAcceptedAt: Date | null }): boolean {
  return user.disclosureAcceptedAt !== null;
}
