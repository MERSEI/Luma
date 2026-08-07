import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env, isProd } from '../config/env.js';

/**
 * Prisma 7 работает без Rust-движка: соединение отдаёт driver adapter,
 * а не строка url в schema.prisma (там она больше не поддерживается).
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}

export type Db = typeof prisma;

/**
 * Тип транзакционного клиента. Нужен там, где инвариант требует выполнить
 * запись баланса и ledger в одной транзакции (docs/decisions.md §3).
 */
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
