import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/',
  publicDir: 'public',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
