import { pino } from 'pino';
import { env, isProd } from '../config/env.js';

/**
 * Поля, которые никогда не должны попасть в логи (ТЗ §5 Security).
 * Содержимое сообщений и память не логируются вообще — только идентификаторы.
 */
const REDACT = [
  'token',
  'apiKey',
  'api_key',
  'password',
  'secret',
  'authorization',
  'GEMINI_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'CONTENT_ENCRYPTION_KEY',
  '*.token',
  '*.apiKey',
  '*.secret',
  'req.headers.authorization',
  'req.headers["x-telegram-bot-api-secret-token"]',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT, censor: '[redacted]' },
  base: { service: 'luma' },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;
