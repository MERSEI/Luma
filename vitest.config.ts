import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Грузим до импорта приложения: src/config/env.ts вызывает dotenv,
// а тот не перезаписывает уже установленные переменные — так .env.test выигрывает.
config({ path: '.env.test', override: true });

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],
    // Общая тестовая БД — файлы не должны бежать параллельно.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
