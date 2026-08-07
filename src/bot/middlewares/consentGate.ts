import type { NextFunction } from 'grammy';
import type { LumaContext } from '../context.js';
import { hasAcceptedDisclosure } from '../../domain/consent/index.js';

/**
 * ТЗ §4.1: до нажатия «Продолжить» нельзя вести основной диалог и принимать оплату.
 *
 * Разрешены до согласия только: /start (показывает disclosure), callback'и самого
 * disclosure, и безобидные справочные команды. Всё остальное — включая /shop —
 * упирается в напоминание.
 */
const ALLOWED_COMMANDS = new Set(['/start', '/help', '/privacy']);

function isAllowedBeforeConsent(ctx: LumaContext): boolean {
  const data = ctx.callbackQuery?.data;
  if (data?.startsWith('disclosure:')) return true;

  const text = ctx.message?.text;
  if (!text?.startsWith('/')) return false;

  // "/start@BotName args" → "/start"
  const command = text.split(/[\s@]/)[0]?.toLowerCase() ?? '';
  return ALLOWED_COMMANDS.has(command);
}

export async function consentGateMiddleware(
  ctx: LumaContext,
  next: NextFunction,
): Promise<void> {
  if (hasAcceptedDisclosure(ctx.dbUser) || isAllowedBeforeConsent(ctx)) {
    await next();
    return;
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: ctx.dict.disclosure.required, show_alert: true });
    return;
  }
  await ctx.reply(ctx.dict.disclosure.required);
}
