import { GoogleGenAI, HarmBlockThreshold, HarmCategory, FinishReason, type Content } from '@google/genai';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';
import { REPLY_SCHEMA, parseReplyPayload } from './schema.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

/**
 * $ за 1M токенов (pricing.md §1, зафиксировано 2026-08-07 — перепроверить перед прод-запуском,
 * цены моделей меняются). Модель без записи здесь — ошибка конфигурации, а не молчаливый nullish.
 */
const PRICE_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.6-flash': { input: 1.5, output: 7.5 },
};

/** Fail fast при старте (docs/decisions.md — та же дисциплина, что у остальной env-валидации). */
export function assertKnownModels(): void {
  for (const model of [env.GEMINI_MODEL_TRIAL, env.GEMINI_MODEL_PAID]) {
    if (!(model in PRICE_PER_MILLION_USD)) {
      throw new Error(
        `Неизвестная модель Gemini "${model}" — добавьте цену в PRICE_PER_MILLION_USD ` +
          '(src/domain/chat/geminiClient.ts) перед использованием, иначе costUsd будет неверным.',
      );
    }
  }
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_PER_MILLION_USD[model];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export interface GenerateReplyInput {
  model: string;
  systemInstruction: string;
  contents: Content[];
}

export type GeminiResult =
  | { status: 'ok'; reply: string; refuse: boolean; inputTokens: number; outputTokens: number; costUsd: number }
  | { status: 'refused'; inputTokens: number; outputTokens: number; costUsd: number }
  | { status: 'failed' };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOnce(input: GenerateReplyInput): Promise<GeminiResult> {
  const response = await ai.models.generateContent({
    model: input.model,
    contents: input.contents,
    config: {
      systemInstruction: input.systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: REPLY_SCHEMA,
      // Ловушка №1 из pricing.md §1: без этого reasoning-токены тарифицируются как output
      // и раздувают стоимость в 3-5 раз.
      thinkingConfig: { thinkingBudget: 0 },
      safetySettings: [
        HarmCategory.HARM_CATEGORY_HARASSMENT,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE })),
      abortSignal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
    },
  });

  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const cost = costUsd(input.model, inputTokens, outputTokens);

  const finishReason = response.candidates?.[0]?.finishReason;
  const text = response.text;

  if (finishReason !== FinishReason.STOP || !text) {
    return { status: 'refused', inputTokens, outputTokens, costUsd: cost };
  }

  const payload = parseReplyPayload(text);
  if (!payload) {
    logger.warn({ model: input.model, finishReason }, 'Gemini вернул невалидный JSON вне схемы');
    return { status: 'refused', inputTokens, outputTokens, costUsd: cost };
  }

  return { status: 'ok', reply: payload.reply, refuse: payload.refuse, inputTokens, outputTokens, costUsd: cost };
}

/**
 * decisions.md §12: 2 ретрая с backoff, затем честный failed. Ретраим только сетевые/таймаут
 * сбои — content-level исходы (refused) ретраить бессмысленно, это не транзиентная ошибка.
 */
export async function generateReply(input: GenerateReplyInput): Promise<GeminiResult> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= env.GEMINI_MAX_RETRIES; attempt++) {
    try {
      return await callOnce(input);
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt, model: input.model }, 'Вызов Gemini не удался');
      if (attempt < env.GEMINI_MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  logger.error({ err: lastErr, model: input.model }, 'Gemini недоступна после всех ретраев');
  return { status: 'failed' };
}

export interface SummaryResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Простая генерация текста без JSON-схемы — для rolling summary (decisions.md §10).
 * Отдельная функция от generateReply: там жёсткий формат ответа персонажа, здесь
 * обычный текст для внутреннего использования, персонажу не показывается напрямую.
 */
export async function summarizeText(model: string, prompt: string): Promise<SummaryResult | null> {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
      },
    });

    const text = response.text;
    if (!text) return null;

    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    return { text, inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) };
  } catch (err) {
    logger.warn({ err, model }, 'Не удалось сгенерировать rolling summary');
    return null;
  }
}
