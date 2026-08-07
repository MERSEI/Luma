import { describe, it, expect, vi } from 'vitest';
import { consentGateMiddleware } from '../src/bot/middlewares/consentGate.js';
import type { LumaContext } from '../src/bot/context.js';
import { ru } from '../src/i18n/ru.js';

interface CtxParts {
  accepted: boolean;
  text?: string;
  callbackData?: string;
}

function makeCtx({ accepted, text, callbackData }: CtxParts) {
  const reply = vi.fn(async () => undefined);
  const answerCallbackQuery = vi.fn(async () => undefined);

  const ctx = {
    dbUser: { disclosureAcceptedAt: accepted ? new Date() : null },
    dict: ru,
    reply,
    answerCallbackQuery,
    ...(text === undefined ? {} : { message: { text } }),
    ...(callbackData === undefined ? {} : { callbackQuery: { data: callbackData } }),
  } as unknown as LumaContext;

  return { ctx, reply, answerCallbackQuery };
}

describe('гейт согласия (ТЗ §4.1)', () => {
  it('блокирует обычный диалог до принятия disclosure', async () => {
    const { ctx, reply } = makeCtx({ accepted: false, text: 'привет, как дела?' });
    const next = vi.fn(async () => undefined);

    await consentGateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(ru.disclosure.required);
  });

  it('блокирует /shop до принятия disclosure', async () => {
    // Оплата до согласия запрещена так же, как и диалог.
    const { ctx, reply } = makeCtx({ accepted: false, text: '/shop' });
    const next = vi.fn(async () => undefined);

    await consentGateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
  });

  it.each(['/start', '/help', '/privacy', '/start@LumaBot', '/START'])(
    'пропускает %s до принятия disclosure',
    async (command) => {
      const { ctx } = makeCtx({ accepted: false, text: command });
      const next = vi.fn(async () => undefined);

      await consentGateMiddleware(ctx, next);

      expect(next).toHaveBeenCalledOnce();
    },
  );

  it('пропускает callback самого disclosure', async () => {
    const { ctx } = makeCtx({ accepted: false, callbackData: 'disclosure:accept' });
    const next = vi.fn(async () => undefined);

    await consentGateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('на посторонний callback до согласия отвечает алертом, а не молчит', async () => {
    const { ctx, answerCallbackQuery } = makeCtx({ accepted: false, callbackData: 'shop:buy' });
    const next = vi.fn(async () => undefined);

    await consentGateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({
      text: ru.disclosure.required,
      show_alert: true,
    });
  });

  it('пропускает всё после принятия disclosure', async () => {
    const { ctx } = makeCtx({ accepted: true, text: 'привет' });
    const next = vi.fn(async () => undefined);

    await consentGateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
