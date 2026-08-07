import { Composer, InlineKeyboard } from 'grammy';
import type { LumaContext } from '../context.js';
import { acceptDisclosure } from '../../domain/consent/index.js';
import { getBalance } from '../../domain/credits/ledger.js';
import { track, EVENTS } from '../../infra/analytics.js';
import { logger } from '../../infra/logger.js';

export const startComposer = new Composer<LumaContext>();

function disclosureKeyboard(ctx: LumaContext): InlineKeyboard {
  const d = ctx.dict.disclosure;
  return new InlineKeyboard()
    .text(d.continue, 'disclosure:accept')
    .row()
    .text(d.rules, 'disclosure:rules')
    .text(d.privacy, 'disclosure:privacy')
    .row()
    .text(d.deleteData, 'disclosure:delete');
}

startComposer.command('start', async (ctx) => {
  await track(ctx.dbUser.id, EVENTS.start);

  if (ctx.dbUser.disclosureAcceptedAt) {
    const balance = await getBalance(ctx.dbUser.id);
    await ctx.reply(`${ctx.dict.disclosure.accepted(balance)}\n\n${ctx.dict.commands.help}`);
    return;
  }

  await ctx.reply(ctx.dict.disclosure.text, { reply_markup: disclosureKeyboard(ctx) });
});

startComposer.callbackQuery('disclosure:accept', async (ctx) => {
  const { firstTime } = await acceptDisclosure(ctx.dbUser.id);
  const balance = await getBalance(ctx.dbUser.id);

  await ctx.answerCallbackQuery();
  // Убираем клавиатуру, чтобы кнопку нельзя было нажать повторно.
  await ctx.editMessageReplyMarkup().catch(() => undefined);
  await ctx.reply(ctx.dict.disclosure.accepted(balance));

  if (firstTime) {
    logger.info({ userId: ctx.dbUser.id, balance }, 'Disclosure принят, trial начислен');
  }
});

startComposer.callbackQuery('disclosure:rules', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(ctx.dict.commands.privacy);
});

startComposer.callbackQuery('disclosure:privacy', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(ctx.dict.commands.privacy);
});

startComposer.callbackQuery('disclosure:delete', async (ctx) => {
  await ctx.answerCallbackQuery();
  // Полноценное удаление приезжает в Phase 4 вместе с /forget_all и /export_data.
  await ctx.reply(ctx.dict.commands.privacy);
});

startComposer.command('help', async (ctx) => {
  await ctx.reply(ctx.dict.commands.help);
});

startComposer.command('privacy', async (ctx) => {
  await ctx.reply(ctx.dict.commands.privacy);
});

startComposer.command('balance', async (ctx) => {
  const balance = await getBalance(ctx.dbUser.id);
  await ctx.reply(ctx.dict.commands.balance(balance));
});
