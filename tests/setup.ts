import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';

/**
 * Полная очистка между тестами. TRUNCATE ... CASCADE быстрее пообъектного
 * удаления и сбрасывает связи одним запросом.
 */
const TABLES = [
  'AnalyticsEvent',
  'AuditEvent',
  'ModerationEvent',
  'ProcessedUpdate',
  'Payment',
  'LedgerEntry',
  'Entitlement',
  'Product',
  'MemoryItem',
  'Message',
  'Conversation',
  'Consent',
  'Profile',
  'User',
];

beforeEach(async () => {
  const list = TABLES.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await redis.flushdb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});
