import { describe, it, expect, afterAll } from 'vitest';
import { createBot } from '../src/bot/index.js';
import { createServer } from '../src/server.js';

const app = createServer(createBot());

afterAll(async () => {
  await app.close();
});

describe('HTTP-сервер', () => {
  it('/health отвечает 200 при живых зависимостях', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: true, redis: true, draining: false });
  });

  it('webhook-роут не смонтирован в polling-режиме', async () => {
    // .env.test держит TELEGRAM_MODE=polling — открытого вебхука быть не должно.
    const res = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
