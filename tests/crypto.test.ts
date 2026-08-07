import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, tryDecrypt, sha256 } from '../src/infra/crypto.js';

describe('шифрование содержимого', () => {
  it('расшифровывает то, что зашифровало', () => {
    const text = 'Люблю фантастику и не люблю рано вставать';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it('даёт разный шифротекст для одного и того же текста', () => {
    // Одинаковый ciphertext выдал бы повторяющиеся сообщения при утечке дампа.
    expect(encrypt('привет')).not.toBe(encrypt('привет'));
  });

  it('переживает эмодзи и многобайтовые символы', () => {
    const text = '🌙 Luma — AI-персонаж, 日本語 тоже';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it('отклоняет подделанный шифротекст', () => {
    // GCM аутентифицирует данные: изменение хотя бы байта должно ломать расшифровку.
    const parts = encrypt('исходный текст').split(':');
    const tampered = Buffer.from(parts[3] as string, 'base64');
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);
    parts[3] = tampered.toString('base64');

    expect(() => decrypt(parts.join(':'))).toThrow();
    expect(tryDecrypt(parts.join(':'))).toBeNull();
  });

  it('отклоняет неизвестную версию формата', () => {
    const payload = encrypt('текст').replace(/^v1:/, 'v2:');
    expect(() => decrypt(payload)).toThrow(/версия/i);
  });

  it('sha256 стабилен', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
