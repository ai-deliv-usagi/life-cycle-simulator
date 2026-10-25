import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages のサブパスでも動くよう相対パスでビルドする
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
