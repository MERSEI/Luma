import { prisma } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { logger } from './logger.js';

/**
 * Схема аналитических событий (docs/decisions.md §14).
 * Из этой таблицы считается вся воронка — без неё метрики из ТЗ §14 недосчитываемы.
 */
export const EVENTS = {
  start: 'start',
  disclosureAccepted: 'disclosure_accepted',
  firstMessage: 'first_message',
  trial20Left: 'trial_20_left',
  trial5Left: 'trial_5_left',
  trialExhausted: 'trial_exhausted',
  shopOpened: 'shop_opened',
  invoiceCreated: 'invoice_created',
  paymentSuccess: 'payment_success',
  paymentRefunded: 'payment_refunded',
  messageSent: 'message_sent',
  llmError: 'llm_error',
  llmCost: 'llm_cost',
  moderationBlock: 'moderation_block',
  rateLimited: 'rate_limited',
  dataExported: 'data_exported',
  memoryForgotten: 'memory_forgotten',
} as const;

export type AnalyticsEventName = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * Аналитика никогда не должна ронять основной поток: ошибка записи события
 * логируется и проглатывается.
 */
export async function track(
  userId: string | null,
  event: AnalyticsEventName,
  // Тип Prisma, а не Record<string, unknown>: иначе на месте вызова понадобился
  // бы каст, который линтер считает лишним, а компилятор — обязательным.
  props: Prisma.InputJsonObject = {},
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: { userId, event, props },
    });
  } catch (err) {
    logger.warn({ err, event }, 'Не удалось записать аналитическое событие');
  }
}
