import { Composer } from 'grammy';
import type { LumaContext } from '../context.js';
import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';
import { acquireLock } from '../../infra/redis.js';
import { encrypt } from '../../infra/crypto.js';
import { runInBackground } from '../../infra/tasks.js';
import { track, EVENTS } from '../../infra/analytics.js';
import { isBudgetExceeded, recordCost } from '../../domain/budget/index.js';
import { checkRateLimit } from '../../domain/ratelimit/index.js';
import { getBalance, spendCredit, peekNextEntitlementKind } from '../../domain/credits/ledger.js';
import { buildContext } from '../../domain/chat/contextBuilder.js';
import { generateReply } from '../../domain/chat/geminiClient.js';
import { maybeRefreshSummary } from '../../domain/chat/summary.js';
import { resolveLocale } from '../../i18n/index.js';

export const chatComposer = new Composer<LumaContext>();

/** decisions.md §14: уведомляем ровно на этих порогах, не на каждом сообщении с низким остатком. */
const LOW_BALANCE_THRESHOLDS = new Set([20, 5]);

export async function handleChatMessage(ctx: LumaContext & { message: { text: string } }): Promise<void> {
  const text = ctx.message.text;
  if (text.startsWith('/')) {
    await ctx.reply(ctx.dict.commands.help);
    return;
  }

  const userId = ctx.dbUser.id;

  // decisions.md §6: сообщения одного юзера — строго последовательно.
  const lock = await acquireLock(`lock:user:${userId}`);
  if (!lock) {
    await ctx.reply(ctx.dict.errors.rateLimited);
    return;
  }

  try {
    if (await isBudgetExceeded()) {
      logger.warn({ userId }, 'Сообщение отклонено: kill switch/дневной бюджет исчерпан');
      await ctx.reply(ctx.dict.errors.killSwitch);
      return;
    }

    const rate = await checkRateLimit(userId);
    if (rate !== 'ok') {
      await track(userId, EVENTS.rateLimited, { scope: rate });
      await ctx.reply(rate === 'per_minute' ? ctx.dict.errors.rateLimited : ctx.dict.errors.dailyLimit);
      return;
    }

    const balanceBefore = await getBalance(userId);
    if (balanceBefore <= 0) {
      await track(userId, EVENTS.trialExhausted);
      await ctx.reply(ctx.dict.trial.exhausted);
      return;
    }

    await ctx.replyWithChatAction('typing');

    const { conversation, systemInstruction, historyContents } = await buildContext(
      userId,
      resolveLocale(ctx.dbUser.locale),
    );
    const isFirstMessage = conversation.messageCount === 0;

    const userMessage = await prisma.message.create({
      data: { conversationId: conversation.id, role: 'user', content: encrypt(text), status: 'ok' },
    });

    const model =
      (await peekNextEntitlementKind(userId)) === 'purchased' ? env.GEMINI_MODEL_PAID : env.GEMINI_MODEL_TRIAL;

    const result = await generateReply({
      model,
      systemInstruction,
      contents: [...historyContents, { role: 'user', parts: [{ text }] }],
    });

    if (result.status === 'failed') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { messageCount: { increment: 1 }, updatedAt: new Date() },
      });
      await track(userId, EVENTS.llmError, { model });
      await ctx.reply(ctx.dict.errors.llmUnavailable);
      return;
    }

    if (result.status === 'refused') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { messageCount: { increment: 1 }, updatedAt: new Date() },
      });
      await prisma.moderationEvent.create({
        data: { userId, direction: 'output', category: 'safety_block', action: 'block', messageId: userMessage.id },
      });
      await recordCost(result.costUsd);
      await track(userId, EVENTS.moderationBlock, { model, stage: 'output' });
      await ctx.reply(ctx.dict.errors.blocked);
      return;
    }

    // result.status === 'ok': успешный ход, кредит списывается, даже если это отказ в характере.
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: encrypt(result.reply),
        status: 'ok',
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { messageCount: { increment: 2 }, updatedAt: new Date() },
    });

    if (result.refuse) {
      await prisma.moderationEvent.create({
        data: {
          userId,
          direction: 'output',
          category: 'in_character_refusal',
          action: 'refuse',
          messageId: assistantMessage.id,
        },
      });
    }

    await spendCredit(userId, assistantMessage.id);
    await recordCost(result.costUsd);

    await ctx.reply(result.reply);

    if (isFirstMessage) {
      await track(userId, EVENTS.firstMessage);
    }
    await track(userId, EVENTS.messageSent, { model, refuse: result.refuse });
    await track(userId, EVENTS.llmCost, {
      purpose: 'reply',
      model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    });

    const balanceAfter = balanceBefore - 1;
    if (LOW_BALANCE_THRESHOLDS.has(balanceAfter)) {
      const event = balanceAfter === 20 ? EVENTS.trial20Left : EVENTS.trial5Left;
      await track(userId, event, { balance: balanceAfter });
      await ctx.reply(ctx.dict.trial.lowNotice(balanceAfter));
    }

    runInBackground(`summary:${conversation.id}`, () => maybeRefreshSummary(conversation.id));
  } finally {
    await lock.release();
  }
}

chatComposer.on('message:text', handleChatMessage);
