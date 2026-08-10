import 'dotenv/config';
import { z } from 'zod';

/** "true"/"false" из окружения → boolean. */
const boolish = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

/** 32 байта в base64 — ключ AES-256-GCM (docs/decisions.md §8). */
const encryptionKey = z.string().refine(
  (v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  },
  {
    message:
      'CONTENT_ENCRYPTION_KEY должен быть 32 байта в base64. Сгенерировать: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  },
);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PORT: z.coerce.number().int().positive().default(3000),

    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN обязателен — получите у @BotFather'),
    TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
    TELEGRAM_WEBHOOK_URL: z.url().optional().or(z.literal('').transform(() => undefined)),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    ADMIN_TELEGRAM_IDS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => BigInt(s)),
      ),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY обязателен — https://aistudio.google.com/apikey'),
    // gemini-2.5-flash-lite отключена для новых проектов (подтверждено 2026-08-10 —
    // см. docs/pricing.md). Дефолт — следующая по цене доступная модель.
    GEMINI_MODEL_TRIAL: z.string().default('gemini-3.1-flash-lite'),
    GEMINI_MODEL_PAID: z.string().default('gemini-3.1-flash-lite'),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

    CONTENT_ENCRYPTION_KEY: encryptionKey,

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_PER_DAY: z.coerce.number().int().positive().default(300),
    DAILY_BUDGET_USD: z.coerce.number().positive().default(25),
    KILL_SWITCH: boolish('false'),

    TRIAL_MESSAGE_COUNT: z.coerce.number().int().positive().default(100),
    CONTEXT_MESSAGE_WINDOW: z.coerce.number().int().positive().default(12),
    CONTEXT_SUMMARY_EVERY: z.coerce.number().int().positive().default(20),
    MEMORY_RETRIEVAL_LIMIT: z.coerce.number().int().positive().default(30),
    MEMORY_EPISODIC_TTL_DAYS: z.coerce.number().int().positive().default(30),
  })
  .superRefine((v, ctx) => {
    if (v.TELEGRAM_MODE !== 'webhook') return;
    if (!v.TELEGRAM_WEBHOOK_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_WEBHOOK_URL'],
        message: 'TELEGRAM_WEBHOOK_URL обязателен при TELEGRAM_MODE=webhook',
      });
    }
    // Без secret token любой, кто знает URL, сможет слать поддельные updates.
    if (!v.TELEGRAM_WEBHOOK_SECRET || v.TELEGRAM_WEBHOOK_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_WEBHOOK_SECRET'],
        message:
          'TELEGRAM_WEBHOOK_SECRET обязателен при TELEGRAM_MODE=webhook и должен быть ≥32 символов. ' +
          'Сгенерировать: openssl rand -hex 32',
      });
    }
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  · ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Бросаем до инициализации логгера — он сам зависит от env.
    throw new Error(`Некорректная конфигурация окружения:\n${details}`);
  }
  return parsed.data;
}

export const env = load();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
