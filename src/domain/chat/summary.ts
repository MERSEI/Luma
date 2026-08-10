import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';
import { encrypt, tryDecrypt } from '../../infra/crypto.js';
import { logger } from '../../infra/logger.js';
import { track, EVENTS } from '../../infra/analytics.js';
import { recordCost } from '../budget/index.js';
import { summarizeText } from './geminiClient.js';

const SUMMARY_PROMPT_HEADER =
  'Сожми диалог ниже в краткую сводку для собственной памяти AI-персонажа: только факты и ' +
  'контекст, которые важно помнить дальше (кто собеседник, о чём говорили, договорённости), ' +
  'без оценок и без пересказа реплика за репликой. 3-6 предложений, обычный текст без списков.';

/**
 * decisions.md §10: пересобирается каждые CONTEXT_SUMMARY_EVERY сообщений. Не блокирует
 * ответ пользователю — вызывается через runInBackground, ошибка только логируется.
 */
export async function maybeRefreshSummary(conversationId: string): Promise<void> {
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });

  const sinceLastSummary = conversation.messageCount - conversation.summaryAtMessageNo;
  if (sinceLastSummary < env.CONTEXT_SUMMARY_EVERY) return;

  const newMessages = await prisma.message.findMany({
    where: { conversationId, status: 'ok' },
    orderBy: { createdAt: 'desc' },
    take: sinceLastSummary,
  });
  newMessages.reverse();

  const transcript = newMessages
    .map((m) => tryDecrypt(m.content))
    .filter((v): v is string => v !== null)
    .map((text, i) => `${newMessages[i]?.role === 'assistant' ? 'Персонаж' : 'Собеседник'}: ${text}`)
    .join('\n');

  if (!transcript) return;

  const previousSummary = conversation.summary ? tryDecrypt(conversation.summary) : null;
  const prompt = previousSummary
    ? `${SUMMARY_PROMPT_HEADER}\n\nПредыдущая сводка:\n${previousSummary}\n\nНовые реплики:\n${transcript}`
    : `${SUMMARY_PROMPT_HEADER}\n\n${transcript}`;

  const result = await summarizeText(env.GEMINI_MODEL_TRIAL, prompt);
  if (!result) return;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { summary: encrypt(result.text), summaryAtMessageNo: conversation.messageCount },
  });

  await recordCost(result.costUsd);
  await track(conversation.userId, EVENTS.llmCost, {
    purpose: 'summary',
    model: env.GEMINI_MODEL_TRIAL,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });

  logger.debug({ conversationId }, 'Rolling summary обновлён');
}
