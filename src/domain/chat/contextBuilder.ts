import type { Content } from '@google/genai';
import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';
import { tryDecrypt } from '../../infra/crypto.js';
import { buildSystemPrompt } from './prompt.js';
import type { Locale } from '../../i18n/index.js';
import type { Conversation } from '../../generated/prisma/client.js';

export interface ChatContext {
  conversation: Conversation;
  systemInstruction: string;
  /** История до текущего сообщения — текущее добавляет вызывающий код. */
  historyContents: Content[];
}

async function loadOrCreateProfile(userId: string) {
  return prisma.profile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

async function loadOrCreateConversation(userId: string, mode: Conversation['mode']) {
  const existing = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;

  return prisma.conversation.create({ data: { userId, mode } });
}

/** decisions.md §9: без embeddings, все активные факты, лимит MEMORY_RETRIEVAL_LIMIT, по свежести. */
async function loadMemoryFacts(userId: string): Promise<string[]> {
  const items = await prisma.memoryItem.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
    take: env.MEMORY_RETRIEVAL_LIMIT,
  });

  return items.map((item) => tryDecrypt(item.content)).filter((v): v is string => v !== null);
}

export async function buildContext(userId: string, locale: Locale): Promise<ChatContext> {
  const profile = await loadOrCreateProfile(userId);
  const conversation = await loadOrCreateConversation(userId, profile.mode);

  const recentMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, status: 'ok' },
    orderBy: { createdAt: 'desc' },
    take: env.CONTEXT_MESSAGE_WINDOW,
  });
  recentMessages.reverse();

  const historyContents: Content[] = recentMessages
    .map((m): Content | null => {
      const text = tryDecrypt(m.content);
      if (text === null || m.role === 'system') return null;
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
    })
    .filter((v): v is Content => v !== null);

  let systemInstruction = buildSystemPrompt(profile, locale);

  const summary = conversation.summary ? tryDecrypt(conversation.summary) : null;
  if (summary) {
    systemInstruction += `\n\nЧто вы обсуждали раньше (сжато, для твоей памяти, не пересказывай дословно):\n${summary}`;
  }

  const facts = await loadMemoryFacts(userId);
  if (facts.length > 0) {
    systemInstruction += `\n\nИзвестные факты о собеседнике:\n${facts.map((f) => `- ${f}`).join('\n')}`;
  }

  return { conversation, systemInstruction, historyContents };
}
