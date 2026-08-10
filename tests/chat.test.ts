import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../src/db/client.js';
import { grantTrial } from '../src/domain/credits/ledger.js';
import { ru } from '../src/i18n/ru.js';
import { env } from '../src/config/env.js';
import type { LumaContext } from '../src/bot/context.js';

const { generateReplyMock } = vi.hoisted(() => ({ generateReplyMock: vi.fn() }));

vi.mock('../src/domain/chat/geminiClient.js', () => ({
  generateReply: generateReplyMock,
  assertKnownModels: vi.fn(),
}));

// Импорт после мока — по тому же принципу, что и остальные vitest-моки на границе модуля.
const { handleChatMessage } = await import('../src/bot/commands/chat.js');

async function makeUser(telegramId = 3_000_001n) {
  const user = await prisma.user.create({
    data: { telegramUserId: telegramId, locale: 'ru', disclosureAcceptedAt: new Date() },
  });
  await grantTrial(user.id);
  return prisma.user.findUniqueOrThrow({ where: { id: user.id } });
}

function makeCtx(dbUser: Awaited<ReturnType<typeof makeUser>>, text: string) {
  const reply = vi.fn(async () => undefined);
  const replyWithChatAction = vi.fn(async () => undefined);

  const ctx = {
    dbUser,
    dict: ru,
    message: { text },
    reply,
    replyWithChatAction,
  } as unknown as LumaContext & { message: { text: string } };

  return { ctx, reply, replyWithChatAction };
}

beforeEach(() => {
  generateReplyMock.mockReset();
});

describe('обработчик сообщений чата', () => {
  it('на успешный ответ Gemini списывает кредит и отвечает пользователю', async () => {
    generateReplyMock.mockResolvedValue({
      status: 'ok',
      reply: 'Привет! Как твои дела?',
      refuse: false,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.0001,
    });

    const user = await makeUser();
    const { ctx, reply } = makeCtx(user, 'привет');

    await handleChatMessage(ctx);

    expect(reply).toHaveBeenCalledWith('Привет! Как твои дела?');

    const entitlement = await prisma.entitlement.findFirstOrThrow({ where: { userId: user.id } });
    expect(entitlement.balance).toBe(env.TRIAL_MESSAGE_COUNT - 1);

    const debit = await prisma.ledgerEntry.findFirst({ where: { userId: user.id, eventType: 'debit' } });
    expect(debit).not.toBeNull();

    const messages = await prisma.message.findMany({ where: { role: 'assistant' } });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('ok');
  });

  it('не списывает кредит и не отвечает текстом модели при жёстком блоке модерации', async () => {
    generateReplyMock.mockResolvedValue({ status: 'refused', inputTokens: 50, outputTokens: 0, costUsd: 0 });

    const user = await makeUser();
    const { ctx, reply } = makeCtx(user, 'что-то запрещённое');

    await handleChatMessage(ctx);

    expect(reply).toHaveBeenCalledWith(ru.errors.blocked);
    expect(await prisma.ledgerEntry.count({ where: { userId: user.id, eventType: 'debit' } })).toBe(0);
    expect(await prisma.moderationEvent.count({ where: { userId: user.id, action: 'block' } })).toBe(1);
  });

  it('не списывает кредит при недоступности Gemini', async () => {
    generateReplyMock.mockResolvedValue({ status: 'failed' });

    const user = await makeUser();
    const { ctx, reply } = makeCtx(user, 'привет');

    await handleChatMessage(ctx);

    expect(reply).toHaveBeenCalledWith(ru.errors.llmUnavailable);
    expect(await prisma.ledgerEntry.count({ where: { userId: user.id, eventType: 'debit' } })).toBe(0);
    expect(await prisma.message.count({ where: { role: 'assistant' } })).toBe(0);
  });

  it('при нулевом балансе не вызывает Gemini вообще', async () => {
    const user = await prisma.user.create({
      data: { telegramUserId: 3_000_099n, locale: 'ru', disclosureAcceptedAt: new Date() },
    });
    const { ctx, reply } = makeCtx(user, 'привет');

    await handleChatMessage(ctx);

    expect(generateReplyMock).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(ru.trial.exhausted);
  });

  it('команды (текст с "/") не уходят в Gemini, отвечает справкой', async () => {
    const user = await makeUser();
    const { ctx, reply } = makeCtx(user, '/unknown');

    await handleChatMessage(ctx);

    expect(generateReplyMock).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(ru.commands.help);
  });

  it('успешный отказ персонажа в характере (refuse: true) всё равно списывает кредит', async () => {
    generateReplyMock.mockResolvedValue({
      status: 'ok',
      reply: 'Давай сменим тему.',
      refuse: true,
      inputTokens: 80,
      outputTokens: 15,
      costUsd: 0.0001,
    });

    const user = await makeUser();
    const { ctx, reply } = makeCtx(user, 'спорная просьба');

    await handleChatMessage(ctx);

    expect(reply).toHaveBeenCalledWith('Давай сменим тему.');
    expect(await prisma.ledgerEntry.count({ where: { userId: user.id, eventType: 'debit' } })).toBe(1);
    expect(await prisma.moderationEvent.count({ where: { userId: user.id, action: 'refuse' } })).toBe(1);
  });
});
