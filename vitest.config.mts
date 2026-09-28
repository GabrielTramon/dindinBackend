import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // testes de integração com Postgres (PGlite) ficam de fora da suíte rápida
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    restoreMocks: true,
  },
});
