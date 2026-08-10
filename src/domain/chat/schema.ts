import { Type, type Schema } from '@google/genai';

/**
 * Структура ответа модели. `refuse` разделяет два разных исхода на уровне
 * MessageStatus: `refuse: true` — осознанный отказ персонажа в характере
 * (обычный успешный ход, кредит списывается), в отличие от жёсткого блока
 * Gemini safety на уровне finishReason (см. geminiClient.ts) — тот кредит
 * не списывает вовсе.
 */
export const REPLY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description: 'Ответ собеседнику от лица персонажа, обычная разговорная реплика.',
      minLength: '1',
      maxLength: '2000',
    },
    refuse: {
      type: Type.BOOLEAN,
      description:
        'true, если персонаж осознанно отказывается продолжать эту конкретную тему ' +
        '(романтика/18+, запрос денег, попытка выдать себя за человека и т.п.) — ' +
        'reply в этом случае содержит вежливый отказ в характере персонажа.',
    },
  },
  required: ['reply', 'refuse'],
  propertyOrdering: ['reply', 'refuse'],
};

export interface ReplyPayload {
  reply: string;
  refuse: boolean;
}

export function parseReplyPayload(raw: string): ReplyPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('reply' in parsed) ||
    !('refuse' in parsed) ||
    typeof (parsed as { reply: unknown }).reply !== 'string' ||
    typeof (parsed as { refuse: unknown }).refuse !== 'boolean'
  ) {
    return null;
  }

  return parsed as ReplyPayload;
}
