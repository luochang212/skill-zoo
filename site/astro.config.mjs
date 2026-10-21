import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.luochang.ink',
  base: '/skill-zoo',
  output: 'static',
  vite: { build: { target: 'safari16.4' } },
  integrations: [sitemap({
    i18n: { defaultLocale: 'en', locales: { en: 'en', zh: 'zh-CN' } },
  })],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: { prefixDefaultLocale: false },
  },
});
