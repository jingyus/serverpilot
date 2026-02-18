import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  integrations: [
    tailwind(),
    mdx(),
    sitemap()
  ],
  output: 'static',
  site: 'https://serverpilot.ai', // 替换为实际域名
  build: {
    assets: 'assets'
  }
});
