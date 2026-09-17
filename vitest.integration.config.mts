import { defineConfig } from 'vitest/config';

/*
  Testes contra Postgres (PGlite). Cada arquivo sobe o próprio banco
  (~0,5 s com template em cache, ~400 MB de RAM), então o paralelismo é
  limitado. Testes do MESMO arquivo rodam em série: o PGlite é uma sessão só.
*/

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    pool: 'forks',
    maxWorkers: 4,
    fileParallelism: true,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
