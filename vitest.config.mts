import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./src/*" path mapping from tsconfig.json so that
    // tests may import production code through the project-wide alias.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Only TypeScript sources: the v8 provider tries to parse everything it
      // is given, and a README.md in src/lib would end up as a parse error
      // with a stack trace in the report.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
    },
  },
});
