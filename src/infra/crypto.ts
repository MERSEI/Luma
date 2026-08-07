import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Шифрование содержимого сообщений и памяти (docs/decisions.md §8).
 *
 * Формат хранения: "v1:<iv-b64>:<tag-b64>:<ciphertext-b64>".
 * Версия в префиксе нужна для будущей ротации ключа: расшифровка сможет
 * выбрать нужный ключ, не гадая по длине.
 *
 * Граница защиты, честно: ключ живёт в env рядом с приложением. Это защищает
 * от утечки дампа БД и от чтения содержимого админом БД, но НЕ защищает от
 * компрометации самого сервера. См. docs/threat-model.md.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // рекомендованный размер nonce для GCM

let cachedKey: Buffer | null = null;

function key(): Buffer {
  cachedKey ??= Buffer.from(env.CONTENT_ENCRYPTION_KEY, 'base64');
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4) {
    throw new Error('Повреждённый шифротекст: неожиданный формат');
  }
  const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new Error(`Неподдерживаемая версия шифрования: ${version}`);
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Расшифровка для мест, где повреждённая запись не должна ронять весь диалог
 * (например, сборка контекста из истории). Возвращает null вместо исключения.
 */
export function tryDecrypt(payload: string): string | null {
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

/** SHA-256 hex. Для rawPayloadHash платежей — сам payload не хранится и не логируется. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
