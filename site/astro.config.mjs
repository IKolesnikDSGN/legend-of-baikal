// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// Статическая сборка: голосование живёт на внешней платформе, SSR не нужен (ТЗ 2.1).
export default defineConfig({
  output: 'static',
  integrations: [mdx()],
  build: { inlineStylesheets: 'auto' },
  vite: {
    build: {
      // шейдеры лежат отдельными .glsl и подключаются как строки
      assetsInlineLimit: 0,
    },
  },
});
