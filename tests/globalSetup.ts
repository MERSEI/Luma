import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from 'pg';

/**
 * Создаёт тестовую БД (если её нет) и накатывает миграции — один раз на прогон.
 */
export default async function setup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL as string);
  const dbName = url.pathname.slice(1);

  const admin = new Client({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
  });

  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) {
      // Имя приходит из .env.test, не из пользовательского ввода.
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  // Запускаем CLI напрямую через Node: npx на Windows — это .cmd, который
  // execFileSync без shell не умеет, а shell:true даёт DEP0190.
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
}
